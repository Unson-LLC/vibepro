import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { formatCounts } from './refactoring-delta-reporter.js';
import {
  buildRequirementConsistency,
  findStorySource,
  isStoryDocPath,
  renderRequirementGateSummary
} from './requirement-consistency.js';
import { renderGateDagHtml, renderPrCreateHtml, renderPrPrepareHtml, renderSplitPlanHtml } from './html-report.js';
import { classifyChangeRisk } from './change-risk-classifier.js';
import { normalizeActiveStories } from './story-manager.js';
import { readNarrative } from './report-store.js';
import { collectRuntimeInfo } from './runtime-info.js';
import { localizedText, resolveOutputLanguage } from './language.js';
import { scanNetworkContracts } from './network-contract-scanner.js';
import { readDrift, readInferredSpec } from './spec-store.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import {
  renderPerformancePrSection,
  summarizeStoryPerformanceEvidence
} from './performance-evidence.js';
import {
  renderAgentReviewPrSection,
  summarizeAgentReviewsForPr
} from './agent-review.js';
import {
  renderExplorePrSection,
  summarizeExploreEvidenceForPr
} from './explore-evidence.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_REVIEWABLE_FILES = 30;
const DEFAULT_PR_PREPARE_STAGE_TIMEOUT_MS = 600000;

function createPrPrepareProgress(options = {}) {
  const timeoutMs = Number.isFinite(options.stageTimeoutMs) && options.stageTimeoutMs > 0
    ? options.stageTimeoutMs
    : DEFAULT_PR_PREPARE_STAGE_TIMEOUT_MS;
  const reporter = typeof options.progressReporter === 'function'
    ? options.progressReporter
    : null;
  const stages = [];

  async function stage(name, fn, stageOptions = {}) {
    const timeoutEnabled = stageOptions.timeout !== false;
    const startedAt = new Date();
    const record = {
      name,
      status: 'running',
      started_at: startedAt.toISOString(),
      timeout_ms: timeoutEnabled ? timeoutMs : null
    };
    stages.push(record);
    reporter?.({
      event: 'stage_start',
      stage: name,
      started_at: record.started_at,
      timeout_ms: record.timeout_ms
    });
    let timeoutHandle = null;
    const abortController = new AbortController();
    try {
      const work = Promise.resolve().then(async () => {
        if (options.__testStageDelayMs?.[name]) {
          await new Promise((resolve) => setTimeout(resolve, options.__testStageDelayMs[name]));
        }
        return fn({ signal: abortController.signal });
      });
      const value = timeoutEnabled
        ? await Promise.race([
          work,
          new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
              const elapsedMs = Date.now() - startedAt.getTime();
              const error = new Error(
                `vibepro pr prepare timed out during stage "${name}" after ${elapsedMs}ms ` +
                `(stage timeout ${timeoutMs}ms). Rerun with progress output, inspect the last stage, ` +
                `or raise --stage-timeout-ms if the repository legitimately needs more time.`
              );
              error.code = 'VIBEPRO_PR_PREPARE_STAGE_TIMEOUT';
              error.stage = name;
              error.elapsed_ms = elapsedMs;
              error.timeout_ms = timeoutMs;
              abortController.abort(error);
              reject(error);
            }, timeoutMs);
          })
        ])
        : await work;
      record.status = 'completed';
      record.finished_at = new Date().toISOString();
      record.duration_ms = Date.now() - startedAt.getTime();
      reporter?.({
        event: 'stage_complete',
        stage: name,
        duration_ms: record.duration_ms
      });
      return value;
    } catch (error) {
      record.status = error.code === 'VIBEPRO_PR_PREPARE_STAGE_TIMEOUT' ? 'timeout' : 'failed';
      record.finished_at = new Date().toISOString();
      record.duration_ms = Date.now() - startedAt.getTime();
      record.error = error.message;
      reporter?.({
        event: record.status === 'timeout' ? 'stage_timeout' : 'stage_failed',
        stage: name,
        duration_ms: record.duration_ms,
        error: error.message
      });
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  return {
    stage,
    timeoutMs,
    snapshot: () => stages.map((item) => ({ ...item }))
  };
}

async function writeFileWithTimeout(filePath, content, { timeoutMs, stage }) {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    const error = new Error(
      `vibepro pr prepare timed out during stage "${stage}" ` +
      `(stage timeout ${timeoutMs}ms). Rerun with progress output, inspect the last stage, ` +
      `or raise --stage-timeout-ms if the repository legitimately needs more time.`
    );
    error.code = 'VIBEPRO_PR_PREPARE_STAGE_TIMEOUT';
    error.stage = stage;
    error.timeout_ms = timeoutMs;
    abortController.abort(error);
  }, timeoutMs);
  try {
    await writeFile(filePath, content, { signal: abortController.signal });
  } catch (error) {
    if (abortController.signal.aborted) {
      throw abortController.signal.reason ?? error;
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export async function preparePullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const progress = createPrPrepareProgress(options);
  const toolchain = await progress.stage('collect_runtime_info', () => collectRuntimeInfo());
  const git = await progress.stage('collect_git_state', () => collectGitState(root, options));
  const workspace = await progress.stage('read_workspace_state', () => readWorkspaceState(root));
  const outputLanguage = resolveOutputLanguage(workspace.config, options.language ?? null);
  const story = await progress.stage('resolve_story', () => resolveStory(root, workspace.config, options.storyId, {
    allowTransient: !workspace.initialized
  }));
  const manifest = workspace.initialized
    ? await progress.stage('read_manifest', () => readManifest(root))
    : createTransientManifest();

  // DAG strict mode: task必須・target_files一致・handoff/execute artifacts存在を要求
  if (options.strict && !options.taskId) {
    throw new Error(
      'Strict mode requires --task. Run `vibepro task create --from-plan --id <story>` and ' +
      '`vibepro task brief|plan|handoff|execute` for the task before pr prepare/create.'
    );
  }

  const taskContext = workspace.initialized && options.taskId
    ? await progress.stage('load_task_context', () => loadPrTaskContext(root, story.story_id, options.taskId, options.groupId))
    : null;

  if (options.strict && taskContext) {
    await progress.stage('assert_strict_task_artifacts', () => assertStrictTaskArtifacts(root, story.story_id, taskContext.task.id, taskContext.group?.id));
    assertStrictTargetFiles(taskContext, git.changed_files, options);
  }

  const reviewChangedFiles = git.changed_files.filter((file) => !isWorkspaceArtifactPath(file.path));
  const reviewDirtyFiles = git.dirty_files.filter((file) => !isWorkspaceArtifactPath(file.path));
  const reviewGit = {
    ...git,
    changed_files: reviewChangedFiles,
    dirty_files: reviewDirtyFiles,
    ignored_workspace_artifacts: {
      changed_files: git.changed_files.length - reviewChangedFiles.length,
      dirty_files: git.dirty_files.length - reviewDirtyFiles.length
    }
  };
  const fileGroups = groupChangedFiles(reviewChangedFiles);
  const scope = assessScope({
    changedFiles: reviewChangedFiles,
    fileGroups,
    dirtyFiles: reviewDirtyFiles,
    dirtyFilesAffectScope: reviewGit.includes_dirty_in_changed_files,
    commits: reviewGit.commits,
    maxReviewableFiles: options.maxReviewableFiles ?? DEFAULT_MAX_REVIEWABLE_FILES
  });
  const latestStoryRun = findLatestStoryRun(manifest, story.story_id);
  const verificationEvidence = workspace.initialized
    ? await progress.stage('read_verification_evidence', () => readVerificationEvidenceIfExists(root, story.story_id))
    : null;
  const prContext = await progress.stage('build_pr_context', () => buildPrContext(root, {
    story,
    taskContext,
    git: reviewGit,
    fileGroups,
    latestStoryRun,
    verificationEvidence
  }));
  prContext.toolchain = toolchain;
  const suggestedBranch = options.branchName ?? buildBranchName(story);
  const splitPlan = await progress.stage('build_split_plan', () => buildPrSplitPlan(root, {
    story,
    git: reviewGit,
    fileGroups,
    scope,
    prContext,
    suggestedBranch
  }));
  const gateStatus = buildPrPrepareGateStatus(prContext.gate_dag, prContext.completion_quality);
  const nextCommands = buildNextCommands({
    baseRef: git.base_ref,
    currentBranch: reviewGit.current_branch,
    suggestedBranch,
    commits: reviewGit.commits,
    scope,
    storyId: story.story_id,
    taskId: taskContext?.task?.id ?? options.taskId ?? null,
    groupId: taskContext?.group?.id ?? options.groupId ?? null,
    gateStatus
  });
  const prBodyNarrative = await progress.stage('read_pr_body_narrative', () => readNarrative(root, story.story_id, 'pr-body'));
  const prBody = await progress.stage('render_pr_body', () => renderPrBody({
    story,
    taskContext,
    git: reviewGit,
    fileGroups,
    latestStoryRun,
    scope,
    prContext,
    splitPlan,
    narrative: prBodyNarrative,
    language: outputLanguage
  }));
  const preparation = {
    schema_version: '0.1.0',
    story,
    created_at: new Date().toISOString(),
    output: {
      language: outputLanguage
    },
    gate_status: gateStatus,
    workspace: {
      initialized: workspace.initialized,
      artifact_location: workspace.initialized ? 'repo' : 'temporary'
    },
    git: reviewGit,
    file_groups: fileGroups,
    scope,
    split_plan: splitPlan,
    pr_context: prContext,
    toolchain,
    task_context: taskContext,
    latest_story_run: latestStoryRun,
    suggested_branch: suggestedBranch,
    next_commands: nextCommands,
    diagnostics: {
      pr_prepare_stages: progress.snapshot()
    }
  };

  const prRoot = workspace.initialized
    ? getWorkspaceDir(root)
    : await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-prepare-'));
  const prDir = path.join(prRoot, 'pr', story.story_id);
  await mkdir(prDir, { recursive: true });
  const jsonPath = path.join(prDir, 'pr-prepare.json');
  const reportPath = path.join(prDir, 'pr-prepare.html');
  const reviewCockpitPath = path.join(prDir, 'review-cockpit.html');
  const humanReviewPath = path.join(prDir, 'human-review.json');
  const architectureReviewPath = path.join(prDir, 'architecture-review.json');
  const bodyPath = path.join(prDir, 'pr-body.md');
  const gateDagJsonPath = path.join(prDir, 'gate-dag.json');
  const gateDagReportPath = path.join(prDir, 'gate-dag.html');
  const splitPlanJsonPath = path.join(prDir, 'split-plan.json');
  const splitPlanReportPath = path.join(prDir, 'split-plan.html');
  await progress.stage('write_pr_prepare_artifacts', async ({ signal }) => {
    await writeFile(bodyPath, prBody, { signal });
    await writeFile(gateDagJsonPath, `${JSON.stringify(prContext.gate_dag, null, 2)}\n`, { signal });
    await writeFile(gateDagReportPath, renderGateDagHtml(prContext.gate_dag, {
      generatedAt: preparation.created_at,
      language: outputLanguage
    }), { signal });
    await writeFile(splitPlanJsonPath, `${JSON.stringify(splitPlan, null, 2)}\n`, { signal });
    await writeFile(splitPlanReportPath, renderSplitPlanHtml(splitPlan, {
      generatedAt: preparation.created_at,
      language: outputLanguage
    }), { signal });
    const reviewCockpitHtml = renderPrPrepareHtml({
      preparation,
      bodyPath: toWorkspaceRelative(root, bodyPath),
      gateDagPath: toWorkspaceRelative(root, gateDagReportPath),
      splitPlanPath: toWorkspaceRelative(root, splitPlanReportPath),
      language: outputLanguage
    });
    await writeFile(reportPath, reviewCockpitHtml, { signal });
    await writeFile(reviewCockpitPath, reviewCockpitHtml, { signal });
    const existingArchitectureReview = await readJsonIfExists(architectureReviewPath);
    const existingHumanReview = await readJsonIfExists(humanReviewPath);
    await writeFile(architectureReviewPath, `${JSON.stringify(buildArchitectureReviewTemplate({
      preparation,
      reviewCockpitPath: toWorkspaceRelative(root, reviewCockpitPath),
      gateDagPath: toWorkspaceRelative(root, gateDagReportPath),
      existingReview: existingArchitectureReview
    }), null, 2)}\n`, { signal });
    await writeFile(humanReviewPath, `${JSON.stringify(buildHumanReviewTemplate({
      preparation,
      reviewCockpitPath: toWorkspaceRelative(root, reviewCockpitPath),
      architectureReviewPath: toWorkspaceRelative(root, architectureReviewPath),
      bodyPath: toWorkspaceRelative(root, bodyPath),
      gateDagPath: toWorkspaceRelative(root, gateDagReportPath),
      splitPlanPath: toWorkspaceRelative(root, splitPlanReportPath),
      existingReview: existingHumanReview
    }), null, 2)}\n`, { signal });
  });
  preparation.diagnostics.pr_prepare_stages = progress.snapshot();

  if (workspace.initialized) {
    manifest.pr_preparations = {
      ...(manifest.pr_preparations ?? {}),
      [story.story_id]: {
        latest_prepare: toWorkspaceRelative(root, jsonPath),
        latest_report: toWorkspaceRelative(root, reportPath),
        latest_review_cockpit: toWorkspaceRelative(root, reviewCockpitPath),
        latest_human_review: toWorkspaceRelative(root, humanReviewPath),
        latest_architecture_review: toWorkspaceRelative(root, architectureReviewPath),
        latest_pr_body: toWorkspaceRelative(root, bodyPath),
        latest_gate_dag: toWorkspaceRelative(root, gateDagJsonPath),
        latest_gate_dag_report: toWorkspaceRelative(root, gateDagReportPath),
        latest_split_plan: toWorkspaceRelative(root, splitPlanJsonPath),
        latest_split_plan_report: toWorkspaceRelative(root, splitPlanReportPath),
        latest_prepare_generated_at: preparation.created_at
      }
    };
    if (taskContext) {
      manifest.pr_preparations[story.story_id].latest_task_id = taskContext.task.id;
      manifest.pr_preparations[story.story_id].latest_task_handoff = taskContext.artifacts.handoff_json;
    }
    await progress.stage('write_manifest', ({ signal }) => writeManifest(root, manifest, { signal }));
  }
  preparation.diagnostics.pr_prepare_stages = progress.snapshot();
  await writeFileWithTimeout(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`, {
    timeoutMs: progress.timeoutMs,
    stage: 'write_pr_prepare_json'
  });

  return {
    story,
    preparation,
    artifacts: {
      json: jsonPath,
      report: reportPath,
      review_cockpit: reviewCockpitPath,
      human_review: humanReviewPath,
      architecture_review: architectureReviewPath,
      pr_body: bodyPath,
      gate_dag: gateDagJsonPath,
      gate_dag_report: gateDagReportPath,
      split_plan: splitPlanJsonPath,
      split_plan_report: splitPlanReportPath
    }
  };
}

function buildArchitectureReviewTemplate({ preparation, reviewCockpitPath, gateDagPath, existingReview = null }) {
  const architectureGate = preparation.pr_context?.gate_dag?.nodes?.find((node) => node.id === 'architecture') ?? null;
  const specGate = preparation.pr_context?.gate_dag?.nodes?.find((node) => node.id === 'spec') ?? null;
  return {
    schema_version: '0.1.0',
    story_id: preparation.story.story_id,
    created_at: preparation.created_at,
    status: architectureGate?.status ?? 'needs_review',
    required: true,
    architecture_decision: preparation.pr_context?.architecture_decision ?? null,
    source_artifacts: {
      story: preparation.pr_context?.story_source?.path ?? null,
      review_cockpit: reviewCockpitPath,
      gate_dag: gateDagPath
    },
    gates: {
      architecture: architectureGate ? {
        status: architectureGate.status,
        reason: architectureGate.reason ?? null
      } : null,
      spec: specGate ? {
        status: specGate.status,
        reason: specGate.reason ?? null
      } : null
    },
    toolchain: preparation.toolchain ?? null,
    review_record: existingReview?.review_record ?? {
      approved: null,
      reviewer: null,
      reason: null,
      reviewed_at: null,
      comments: null
    }
  };
}

function buildHumanReviewTemplate({ preparation, reviewCockpitPath, architectureReviewPath, bodyPath, gateDagPath, splitPlanPath, existingReview = null }) {
  const visualQa = preparation.pr_context?.visual_qa ?? null;
  const completionQuality = preparation.pr_context?.completion_quality ?? null;
  return {
    schema_version: '0.1.0',
    story_id: preparation.story.story_id,
    created_at: preparation.created_at,
    recommended_decision: recommendHumanDecision(preparation),
    recommendation_reason: buildHumanReviewReason(preparation),
    source_artifacts: {
      review_cockpit: reviewCockpitPath,
      architecture_review: architectureReviewPath,
      pr_body: bodyPath,
      gate_dag: gateDagPath,
      split_plan: splitPlanPath,
      visual_qa: visualQa?.artifacts ?? []
    },
    evidence_summary: {
      architecture: summarizeReviewGate(preparation.pr_context?.gate_dag, 'architecture'),
      spec: summarizeReviewGate(preparation.pr_context?.gate_dag, 'spec'),
      visual_qa: visualQa ? {
        status: visualQa.status,
        threshold_pct: visualQa.threshold_pct,
        checked_runs: visualQa.runs.length,
        needs_review_count: visualQa.runs.filter((run) => run.status === 'needs_review').length
      } : null,
      completion_quality: completionQuality ? {
        status: completionQuality.status,
        e2e_experience_reach_rate: completionQuality.metrics.e2e_experience_reach_rate,
        final_20_auto_closure_rate: completionQuality.metrics.final_20_auto_closure_rate,
        visual_qa_pass_rate: completionQuality.metrics.visual_qa_pass_rate,
        required_evidence_count: completionQuality.required_evidence.length
      } : null
    },
    toolchain: preparation.toolchain ?? null,
    decision_options: [
      'proceed',
      'split_pr',
      'add_evidence',
      'waive_with_reason',
      'block'
    ],
    review_record: existingReview?.review_record ?? {
      selected_decision: null,
      reviewer: null,
      reason: null,
      reviewed_at: null,
      comments: null
    }
  };
}

function summarizeReviewGate(gateDag, gateId) {
  const gate = gateDag?.nodes?.find((node) => node.id === gateId) ?? null;
  if (!gate) return null;
  return {
    status: gate.status,
    required: gate.required === true,
    reason: gate.reason ?? null
  };
}

function recommendHumanDecision(preparation) {
  const gateStatus = preparation.pr_context?.gate_dag?.overall_status;
  if (preparation.split_plan?.status === 'split_recommended') return 'split_pr';
  if (preparation.pr_context?.visual_qa?.status === 'needs_review') return 'add_evidence';
  if (gateStatus === 'needs_verification') return 'add_evidence';
  if (gateStatus === 'ready_for_review') return 'proceed';
  return 'block';
}

function buildHumanReviewReason(preparation) {
  const reasons = [];
  const gateDag = preparation.pr_context?.gate_dag;
  const splitPlan = preparation.split_plan;
  if (gateDag) {
    reasons.push(`Gate DAG is ${gateDag.overall_status} with ${gateDag.summary?.needs_evidence_count ?? 0} unresolved evidence item(s).`);
  }
  if (splitPlan) {
    reasons.push(`Split Plan is ${splitPlan.status} with strategy ${splitPlan.recommended_strategy}.`);
  }
  if (preparation.scope?.status && preparation.scope?.recommended_strategy) {
    reasons.push(`Scope is ${preparation.scope.status}; recommended strategy is ${preparation.scope.recommended_strategy}.`);
  }
  if (preparation.pr_context?.visual_qa) {
    const visualQa = preparation.pr_context.visual_qa;
    const needsReviewCount = visualQa.runs.filter((run) => run.status === 'needs_review').length;
    reasons.push(`Visual QA is ${visualQa.status}; ${needsReviewCount} run(s) exceed the ${visualQa.threshold_pct}% residual threshold.`);
  }
  return reasons.join(' ');
}

export async function createPullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const prepareResult = await preparePullRequest(root, options);
  const { preparation } = prepareResult;
  const currentBranch = preparation.git.current_branch;
  if (!currentBranch && !options.headBranch) {
    throw new Error('Current branch could not be resolved. Specify --head or run on a named branch.');
  }

  // Gate DAG enforcement: overall_status が ready_for_review でなければ拒否
  // Memory rule: テスト/検証証跡なしの PR を機械的に防ぐ（CLAUDE.md 0.6 Deterministic Guards）
  const gateDag = preparation.pr_context?.gate_dag;
  const executionGate = preparation.pr_context?.execution_gate ?? buildExecutionGateStatus(gateDag);
  if (gateDag && gateDag.overall_status !== 'ready_for_review' && !options.allowNeedsVerification) {
    const unresolved = collectUnresolvedRequiredGates(gateDag);
    throw new Error(
      `Pre-create gate check failed: gate_dag.overall_status === '${gateDag.overall_status}' ` +
      `(needs_evidence_count=${gateDag.summary?.needs_evidence_count ?? 0}). ` +
      `Unresolved gates: ${formatUnresolvedGateList(unresolved)}. ` +
      `Provide evidence for critical gates (Story/Architecture/Spec/Requirement/E2E/Visual QA/Agent Review/failed checks). ` +
      `Only non-critical unresolved gates can use ` +
      `--allow-needs-verification --verification-waiver <reason> with an auditable reason.`
    );
  }
  if (gateDag && gateDag.overall_status !== 'ready_for_review' && options.allowNeedsVerification && !options.verificationWaiver) {
    throw new Error(
      `Pre-create gate waiver missing: --allow-needs-verification requires ` +
      `--verification-waiver <reason> so the PR records why unresolved gates are acceptable.`
    );
  }
  if (gateDag && gateDag.overall_status !== 'ready_for_review' && options.allowNeedsVerification && options.verificationWaiver) {
    const critical = executionGate.blocking_gates ?? [];
    if (critical.length > 0) {
      throw new Error(
        `Pre-create critical gate check failed: critical unresolved gates cannot be waived by reason alone. ` +
        `Critical gates: ${formatUnresolvedGateList(critical)}. ` +
        `Required evidence: ${formatCriticalGateEvidenceInstructions(critical)}. ` +
        `Record passing verification with \`vibepro verify record --id ${preparation.story.story_id} --kind <unit|integration|e2e> --status pass --command <cmd>\` ` +
        `or resolve the Story/Architecture/Spec/Requirement/Visual QA/Agent Review gate, then rerun \`vibepro pr prepare\` and \`vibepro pr create\`.`
      );
    }
  }

  const baseBranch = stripRemote(options.prBase ?? preparation.git.base_ref);
  const headBranch = options.headBranch ?? currentBranch;
  const title = options.title ?? buildPrTitle(preparation);
  const bodyFile = prepareResult.artifacts.pr_body;
  const warnings = [];
  const gateOverride = buildGateOverride(gateDag, options, {
    completionQuality: preparation.pr_context?.completion_quality ?? null,
    toolchain: preparation.toolchain ?? null
  });
  if (gateOverride?.allowed) {
    warnings.push(`Gate override used: ${gateOverride.reason}`);
    warnings.push(`Unresolved gates: ${formatUnresolvedGateList(gateOverride.unresolved_gates)}`);
  }
  if (headBranch === baseBranch) {
    warnings.push(`head branch equals base branch: ${headBranch}`);
    if (!options.dryRun) {
      throw new Error(`Cannot create PR because head branch equals base branch: ${headBranch}. Switch to a feature branch or specify --head.`);
    }
  }
  const pushCommand = ['git', ['push', '-u', 'origin', headBranch]];
  const ghCommand = ['gh', [
    'pr',
    'create',
    '--base',
    baseBranch,
    '--head',
    headBranch,
    '--title',
    title,
    '--body-file',
    bodyFile
  ]];
  const dryRun = options.dryRun === true;
  const createdAt = new Date().toISOString();
  const execution = {
    schema_version: '0.1.0',
    created_at: createdAt,
    mode: 'pr_create',
    dry_run: dryRun,
    workspace_initialized: preparation.workspace.initialized,
    story: preparation.story,
    task_context: preparation.task_context,
    output: preparation.output,
    gate_dag: gateDag ?? null,
    execution_gate: executionGate,
    gate_override: gateOverride,
    toolchain: preparation.toolchain ?? null,
    base: baseBranch,
    head: headBranch,
    title,
    body_file: toWorkspaceRelative(root, bodyFile),
    prepare_artifacts: mapArtifactPaths(root, prepareResult.artifacts),
    warnings,
    commands: [
      formatCommand(pushCommand),
      formatCommand(ghCommand)
    ],
    results: []
  };

  if (!dryRun) {
    const pushResult = await runCommand(root, pushCommand, options);
    execution.results.push(pushResult);
    if (pushResult.exit_code !== 0) {
      execution.status = 'failed';
      execution.error = `Command failed: ${pushResult.command}`;
      await writePrCreateArtifacts(root, prepareResult, execution);
      throw new Error(execution.error);
    }
    const ghResult = await runCommand(root, ghCommand, options);
    execution.results.push(ghResult);
    if (ghResult.exit_code !== 0) {
      execution.status = 'failed';
      execution.error = `Command failed: ${ghResult.command}`;
      await writePrCreateArtifacts(root, prepareResult, execution);
      throw new Error(execution.error);
    }
    execution.pr_url = extractPrUrl(ghResult.stdout);
  }

  const artifacts = await writePrCreateArtifacts(root, prepareResult, execution);
  return {
    story: preparation.story,
    preparation,
    execution,
    artifacts: {
      ...prepareResult.artifacts,
      ...artifacts
    }
  };
}

export function renderPrPrepareSummary(result) {
  const { preparation } = result;
  const language = preparation.output?.language ?? 'ja';
  const gateStatus = preparation.gate_status
    ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
  const firstLook = renderPrPrepareFirstLook({ preparation, gateStatus, result, language });
  return `# PR Prepare

${firstLook}

| 項目 | 内容 |
|------|------|
| Story | ${preparation.story.story_id} |
| Gate readiness | ${gateStatus.overall_status} |
| Execution gate | ${gateStatus.execution_gate?.status ?? '-'} |
| Ready for pr create | ${gateStatus.ready_for_pr_create ? 'yes' : 'no'} |
| Critical unresolved gates | ${formatUnresolvedGateList(gateStatus.critical_unresolved_gates)} |
| Completion quality | ${gateStatus.completion_quality_status ?? '-'} |
| Base | ${preparation.git.base_ref} |
| Head | ${preparation.git.head_ref} |
| Current branch | ${preparation.git.current_branch ?? '-'} |
| Changed files | ${preparation.git.changed_files.length} |
| Commits | ${preparation.git.commits.length} |
| Scope | ${preparation.scope.status} (PR size only; not completion approval) |
| Recommended strategy | ${preparation.scope.recommended_strategy} |
| Task | ${preparation.task_context?.task?.id ?? '-'} |
| Workspace | ${preparation.workspace.initialized ? 'initialized' : 'temporary artifacts'} |

## Gate Decision

- gate_dag.overall_status: ${gateStatus.overall_status}
- ready_for_pr_create: ${gateStatus.ready_for_pr_create}
- execution_gate: ${gateStatus.execution_gate?.status ?? '-'}
- unresolved_gates: ${formatUnresolvedGateList(gateStatus.unresolved_gates)}
- critical_unresolved_gates: ${formatUnresolvedGateList(gateStatus.critical_unresolved_gates)}
- next_required_actions: ${formatRequiredActions(gateStatus.next_required_actions)}
- agent_instruction: ${gateStatus.agent_instruction}

## Artifacts

- report_html: ${toDisplayPath(result.artifacts.report)}
- review_cockpit_html: ${toDisplayPath(result.artifacts.review_cockpit)}
- human_review_json: ${toDisplayPath(result.artifacts.human_review)}
- architecture_review_json: ${toDisplayPath(result.artifacts.architecture_review)}
- pr_body_markdown: ${toDisplayPath(result.artifacts.pr_body)}
- gate_dag_json: ${toDisplayPath(result.artifacts.gate_dag)}
- gate_dag_html: ${toDisplayPath(result.artifacts.gate_dag_report)}
- split_plan_json: ${toDisplayPath(result.artifacts.split_plan)}
- split_plan_html: ${toDisplayPath(result.artifacts.split_plan_report)}
- json: ${toDisplayPath(result.artifacts.json)}
`;
}

function formatRequiredActions(actions) {
  if (!actions || actions.length === 0) return 'none';
  return actions.join(' | ');
}

function renderPrPrepareFirstLook({ preparation, gateStatus, result, language }) {
  const unresolvedCount = gateStatus.unresolved_gate_count ?? gateStatus.unresolved_gates?.length ?? 0;
  const agentReviewLine = gateStatus.agent_review_instruction
    ? localizedText(language, {
        ja: `\n## Agent Review Gate\n\n- ${gateStatus.agent_review_instruction}\n`,
        en: `\n## Agent Review Gate\n\n- ${gateStatus.agent_review_instruction}\n`
      })
    : '';
  const artifactHint = [
    `review-cockpit: ${toDisplayPath(result.artifacts.review_cockpit)}`,
    `pr-body: ${toDisplayPath(result.artifacts.pr_body)}`,
    `gate-dag: ${toDisplayPath(result.artifacts.gate_dag_report)}`,
    `split-plan: ${toDisplayPath(result.artifacts.split_plan_report)}`
  ].join('\n- ');
  return localizedText(language, {
    ja: `## まず見る場所

- 状態: ${gateStatus.ready_for_pr_create ? 'PR作成可能' : '未解決Gateあり'}
- 未解決Gate: ${unresolvedCount}
- base branch: ${preparation.git.base_ref}
- .vibepro は診断・Story・PR gate・レビュー証跡を保存する作業台です。

## AIエージェントへの渡し方

- ${artifactHint}
- 実装依頼には pr-body.md を渡し、完了条件は gate-dag.html、PR分割は split-plan.html を参照させてください。
${agentReviewLine}
`,
    en: `## Where To Look First

- Status: ${gateStatus.ready_for_pr_create ? 'ready for PR creation' : 'unresolved gates remain'}
- Unresolved gates: ${unresolvedCount}
- base branch: ${preparation.git.base_ref}
- .vibepro is the workspace for diagnosis, Story, PR gate, and review evidence.

## Agent Handoff

- ${artifactHint}
- Hand pr-body.md to the coding agent, use gate-dag.html as the completion contract, and use split-plan.html for PR splitting.
${agentReviewLine}
`
  });
}

function buildPrPrepareGateStatus(gateDag, completionQuality = null) {
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag);
  const criticalGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const overallStatus = gateDag?.overall_status ?? 'unknown';
  const executionGate = buildExecutionGateStatus(gateDag);
  const readyForPrCreate = executionGate.pr_create_allowed === true && unresolvedGates.length === 0;
  const agentReviewAction = buildAgentReviewGateInstruction(unresolvedGates);
  return {
    schema_version: '0.1.0',
    overall_status: overallStatus,
    ready_for_pr_create: readyForPrCreate,
    execution_gate: executionGate,
    completion_quality_status: completionQuality?.status ?? null,
    unresolved_gate_count: unresolvedGates.length,
    critical_unresolved_gate_count: criticalGates.length,
    unresolved_gates: unresolvedGates,
    critical_unresolved_gates: criticalGates,
    next_required_actions: executionGate.required_actions,
    agent_review_instruction: agentReviewAction,
    agent_review_dispatch_required: Boolean(agentReviewAction),
    agent_review_user_confirmation_required_by_vibepro: false,
    agent_review_runner_policy_may_require_user_delegation: false,
    agent_instruction: readyForPrCreate
      ? 'Gate DAG is ready_for_review; pr create may proceed if scope and branch checks are acceptable.'
      : [
          'Do not treat scope.status=reviewable as completion approval. Resolve Gate DAG evidence before pr create.',
          agentReviewAction
        ].filter(Boolean).join(' ')
  };
}

function buildExecutionGateStatus(gateDag) {
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag);
  const blockingGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const status = blockingGates.length > 0
    ? 'blocked'
    : unresolvedGates.length > 0
      ? 'waiver_required'
      : 'ready';
  return {
    schema_version: '0.1.0',
    status,
    pr_create_allowed: status === 'ready',
    waiver_required: status === 'waiver_required',
    blocking_gate_count: blockingGates.length,
    blocking_gates: blockingGates,
    required_actions: (blockingGates.length > 0 ? blockingGates : unresolvedGates).map(formatExecutionGateAction)
  };
}

function formatExecutionGateAction(gate) {
  if (gate.id === 'gate:e2e') return `Record current-head E2E evidence for ${gate.label ?? gate.id}: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:visual_qa') return `Record Visual QA evidence for UI changes: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:network_contract') return `Resolve Network Contract evidence: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:agent_review') {
    return (gate.required_actions?.length ?? 0) > 0
      ? gate.required_actions.join(' ')
      : `Run VibePro Agent Review workflow for the current git state: ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'architecture') return `Add ADR or explicit ADR-unnecessary decision: ${gate.reason ?? gate.status}`;
  if (gate.id === 'spec') return `Regenerate or fix Spec evidence: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:requirement') return `Resolve Requirement Gate findings: ${gate.reason ?? gate.status}`;
  if (gate.id === 'story') return `Attach a resolvable Story source: ${gate.reason ?? gate.status}`;
  return `Resolve ${gate.label ?? gate.id}: ${gate.reason ?? gate.status}`;
}

function buildAgentReviewGateInstruction(unresolvedGates) {
  const agentGate = unresolvedGates.find((gate) => gate.id === 'gate:agent_review');
  if (!agentGate) return null;
  const actions = agentGate.required_actions ?? [];
  const actionText = actions.length > 0 ? ` Required actions: ${actions.join(' ')}` : '';
  return `Agent Review Gate requires staged role reviews. Run the listed \`vibepro review prepare\` command(s), dispatch the generated Codex/Claude Code subagent reviews in parallel when the coordinator runtime provides subagent capability, close/shutdown each review subagent after receiving its result, record each result with \`vibepro review record --execution-mode parallel_subagent --agent-closed\`, then rerun \`vibepro pr prepare\`. If the runtime has no subagent capability, block or record a human waiver decision; do not silently skip the gate.${actionText}`;
}

export function renderPrCreateSummary(result) {
  const { execution } = result;
  const commandRows = execution.commands.map((command) => `- \`${command}\``).join('\n');
  const resultRows = execution.results.length === 0
    ? '- dry-run'
    : execution.results.map((item) => `- ${item.command}: exit=${item.exit_code}`).join('\n');
  const warnings = execution.warnings.length === 0
    ? '- なし'
    : execution.warnings.map((item) => `- ${item}`).join('\n');
  return `# PR Create

| 項目 | 内容 |
|------|------|
| Story | ${execution.story.story_id} |
| Task | ${execution.task_context?.task?.id ?? '-'} |
| Base | ${execution.base} |
| Head | ${execution.head} |
| Title | ${execution.title} |
| Dry run | ${execution.dry_run} |
| PR URL | ${execution.pr_url ?? '-'} |
| Gate | ${execution.gate_dag?.overall_status ?? '-'} |
| Gate override | ${execution.gate_override?.allowed ? 'used' : 'none'} |

## Commands

${commandRows}

## Results

${resultRows}

## Warnings

${warnings}

## Artifacts

- pr_body: ${toDisplayPath(result.artifacts.pr_body)}
- pr_create: ${toDisplayPath(result.artifacts.pr_create_json)}
`;
}

async function readWorkspaceState(repoRoot) {
  try {
    const config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
    return {
      initialized: true,
      config
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      initialized: false,
      config: {
        brainbase: {
          stories: DEFAULT_BRAINBASE_STORIES
        }
      }
    };
  }
}

function createTransientManifest() {
  return {
    runs: [],
    latest_run_by_story: {}
  };
}

async function collectGitState(repoRoot, options) {
  const currentBranch = await gitOptional(repoRoot, ['branch', '--show-current']);
  const baseRef = options.baseRef ?? await resolveBaseRef(repoRoot);
  const headRef = options.headRef ?? 'HEAD';
  const includesDirtyInChangedFiles = !options.headRef;
  const headSha = await gitOptional(repoRoot, ['rev-parse', headRef]);
  const committedChangedFiles = await getChangedFiles(repoRoot, baseRef, headRef);
  const commits = await getCommits(repoRoot, baseRef, headRef);
  const commitMessageHealth = buildCommitMessageHealth(commits, { baseRef, headRef });
  const statusOutput = await gitStatus(repoRoot, ['status', '--porcelain', '-uall']);
  const dirtyDiff = await collectDirtyDiff(repoRoot);
  const dirtyFiles = parseStatus(statusOutput);
  const changedFiles = includesDirtyInChangedFiles
    ? mergeChangedAndDirtyFiles(committedChangedFiles, dirtyFiles)
    : committedChangedFiles;
  return {
    current_branch: currentBranch || null,
    base_ref: baseRef,
    head_ref: headRef,
    head_sha: headSha || null,
    dirty: dirtyFiles.length > 0,
    status_fingerprint_hash: hashFingerprint(fingerprintStatus(statusOutput, dirtyDiff)),
    changed_files: changedFiles,
    dirty_files: dirtyFiles,
    includes_dirty_in_changed_files: includesDirtyInChangedFiles,
    commit_message_health: commitMessageHealth,
    commits
  };
}

function mergeChangedAndDirtyFiles(changedFiles, dirtyFiles) {
  const byPath = new Map(changedFiles.map((file) => [file.path, file]));
  for (const dirty of dirtyFiles) {
    if (!dirty.path || byPath.has(dirty.path)) continue;
    byPath.set(dirty.path, {
      status: dirty.status || 'M',
      path: dirty.path
    });
  }
  return [...byPath.values()];
}

async function resolveBaseRef(repoRoot) {
  const originHead = await gitOptional(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) return originHead.replace(/^origin\//, 'origin/');
  for (const ref of ['origin/develop', 'origin/main', 'develop', 'main', 'master']) {
    if (await gitRefExists(repoRoot, ref)) return ref;
  }
  return 'HEAD~1';
}

async function getChangedFiles(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['diff', '--name-status', `${baseRef}...${headRef}`])
    || await git(repoRoot, ['diff', '--name-status', baseRef, headRef]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseNameStatus);
}

async function getCommits(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['log', '--format=%H%x09%s', `${baseRef}..${headRef}`]);
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf('\t');
      const sha = separatorIndex === -1 ? line.trim() : line.slice(0, separatorIndex).trim();
      const message = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
      return {
        sha,
        short_sha: sha.slice(0, 12),
        message,
        message_empty: message.trim().length === 0
      };
    });
}

function buildCommitMessageHealth(commits, { baseRef, headRef }) {
  const emptyMessageCommits = commits.filter((commit) => commit.message_empty);
  return {
    schema_version: '0.1.0',
    range: `${baseRef}..${headRef}`,
    scope: 'base_head',
    commit_count: commits.length,
    empty_message_count: emptyMessageCommits.length,
    empty_message_commits: emptyMessageCommits.map((commit) => ({
      sha: commit.sha,
      short_sha: commit.short_sha
    })),
    status: emptyMessageCommits.length > 0 ? 'needs_review' : 'pass',
    ignored_internal_ref_patterns: [
      'refs/jj/keep/*'
    ],
    note: 'PR readiness uses the explicit base..head range; internal refs such as refs/jj/keep/* are not treated as PR commits.'
  };
}

function parseNameStatus(line) {
  const parts = line.split('\t');
  const status = parts[0];
  return {
    status,
    path: parts[parts.length - 1]
  };
}

function parseStatus(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3)
    }));
}

function fingerprintStatus(statusOutput, dirtyDiff = '') {
  return [
    'git-status --porcelain -uall',
    String(statusOutput ?? '').trimEnd(),
    'git-diff --binary',
    String(dirtyDiff ?? '').trimEnd()
  ].join('\n');
}

function hashFingerprint(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex');
}

function fingerprintHashForContext(gitContext) {
  if (gitContext?.status_fingerprint_hash) return gitContext.status_fingerprint_hash;
  return hashFingerprint(gitContext?.status_fingerprint ?? '');
}

async function collectDirtyDiff(repoRoot) {
  const [unstaged, staged, untracked] = await Promise.all([
    gitOptional(repoRoot, ['diff', '--binary']),
    gitOptional(repoRoot, ['diff', '--cached', '--binary']),
    collectUntrackedFileFingerprint(repoRoot)
  ]);
  return [staged, unstaged, untracked].filter(Boolean).join('\n');
}

async function collectUntrackedFileFingerprint(repoRoot) {
  const output = await gitOptional(repoRoot, ['ls-files', '--others', '--exclude-standard']);
  const files = output.split('\n').filter(Boolean).sort().slice(0, 200);
  const chunks = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(repoRoot, file), 'utf8');
      chunks.push(`untracked:${file}\n${content}`);
    } catch {
      chunks.push(`untracked:${file}\n<unreadable>`);
    }
  }
  return chunks.join('\n');
}

function groupChangedFiles(files) {
  const groups = {
    story_docs: [],
    architecture_docs: [],
    specifications: [],
    policy_docs: [],
    source: [],
    tests: [],
    repo_control: [],
    vibepro_artifacts: [],
    other: []
  };

  for (const file of files) {
    const target = file.path;
    if (isStoryDocPath(target)) groups.story_docs.push(file);
    else if (isArchitectureDocPath(target)) groups.architecture_docs.push(file);
    else if (isSpecificationDocPath(target)) groups.specifications.push(file);
    else if (isPolicyDocPath(target)) groups.policy_docs.push(file);
    else if (target.startsWith('test/') || target.startsWith('tests/') || target.startsWith('e2e/') || target.includes('/__tests__/') || /\.(test|spec)\.[jt]sx?$/.test(target)) groups.tests.push(file);
    else if (isSourcePath(target)) groups.source.push(file);
    else if (target.startsWith('.vibepro/')) groups.vibepro_artifacts.push(file);
    else if (isRepoControlPath(target)) groups.repo_control.push(file);
    else groups.other.push(file);
  }

  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, {
      count: value.length,
      files: value.map((file) => file.path)
    }])
  );
}

function isSourcePath(filePath) {
  return filePath.startsWith('src/')
    || filePath.startsWith('app/')
    || filePath.startsWith('pages/')
    || filePath.startsWith('components/')
    || filePath.startsWith('public/modules/')
    || filePath.startsWith('server/')
    || filePath.startsWith('lib/')
    || filePath.startsWith('api/')
    || filePath.startsWith('mcp/')
    || filePath.startsWith('scripts/');
}

function isRepoControlPath(filePath) {
  return filePath.startsWith('.claude/')
    || filePath.startsWith('.github/')
    || /^tsconfig(\..+)?\.json$/.test(filePath)
    || /^playwright\.config\.[cm]?[jt]s$/.test(filePath)
    || [
      'AGENTS.md',
      'CLAUDE.md',
      '.gitignore',
      '.vibeproignore',
      'package.json',
      'package-lock.json'
    ].includes(filePath);
}

function isArchitectureDocPath(filePath) {
  return filePath.startsWith('docs/architecture/')
    || filePath.startsWith('docs/management/architecture/')
    || /^docs\/.+\/ADR-[^/]+\.md$/i.test(filePath);
}

function isSpecificationDocPath(filePath) {
  return filePath.startsWith('docs/specs/')
    || filePath.startsWith('docs/features/specifications/')
    || /^docs\/.+\/[^/]*(spec|specification)[^/]*\.md$/i.test(filePath);
}

function isPolicyDocPath(filePath) {
  return filePath.startsWith('docs/frames/')
    || filePath.startsWith('docs/management/policies/')
    || filePath.startsWith('docs/00-glossary/');
}

function assessScope({ changedFiles, fileGroups, dirtyFiles, dirtyFilesAffectScope = true, commits, maxReviewableFiles }) {
  const reasons = [];
  if (changedFiles.length > maxReviewableFiles) {
    reasons.push(`差分が ${changedFiles.length} files あり、レビュー可能な目安 ${maxReviewableFiles} files を超えている`);
  }
  if (hasMixedRepoControlChanges(fileGroups)) {
    reasons.push('repo制御ファイルやagent設定が差分に含まれている');
  }
  const nonWorkspaceDirty = dirtyFiles.filter((file) => !file.path.startsWith('.vibepro/'));
  if (dirtyFilesAffectScope && nonWorkspaceDirty.length > 0) {
    reasons.push(`未コミット差分が ${nonWorkspaceDirty.length} files 残っている`);
  }
  if (commits.length > 1) {
    reasons.push(`baseからのcommitが ${commits.length} 件あり、Story外の変更混入を確認する必要がある`);
  }
  const emptyMessageCommits = commits.filter((commit) => commit.message_empty);
  if (emptyMessageCommits.length > 0) {
    reasons.push(`commit messageが空のcommitが ${emptyMessageCommits.length} 件あり、PR履歴として意味を確認できない`);
  }

  const needsCleanBranch = reasons.length > 0;
  return {
    status: needsCleanBranch ? 'needs_clean_branch' : 'reviewable',
    recommended_strategy: needsCleanBranch ? 'clean_branch_or_split_pr' : 'current_branch_pr',
    reasons,
    reviewable_file_limit: maxReviewableFiles,
    changed_file_count: changedFiles.length
  };
}

function hasMixedRepoControlChanges(fileGroups) {
  if (fileGroups.repo_control.count === 0) return false;
  const nonRepoGroups = [
    fileGroups.story_docs,
    fileGroups.architecture_docs,
    fileGroups.specifications,
    fileGroups.policy_docs,
    fileGroups.source,
    fileGroups.other
  ];
  return nonRepoGroups.some((group) => group.count > 0);
}

function buildNextCommands({ baseRef, currentBranch, suggestedBranch, commits, scope, storyId, taskId = null, groupId = null, gateStatus = null }) {
  const prCreateCommand = [
    'npx vibepro pr create .',
    storyId ? `--story-id ${storyId}` : null,
    taskId ? `--task ${taskId}` : null,
    groupId ? `--group ${groupId}` : null,
    `--base ${baseRef}`
  ].filter(Boolean).join(' ');
  const prPrepareCommand = [
    'npx vibepro pr prepare .',
    storyId ? `--story-id ${storyId}` : null,
    taskId ? `--task ${taskId}` : null,
    groupId ? `--group ${groupId}` : null
  ].filter(Boolean).join(' ');

  if (scope.recommended_strategy === 'current_branch_pr') {
    if (gateStatus && gateStatus.ready_for_pr_create === false) {
      return buildBlockedNextCommands({ storyId, taskId, groupId, gateStatus });
    }

    return [
      currentBranch
        ? `${prCreateCommand} --head ${currentBranch}`
        : prCreateCommand
    ];
  }

  const firstCommit = commits[0]?.sha ?? '<commit-sha>';
  return [
    `git switch -c ${suggestedBranch} ${baseRef}`,
    commits.length === 1
      ? `git cherry-pick ${firstCommit}`
      : `git cherry-pick <story-related-commit-sha>`,
    gateStatus && gateStatus.ready_for_pr_create === false
      ? prPrepareCommand
      : `${prCreateCommand} --head ${suggestedBranch}`
  ];
}

function buildBlockedNextCommands({ storyId, taskId = null, groupId = null, gateStatus }) {
  const commands = [];
  const storyArgs = [
    storyId ? `--id ${storyId}` : null,
    taskId ? `--task ${taskId}` : null,
    groupId ? `--group ${groupId}` : null
  ].filter(Boolean).join(' ');
  const prStoryArgs = [
    storyId ? `--story-id ${storyId}` : null,
    taskId ? `--task ${taskId}` : null,
    groupId ? `--group ${groupId}` : null
  ].filter(Boolean).join(' ');
  const blockingGateIds = new Set((gateStatus.execution_gate?.blocking_gates ?? []).map((gate) => gate.id));

  if (blockingGateIds.has('gate:agent_review')) {
    commands.push(`npx vibepro review status . ${storyArgs}`.trim());
  }

  if (blockingGateIds.has('gate:verification')) {
    commands.push(`npx vibepro verify record . ${storyArgs} --kind <unit|integration|e2e> --status pass --command "<command>" --summary "<summary>"`.trim());
  }

  if (blockingGateIds.has('gate:e2e')) {
    commands.push(`npx vibepro verify flow . ${storyArgs} --base-url http://localhost:<port>`.trim());
  }

  if (commands.length === 0) {
    commands.push(`npx vibepro review status . ${storyArgs}`.trim());
  }

  commands.push(`npx vibepro pr prepare . ${prStoryArgs}`.trim());
  return commands;
}

function renderPrNarrative(narrative) {
  if (!narrative || !Array.isArray(narrative.narrative_slots) || narrative.narrative_slots.length === 0) {
    return '';
  }
  const grouped = new Map();
  for (const slot of narrative.narrative_slots) {
    if (!slot || typeof slot !== 'object' || typeof slot.slot !== 'string') continue;
    if (!grouped.has(slot.slot)) grouped.set(slot.slot, []);
    grouped.get(slot.slot).push(slot);
  }
  const sections = [];
  const callerLabel = narrative.generated_by?.caller ?? 'unknown';
  const summary = grouped.get('summary')?.[0];
  if (summary) {
    sections.push(`## なぜこの PR か (${summary.id} by ${callerLabel})\n${summary.text.trim()}`);
  }
  const focus = grouped.get('review_focus') ?? [];
  if (focus.length > 0) {
    const lines = focus.map((slot) => `- (${slot.id}) ${slot.text.trim()}`).join('\n');
    sections.push(`## レビュー焦点 (synthesis)\n${lines}`);
  }
  const risks = grouped.get('risks_synthesis')?.[0];
  if (risks) {
    sections.push(`## リスク合成 (${risks.id})\n${risks.text.trim()}`);
  }
  const openQuestions = grouped.get('open_questions') ?? [];
  if (openQuestions.length > 0) {
    const lines = openQuestions.map((slot) => `- (${slot.id}) ${slot.text.trim()}`).join('\n');
    sections.push(`## レビュアー判断要\n${lines}`);
  }
  if (sections.length === 0) return '';
  return `${sections.join('\n\n')}\n\n`;
}

function renderPrBody({ story, taskContext, git, fileGroups, latestStoryRun, scope, prContext, splitPlan, narrative = null, language = 'ja' }) {
  const narrativeSection = renderPrNarrative(narrative);
  const decisionSection = renderPrDecisionSection({ story, git, fileGroups, scope, prContext, splitPlan });
  const reviewerChangeMap = renderReviewerChangeMap(fileGroups);
  const explicitNonGoals = renderExplicitNonGoals({ git, fileGroups });
  const source = prContext.story_source;
  const storyLabel = formatPrStoryLabel(story, source);
  const requirementTitle = source.requirement_title ?? source.title ?? story.title ?? story.story_id;
  const changeSummary = prContext.change_summary.length === 0
    ? '- 差分なし'
    : prContext.change_summary.map((item) => `- ${item}`).join('\n');
  const acceptance = source.acceptance_criteria.length === 0
    ? '- Story文書から受け入れ基準を抽出できませんでした'
    : source.acceptance_criteria.map((item) => `- ${item}`).join('\n');
  const verification = prContext.verification_commands.length === 0
    ? '- [ ] 手動確認または対象テストを追記する'
    : renderVerificationChecklist(prContext.verification_commands, prContext.gate_dag);
  const reviewPoints = prContext.review_points.map((item) => `- ${item}`).join('\n');
  const risks = prContext.risks.length === 0
    ? '- 特記事項なし'
    : prContext.risks.map((item) => `- ${item}`).join('\n');
  const gateSummary = renderPrGateSummary(prContext.gate_dag);
  const gateEnforcement = renderPrGateEnforcement(prContext.gate_dag);
  const executionGateSection = renderPrExecutionGate(prContext.execution_gate);
  const taskSection = renderPrTaskSection(taskContext);
  const refactoringDeltaSection = renderPrRefactoringDelta(prContext.refactoring_delta);
  const flowVerificationSection = renderPrFlowVerification(prContext.flow_verification);
  const visualQaSection = renderPrVisualQaEvidence(prContext.visual_qa);
  const completionQualitySection = renderPrCompletionQuality(prContext.completion_quality);
  const performanceEvidenceSection = renderPerformancePrSection(prContext.performance_evidence);
  const agentReviewSection = renderAgentReviewPrSection(prContext.agent_reviews);
  const exploreEvidenceSection = renderExplorePrSection(prContext.explore_evidence);
  const handoffSection = renderPrAgentHandoff({ prContext, splitPlan, language });

  return `${decisionSection}

${narrativeSection}## 変更内容
${changeSummary}

## なぜこの変更か
- 要求: ${requirementTitle}
${source.background ? `- 背景: ${source.background}` : '- 背景: Story文書から抽出できませんでした'}
${source.requirement_id ? `- 要求ID: ${source.requirement_id}` : ''}
${source.requirement_url ? `- 要求URL: ${source.requirement_url}` : ''}

## レビューしてほしい観点
${reviewPoints || '- Story / ADR / Spec と実装差分が対応しているか'}

## 検証
${verification}

## リスク・確認事項
${risks}

## 明示的にやらないこと
${explicitNonGoals}

## レビュアー向け差分分類
${reviewerChangeMap}

## 監査ログ
- ここから下は VibePro の機械証跡です。レビュー・マージ判断は上部の判断、変更内容、レビュー観点、検証、リスクを先に確認してください。
- Gate / Agent Review / split plan / 実行メタデータは詳細確認と再現性のために残します。

## 概要
- Story: ${storyLabel}
- VibePro scope: ${scope.status}
- PR strategy: ${scope.recommended_strategy}
- 変更ファイル: ${git.changed_files.length} files

## 背景・要求
- 正本: ${source.path ?? 'Story未検出'}
- 要求: ${requirementTitle}
${source.requirement_id ? `- 要求ID: ${source.requirement_id}` : ''}
${source.requirement_url ? `- 要求URL: ${source.requirement_url}` : ''}
${source.background ? `- 背景: ${source.background}` : '- 背景: Story文書から抽出できませんでした'}

## 実装判断
- ADR: ${prContext.architecture_decision}
- Scope: ${scope.status}
${scope.reasons.length === 0 ? '- Scope理由: current branchのままPR化可能' : scope.reasons.map((reason) => `- Scope理由: ${reason}`).join('\n')}

${taskSection}

## 受け入れ基準
${acceptance}

## 差分分類
${Object.entries(fileGroups)
    .filter(([, value]) => value.count > 0)
    .map(([key, value]) => `- ${key}: ${value.count}`)
    .join('\n') || '- なし'}

## 要件整合性
${renderRequirementPrSection(prContext.requirement_consistency, language)}

## Network Contract
${renderNetworkContractPrSection(prContext.network_contracts)}

## Agent Review
${agentReviewSection}

## Explore Evidence
${exploreEvidenceSection}

## Gate DAG
${gateSummary}

## Gate Enforcement
${gateEnforcement}

${executionGateSection}

${handoffSection}

${flowVerificationSection}

${visualQaSection}

${completionQualitySection}

${performanceEvidenceSection}

${refactoringDeltaSection}

## 分割計画
${renderPrSplitSection(splitPlan)}

## VibePro
- latest story run: ${latestStoryRun?.run_id ?? '-'}
- gate: ${latestStoryRun?.gate_status ?? '-'}
- PR strategy: ${scope.recommended_strategy}
- runtime: ${renderRuntimeSummary(prContext, story)}
`;
}

function renderPrDecisionSection({ story, git, fileGroups, scope, prContext, splitPlan }) {
  const executionGate = prContext.execution_gate;
  const unresolved = collectUnresolvedRequiredGates(prContext.gate_dag);
  const decision = buildHumanMergeDecision({ executionGate, unresolved, scope });
  const primaryReviewAreas = buildPrimaryReviewAreas(fileGroups);
  const storyLabel = formatPrStoryLabel(story, prContext.story_source);
  const gateNote = unresolved.length === 0
    ? '未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。'
    : `未解決Gateがあります（対象: ${formatHumanGateSummary(unresolved)}）。詳細は監査ログの Gate DAG / Gate Enforcement を確認し、blocking か waiver 可能かを判断してください。`;
  const scopeNote = buildScopeDecisionNote(scope, splitPlan);
  return `## このPRで決めたいこと
- Story: ${storyLabel}
- 判断: ${decision}
- レビュー入口: ${primaryReviewAreas}
- Gate状況: ${gateNote}
- Scope判断: ${scopeNote}
- 変更規模: ${git.changed_files.length} files`;
}

function formatPrStoryLabel(story, source = {}) {
  const storyId = story?.story_id ?? source?.story_id ?? 'unknown-story';
  const title = source?.requirement_title ?? source?.title ?? story?.title ?? null;
  if (!title || title === storyId) return storyId;
  return `${storyId} - ${title}`;
}

function buildHumanMergeDecision({ executionGate, unresolved, scope }) {
  if (executionGate?.pr_create_allowed === true && unresolved.length === 0) {
    return 'VibePro Gate上はPR作成可能。人間レビューでは設計判断・スコープ・運用影響を確認する。';
  }
  const blocking = executionGate?.blocking_gate_count ?? unresolved.length;
  if (blocking > 0) {
    return `まだマージ判断前。${blocking}件のcritical/blocking Gateを解消するか、非criticalのみ理由付きwaiverを記録する。`;
  }
  if (scope.status === 'needs_clean_branch') {
    return '差分範囲の説明が必要。PRを分割するか、同一PRに含める理由を本文で確認する。';
  }
  return '実装差分とStory/Spec/Architectureの対応を確認し、残る注意事項が許容できるか判断する。';
}

function buildScopeDecisionNote(scope, splitPlan) {
  const reasons = scope.reasons?.length > 0 ? scope.reasons.join('; ') : 'current branchのままPR化可能';
  const split = splitPlan?.recommended_strategy ? `split=${splitPlan.recommended_strategy}` : 'split=-';
  if (scope.status === 'needs_clean_branch') {
    return `差分範囲の説明または分割判断が必要。理由: ${reasons} / ${split}`;
  }
  return `${scope.status}: ${reasons} / ${split}`;
}

function formatHumanGateSummary(gates) {
  const labels = [];
  for (const gate of gates ?? []) {
    let label = gate.label ?? gate.id ?? 'Gate';
    if (String(gate.id ?? '').startsWith('review:') || String(gate.id ?? '') === 'gate:agent_review') {
      label = 'Agent Review Gate';
    }
    if (!labels.includes(label)) labels.push(label);
  }
  const visible = labels.slice(0, 4);
  const remaining = Math.max(0, labels.length - visible.length);
  return remaining > 0 ? `${visible.join(', ')} ほか${remaining}件` : (visible.join(', ') || 'Gate details');
}

function buildPrimaryReviewAreas(fileGroups) {
  const areas = [];
  if (fileGroups.source?.count > 0) areas.push('Runtime');
  if (fileGroups.architecture_docs?.count > 0 || fileGroups.specifications?.count > 0 || fileGroups.story_docs?.count > 0) {
    areas.push('Contract Docs');
  }
  if (collectCapabilityFiles(fileGroups).length > 0) areas.push('Capability Map');
  if (fileGroups.tests?.count > 0) areas.push('Tests');
  if (fileGroups.repo_control?.count > 0) areas.push('Repo Control');
  return areas.length > 0 ? areas.join(' / ') : '差分なし';
}

function renderReviewerChangeMap(fileGroups) {
  const rows = [
    ['Runtime', fileGroups.source?.files ?? [], '実装・実行時挙動の変更'],
    ['Contract Docs', collectContractDocFiles(fileGroups), 'Story / Spec / Architecture / 方針の変更'],
    ['Capability Map', collectCapabilityFiles(fileGroups), '能力定義・運用境界の変更'],
    ['Tests', fileGroups.tests?.files ?? [], '自動テスト・E2E・検証コード'],
    ['Repo Control', fileGroups.repo_control?.files ?? [], 'package / CI / repository control']
  ];
  const rendered = rows
    .filter(([, files]) => files.length > 0)
    .map(([label, files, description]) => `- ${label}: ${files.length} files - ${description}: ${formatFileList(files)}`);
  return rendered.join('\n') || '- なし';
}

function collectContractDocFiles(fileGroups) {
  return [
    ...(fileGroups.story_docs?.files ?? []),
    ...(fileGroups.architecture_docs?.files ?? []),
    ...(fileGroups.specifications?.files ?? []),
    ...(fileGroups.policy_docs?.files ?? [])
  ];
}

function collectCapabilityFiles(fileGroups) {
  const files = Object.values(fileGroups)
    .flatMap((group) => group?.files ?? []);
  return [...new Set(files.filter((file) => /(^|\/)(capabilit(?:y|ies)|capability-map|capabilities)(\/|\.|-|$)/i.test(file)))];
}

function renderExplicitNonGoals({ git, fileGroups }) {
  const changed = git.changed_files.map((file) => file.path);
  const lines = [
    '- 変更ファイル外の既存挙動は、このPRの完了保証対象外',
    '- Gate / Agent Review の詳細証跡は監査ログとして残すが、本文上部のレビュー範囲を広げるものではない'
  ];
  if (!changed.some(isApiRoutePath)) {
    lines.push('- API route / external API contract の追加・置換はスコープ外');
  }
  if (!hasUiExperienceSourceChange(fileGroups)) {
    lines.push('- Browser UI の表示・操作体験変更はスコープ外');
  }
  if ((fileGroups.tests?.count ?? 0) === 0) {
    lines.push('- 新規/更新テストは差分に含まれていないため、検証欄の未完了項目を確認する');
  }
  return lines.join('\n');
}

function isApiRoutePath(filePath) {
  return /(^|\/)(api|routes)(\/|$)/.test(filePath)
    || /(^|\/)route\.[cm]?[jt]sx?$/.test(filePath)
    || /(^|\/)controller(s)?\//.test(filePath);
}

function renderVerificationChecklist(commands, gateDag) {
  const seenCommands = new Set(commands.map((item) => item.command).filter(Boolean));
  const commandItems = commands.map((item) => {
    const gate = findGateForVerificationCommand(item, gateDag);
    const passed = gate && ['passed', 'pass'].includes(gate.status);
    const commandMatchesEvidence = !gate?.command || gate.command === item.command;
    const checked = passed && commandMatchesEvidence ? 'x' : ' ';
    const status = gate?.status
      ? ` / gate: ${gate.status}${passed && !commandMatchesEvidence ? ` via \`${gate.command}\`` : ''}`
      : '';
    const evidence = gate?.evidence?.artifact ? ` / evidence: ${gate.evidence.artifact}` : '';
    return `- [${checked}] \`${item.command}\` - ${item.reason}${status}${evidence}`;
  });
  const evidenceOnlyItems = (gateDag?.nodes ?? [])
    .filter((gate) => gate.type === 'verification_gate')
    .filter((gate) => gate.command && gate.evidence && !seenCommands.has(gate.command))
    .map((gate) => {
      const checked = ['passed', 'pass'].includes(gate.status) ? 'x' : ' ';
      const evidence = gate.evidence?.artifact ? ` / evidence: ${gate.evidence.artifact}` : '';
      return `- [${checked}] \`${gate.command}\` - ${gate.reason ?? gate.label}${gate.status ? ` / gate: ${gate.status}` : ''}${evidence}`;
    });
  return [...commandItems, ...evidenceOnlyItems].join('\n');
}

function findGateForVerificationCommand(command, gateDag) {
  const kind = command.kind === 'flow' ? 'e2e' : command.kind;
  const gateIdByKind = {
    unit: 'gate:unit',
    test: 'gate:unit',
    integration: 'gate:integration',
    typecheck: 'gate:integration',
    build: 'gate:integration',
    e2e: 'gate:e2e'
  };
  const expectedId = gateIdByKind[kind];
  const gates = gateDag?.nodes ?? [];
  if (expectedId) return gates.find((gate) => gate.id === expectedId) ?? null;
  return gates.find((gate) => gate.command === command.command) ?? null;
}

function renderPrExecutionGate(executionGate) {
  if (!executionGate) {
    return `## Execution Gate
- status: unknown
- pr_create_allowed: false`;
  }
  const actions = executionGate.required_actions?.length > 0
    ? executionGate.required_actions.map((item) => `- required: ${item}`).join('\n')
    : '- required: none';
  return `## Execution Gate
- status: ${executionGate.status}
- pr_create_allowed: ${executionGate.pr_create_allowed}
- blocking_gate_count: ${executionGate.blocking_gate_count}
${actions}`;
}

function renderPrAgentHandoff({ prContext, splitPlan, language = 'ja' }) {
  const unresolved = collectUnresolvedRequiredGates(prContext.gate_dag);
  return localizedText(language, {
    ja: `## AI Agent Handoff
- 目的: Story / Spec / Gate DAG に沿って実装し、未解決Gateを解消する
- 最初に見る: このPR本文、review-cockpit.html、gate-dag.html、split-plan.html
- 未解決Gate: ${formatUnresolvedGateList(unresolved)}
- PR分割方針: ${splitPlan?.recommended_strategy ?? '-'}
- 注意: scope.status=reviewable は完了承認ではありません。Execution Gateがreadyになるまで証跡を追加してください。`,
    en: `## AI Agent Handoff
- Goal: implement against Story / Spec / Gate DAG and resolve unresolved gates
- Read first: this PR body, review-cockpit.html, gate-dag.html, split-plan.html
- Unresolved gates: ${formatUnresolvedGateList(unresolved)}
- PR split strategy: ${splitPlan?.recommended_strategy ?? '-'}
- Note: scope.status=reviewable is not completion approval. Add evidence until Execution Gate is ready.`
  });
}

function renderRuntimeSummary(prContext, story) {
  const toolchain = prContext.toolchain ?? null;
  if (!toolchain) return 'not recorded';
  const git = toolchain.source_git ?? {};
  const version = toolchain.package?.version ?? 'unknown';
  const commit = git.commit ? git.commit.slice(0, 12) : 'no-git';
  const branch = git.branch ?? 'detached/package';
  const dirty = git.dirty ? 'dirty' : 'clean';
  const storyLabel = story?.story_id ? `story=${story.story_id}` : 'story=unknown';
  return `vibepro@${version} ${commit} ${branch} ${dirty} (${storyLabel})`;
}

function renderPrSplitSection(splitPlan) {
  if (!splitPlan) return '- Split plan未生成';
  const lanes = splitPlan.lanes.map((lane) => [
    `- ${lane.id}: ${lane.title}`,
    `  - recommendation: ${lane.recommendation}`,
    `  - files: ${lane.file_count}`,
    lane.graph_investigation_files.length > 0
      ? `  - graph investigation: ${formatFileList(lane.graph_investigation_files)}`
      : null
  ].filter(Boolean).join('\n')).join('\n');
  return [
    `- status: ${splitPlan.status}`,
    `- strategy: ${splitPlan.recommended_strategy}`,
    `- graphify: ${splitPlan.graph_context.available ? `${splitPlan.graph_context.matched_file_count} matched files / ${splitPlan.graph_context.related_file_count} related files` : splitPlan.graph_context.reason}`,
    `- stacked gates: cumulative=${splitPlan.stacked_gate_plan.summary.cumulative_gate_count}, final validation required=${splitPlan.stacked_gate_plan.final_validation.required}`,
    lanes || '- lanesなし'
  ].join('\n');
}

function renderPrTaskSection(taskContext) {
  if (!taskContext) return '## Task / Handoff\n- Task指定なし';
  const acceptance = taskContext.task.acceptance_criteria?.length > 0
    ? taskContext.task.acceptance_criteria.map((item) => `- ${item}`).join('\n')
    : '- Task完了条件なし';
  const references = Object.entries(taskContext.artifacts)
    .filter(([, value]) => value)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n');
  return `## Task / Handoff
- Task: ${taskContext.task.id} ${taskContext.task.title}
- Priority: ${taskContext.task.priority ?? '-'}
- Source: ${taskContext.task.source_type ?? '-'}
- Handoff: ${taskContext.artifacts.handoff_json ?? '-'}

### Task完了条件
${acceptance}

### Task成果物
${references || '- なし'}`;
}

function renderPrRefactoringDelta(delta) {
  if (!delta || delta.status === 'no_baseline') {
    return `## VibePro refactoring delta
- 前回の同一Story診断runがないため、差分は未算出`;
  }
  if (delta.status === 'no_refactoring_opportunities') {
    return `## VibePro refactoring delta
- 比較対象の両runにリファクタリング機会なし`;
  }
  const rows = (delta.top_improvements ?? []).slice(0, 5).map((item) => (
    `- ${item.title ?? item.key}: ${formatCounts(item.before)} -> ${formatCounts(item.after)} (${formatPrDeltaStatus(item.status)})`
  ));
  const regressions = (delta.top_regressions ?? []).slice(0, 3).map((item) => (
    `- ${item.title ?? item.key}: ${formatCounts(item.before)} -> ${formatCounts(item.after)} (${formatPrDeltaStatus(item.status)})`
  ));
  const remaining = (delta.top_remaining ?? []).slice(0, 5).map((item) => (
    `- ${item.title ?? item.key}: ${formatCounts(item.after)} (${item.refactoring_intent ?? '-'})`
  ));
  return `## VibePro refactoring delta
- before: ${delta.before_run_id ?? '-'}
- after: ${delta.after_run_id ?? '-'}
- 改善: ${delta.summary?.improved ?? 0}件 / 解消: ${delta.summary?.removed ?? 0}件 / 悪化: ${delta.summary?.regressed ?? 0}件 / 新規: ${delta.summary?.new ?? 0}件

### 改善・解消
${rows.join('\n') || '- なし'}

### 悪化・新規
${regressions.join('\n') || '- なし'}

### 次の候補
${remaining.join('\n') || '- なし'}`;
}

function renderPrFlowVerification(flowVerification) {
  if (!flowVerification) {
    return `## Flow Verification Evidence
- 未実行: \`vibepro verify flow . --base-url <url>\` で動線証跡を作成する`;
  }
  const verification = flowVerification.verification ?? flowVerification;
  const artifacts = flowVerification.artifacts ?? {};
  const artifactPath = flowVerification.artifact ?? artifacts.flow_verification_json ?? '-';
  const reportPath = artifacts.flow_verification_report ?? '-';
  const logPath = artifacts.playwright_log ?? '-';
  return `## Flow Verification Evidence
- status: ${verification.status ?? flowVerification.status ?? '-'}
- run: ${verification.run_id ?? flowVerification.run_id ?? '-'}
- base_url: ${verification.base_url ?? flowVerification.base_url ?? '-'}
- probes: pass=${verification.summary?.pass ?? flowVerification.summary?.pass ?? 0}, fail=${verification.summary?.fail ?? flowVerification.summary?.fail ?? 0}, skipped=${verification.summary?.skipped ?? flowVerification.summary?.skipped ?? 0}, needs_setup=${verification.summary?.needs_setup ?? flowVerification.summary?.needs_setup ?? 0}
- json: ${artifactPath}
- report: ${reportPath}
- log: ${logPath}`;
}

function renderNetworkContractPrSection(networkContracts) {
  if (!networkContracts) return '- 未生成';
  const missing = networkContracts.missing_routes ?? [];
  const dynamic = networkContracts.dynamic_calls ?? [];
  const replacements = networkContracts.high_risk_replacements ?? [];
  const rows = [
    ...missing.slice(0, 8).map((item) => `- missing: ${item.method ?? '-'} ${item.api_path} in ${item.file}:${item.line ?? '-'}${item.cause_candidates?.length ? ` / cause: ${item.cause_candidates.map((candidate) => candidate.commit).join('; ')}` : ''}`),
    ...dynamic.slice(0, 5).map((item) => `- dynamic: ${item.api_path} in ${item.file}:${item.line ?? '-'}`),
    ...replacements.slice(0, 5).map((item) => `- replacement: ${item.file} removed ${item.removed_calls.join(', ')} -> ${item.introduced_api_calls.map((call) => call.api_path.value).join(', ')}`)
  ];
  return [
    `- status: ${networkContracts.status}`,
    `- API client calls: ${networkContracts.api_client_call_count ?? 0}`,
    `- introduced API client calls: ${networkContracts.introduced_api_client_call_count ?? 0}`,
    `- missing routes: ${missing.length}`,
    `- dynamic routes: ${dynamic.length}`,
    `- server function replacements: ${replacements.length}`,
    rows.join('\n') || '- 問題なし'
  ].join('\n');
}

function renderPrVisualQaEvidence(visualQa) {
  if (!visualQa) {
    return `## Visual QA Evidence
- 未検出: \`.vibepro/qa/<qa-id>/residual-analysis.md\` または \`*residual*.json\` がある場合はPR判断に接続されます`;
  }
  const rows = visualQa.runs.map((run) => {
    const residual = run.latest_residual?.meanAbsResidualPct;
    const rms = run.latest_residual?.rmsResidualPct;
    const semantic = run.semantic_layout_residual_pct;
    return [
      `- ${run.qa_id}: ${run.status}`,
      residual != null ? `MAE ${residual}%` : null,
      rms != null ? `RMS ${rms}%` : null,
      semantic != null ? `semantic/layout ${semantic}%` : null,
      run.residual_analysis ? `analysis: ${run.residual_analysis}` : null,
      run.latest_residual?.path ? `residual: ${run.latest_residual.path}` : null
    ].filter(Boolean).join(' / ');
  });
  return `## Visual QA Evidence
- status: ${visualQa.status}
- threshold: residual <= ${visualQa.threshold_pct}%
${rows.join('\n') || '- なし'}`;
}

function renderPrCompletionQuality(completionQuality) {
  if (!completionQuality) {
    return `## Completion Quality
- status: not_measured
- required evidence: Gate DAGを生成してから確認する`;
  }
  const metrics = completionQuality.metrics ?? {};
  const evidence = completionQuality.required_evidence?.length > 0
    ? completionQuality.required_evidence.map((item) => `- required: ${item}`).join('\n')
    : '- required: none';
  return `## Completion Quality
- status: ${completionQuality.status}
- e2e_experience_reach_rate: ${formatNullableRate(metrics.e2e_experience_reach_rate)}
- final_20_auto_closure_rate: ${formatNullableRate(metrics.final_20_auto_closure_rate)}
- visual_qa_pass_rate: ${formatNullableRate(metrics.visual_qa_pass_rate)}
- human_usable_quality_rate: ${formatNullableRate(metrics.human_usable_quality_rate)}
${evidence}`;
}

function formatNullableRate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'not_measured';
}

function buildVisualQaGateReason(visualQa) {
  const needsReview = visualQa.runs.filter((run) => run.status === 'needs_review');
  if (needsReview.length === 0) {
    return `Visual QA evidence is within ${visualQa.threshold_pct}% residual threshold`;
  }
  const summaries = needsReview.map((run) => {
    const residual = run.latest_residual?.meanAbsResidualPct;
    const semantic = run.semantic_layout_residual_pct;
    const parts = [run.qa_id];
    if (residual != null) parts.push(`MAE ${residual}%`);
    if (semantic != null) parts.push(`semantic/layout ${semantic}%`);
    return parts.join(' ');
  });
  return `Visual QA needs review: ${summaries.join('; ')}`;
}

function formatPrDeltaStatus(status) {
  return {
    improved: '改善',
    removed: '解消',
    regressed: '悪化',
    new: '新規',
    unchanged: '変化なし'
  }[status] ?? status;
}

async function buildPrSplitPlan(repoRoot, { story, git, fileGroups, scope, prContext, suggestedBranch }) {
  const graphContext = await buildSplitGraphContext(
    repoRoot,
    git.changed_files
      .map((file) => file.path)
      .filter((file) => !isWorkspaceArtifactPath(file))
  );
  const lanes = buildSplitLanes({
    fileGroups,
    scope,
    prContext,
    suggestedBranch,
    graphContext
  });
  const splitRequired = scope.status !== 'reviewable' || lanes.some((lane) => lane.recommendation === 'separate_pr');
  const mergeOrder = lanes
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((lane) => lane.id);
  const stackedGatePlan = buildStackedGatePlan({ lanes, mergeOrder, prContext });
  return {
    schema_version: '0.1.0',
    model: 'story-pr-split-plan-v1',
    story_id: story.story_id,
    status: splitRequired ? 'split_recommended' : 'single_pr_ok',
    recommended_strategy: splitRequired ? 'split_by_lane_then_prepare' : 'keep_current_pr',
    rationale: buildSplitRationale({ scope, lanes, graphContext }),
    graph_context: graphContext,
    lanes,
    merge_order: mergeOrder,
    stacked_gate_plan: stackedGatePlan,
    next_actions: buildSplitNextActions({ lanes, splitRequired })
  };
}

function buildSplitLanes({ fileGroups, scope, prContext, suggestedBranch, graphContext }) {
  const lanes = [];
  const used = new Set();
  const addLane = (lane) => {
    const files = [...new Set(lane.files)].filter(Boolean);
    if (files.length === 0) return;
    for (const file of files) used.add(file);
    lanes.push({
      ...lane,
      files,
      file_count: files.length,
      graph_investigation_files: collectLaneGraphInvestigationFiles(files, graphContext),
      suggested_branch: `${suggestedBranch}-${lane.id}`.replace(/[^a-zA-Z0-9/_-]+/g, '-').replace(/-+/g, '-')
    });
  };

  const repoControlFiles = fileGroups.repo_control.files;
  const e2eFiles = fileGroups.tests.files.filter((file) => file.startsWith('e2e/'));
  const unitTestFiles = fileGroups.tests.files.filter((file) => !file.startsWith('e2e/'));
  const e2eGateRequired = prContext.gate_dag?.nodes?.some((node) => node.id === 'gate:e2e' && node.required) === true;
  const gateInfraFiles = repoControlFiles.filter((file) => isE2eInfraPath(file) || (e2eGateRequired && isPackageManifestPath(file)));
  const repoPolicyFiles = repoControlFiles.filter((file) => !gateInfraFiles.includes(file));
  const storyBoundSupportDocs = fileGroups.other.files.filter((file) => isStoryBoundSupportDoc(file, prContext.story_source));

  addLane({
    id: 'repo-control',
    order: 5,
    title: 'Repository control and agent policy',
    category: 'repo_control',
    recommendation: 'separate_pr',
    files: repoPolicyFiles,
    required_gates: ['Integration Gate'],
    review_focus: [
      'アプリ挙動変更とrepo制御変更が混ざっていないか',
      '無関係なagent設定やignore規則を巻き込んでいないか'
    ]
  });

  addLane({
    id: 'requirements-ssot',
    order: 10,
    title: 'Story / Spec / Architecture / Policy SSOT',
    category: 'requirements',
    recommendation: scope.status === 'reviewable' ? 'same_pr_allowed' : 'separate_pr',
    files: [
      ...fileGroups.story_docs.files,
      ...fileGroups.specifications.files,
      ...fileGroups.architecture_docs.files,
      ...fileGroups.policy_docs.files,
      ...storyBoundSupportDocs
    ],
    required_gates: ['Requirement Gate'],
    review_focus: [
      'Story / Spec / Architecture / Policy の正本が互いに矛盾していないか',
      '実装差分が要求の範囲を超えていないか',
      'Storyに明示されたREADME/helpなどの利用者向け出力面が受け入れ基準と対応しているか'
    ]
  });

  addLane({
    id: 'runtime-behavior',
    order: 20,
    title: 'Runtime behavior and unit coverage',
    category: 'implementation',
    recommendation: 'primary_pr',
    files: [
      ...fileGroups.source.files,
      ...unitTestFiles
    ],
    required_gates: buildRuntimeLaneGates(prContext),
    review_focus: [
      '受け入れ基準と実装分岐が対応しているか',
      'Graphifyで隣接するファイルまで影響確認されているか'
    ]
  });

  addLane({
    id: 'e2e-gate',
    order: 30,
    title: 'E2E and verification harness',
    category: 'verification',
    recommendation: (e2eFiles.length > 0 || gateInfraFiles.length > 0) && scope.status !== 'reviewable' ? 'separate_pr' : 'same_pr_allowed',
    files: [
      ...gateInfraFiles,
      ...e2eFiles
    ],
    required_gates: ['E2E Gate', 'Integration Gate'],
    review_focus: [
      'E2E harnessが失敗exit codeを握りつぶしていないか',
      'PR Gateが変更対象のE2Eに正しくスコープされているか'
    ]
  });

  const remainingFiles = [
    ...fileGroups.other.files.filter((file) => !storyBoundSupportDocs.includes(file)),
    ...getAllGroupFiles(fileGroups).filter((file) => !used.has(file))
  ];
  addLane({
    id: 'misc-follow-up',
    order: 90,
    title: 'Miscellaneous follow-up',
    category: 'other',
    recommendation: 'separate_pr',
    files: remainingFiles,
    required_gates: ['Manual Review'],
    review_focus: [
      'Storyとの対応が不明な差分をPRから外すか、Storyに根拠を追記する'
    ]
  });

  return lanes;
}

function isStoryBoundSupportDoc(file, storySource) {
  if (!isSupportDocPath(file)) return false;
  const storyText = [
    storySource?.title,
    storySource?.requirement_title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? [])
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  if (!storyText) return false;
  const normalizedFile = file.toLowerCase();
  const baseName = path.basename(normalizedFile);
  if (storyText.includes(normalizedFile) || storyText.includes(baseName)) return true;
  if (baseName.startsWith('readme') && /\breadme\b|ドキュメント|ヘルプ|help|documentation|docs/.test(storyText)) return true;
  return false;
}

function isSupportDocPath(file) {
  const normalized = file.replaceAll('\\', '/');
  if (/^readme(?:\.[a-z]{2})?\.md$/i.test(normalized)) return true;
  if (normalized.startsWith('docs/')) {
    return !isStoryDocPath(normalized)
      && !isArchitectureDocPath(normalized)
      && !isSpecificationDocPath(normalized)
      && !isPolicyDocPath(normalized);
  }
  return false;
}

function buildRuntimeLaneGates(prContext) {
  const gates = ['Requirement Gate', 'Unit Gate', 'Integration Gate'];
  const e2eGate = prContext.gate_dag?.nodes?.find((node) => node.id === 'gate:e2e');
  if (e2eGate?.required) gates.push('E2E Gate');
  return gates;
}

function buildSplitRationale({ scope, lanes, graphContext }) {
  const items = [];
  if (scope.reasons.length > 0) items.push(...scope.reasons);
  if (lanes.length > 1) items.push(`${lanes.length} lanes に分けると、要求正本・実装・検証基盤・repo制御を別々にレビューできる`);
  if (graphContext.available) {
    items.push(`Graphifyで ${graphContext.matched_file_count} changed files が一致し、${graphContext.related_file_count} related files を影響調査候補にした`);
  } else {
    items.push(`Graphify未利用: ${graphContext.reason}`);
  }
  return items;
}

function buildStackedGatePlan({ lanes, mergeOrder, prContext }) {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const orderedLanes = mergeOrder.map((id) => byId.get(id)).filter(Boolean);
  const runtimeLane = byId.get('runtime-behavior') ?? null;
  const e2eLane = byId.get('e2e-gate') ?? null;
  const hasRuntimeChanges = Boolean(runtimeLane?.files?.some((file) => file.startsWith('src/')));
  const requiresCumulativeE2e = Boolean(e2eLane && hasRuntimeChanges);
  const requiredCommands = extractGateCommands(prContext);

  const lanePlans = orderedLanes.map((lane, index) => {
    const previousLaneIds = orderedLanes.slice(0, index).map((item) => item.id);
    const gateMode = lane.id === 'e2e-gate' && requiresCumulativeE2e
      ? 'cumulative_after_dependencies'
      : 'isolated_pr';
    const dependsOn = gateMode === 'cumulative_after_dependencies'
      ? previousLaneIds
      : [];
    return {
      lane_id: lane.id,
      gate_mode: gateMode,
      depends_on: dependsOn,
      isolated_checks: buildIsolatedLaneChecks(lane, requiredCommands),
      cumulative_checks: buildCumulativeLaneChecks({ lane, commands: requiredCommands, requiresCumulativeE2e }),
      review_note: buildStackedGateReviewNote({ lane, gateMode, dependsOn, requiresCumulativeE2e })
    };
  });

  return {
    schema_version: '0.1.0',
    model: 'stacked-pr-gate-plan-v1',
    summary: {
      lane_count: lanePlans.length,
      cumulative_gate_count: lanePlans.filter((lane) => lane.gate_mode === 'cumulative_after_dependencies').length,
      requires_cumulative_e2e: requiresCumulativeE2e
    },
    lane_plans: lanePlans,
    final_validation: buildFinalValidationPlan({ requiredCommands, requiresCumulativeE2e })
  };
}

function extractGateCommands(prContext) {
  const gates = prContext.gate_dag?.nodes?.filter((node) => node.type === 'verification_gate') ?? [];
  const commandByLabel = new Map(gates.map((gate) => [gate.label, gate.command]).filter(([, command]) => command));
  const unitCommand = commandByLabel.get('Unit Gate') ?? prContext.verification_commands?.find((item) => item.kind === 'unit')?.command ?? 'npm test';
  const integrationCommand = commandByLabel.get('Integration Gate') ?? prContext.verification_commands?.find((item) => item.kind === 'typecheck')?.command ?? 'npm run typecheck';
  const e2eCommand = commandByLabel.get('E2E Gate') ?? 'npx playwright test';
  return {
    unit: unitCommand,
    integration: integrationCommand,
    e2e: e2eCommand
  };
}

function buildIsolatedLaneChecks(lane, commands) {
  if (lane.id === 'requirements-ssot') return ['Requirement Gate / document consistency review'];
  if (lane.id === 'runtime-behavior') return [commands.unit, commands.integration];
  if (lane.id === 'e2e-gate') return [commands.integration, 'Playwright harness smoke if runtime dependencies are already merged'];
  if (lane.id === 'repo-control') return ['git diff --check', commands.integration];
  return ['manual review'];
}

function buildCumulativeLaneChecks({ lane, commands, requiresCumulativeE2e }) {
  if (lane.id === 'e2e-gate' && requiresCumulativeE2e) {
    return [commands.unit, commands.integration, commands.e2e];
  }
  return [];
}

function buildStackedGateReviewNote({ lane, gateMode, dependsOn, requiresCumulativeE2e }) {
  if (gateMode === 'cumulative_after_dependencies') {
    return `${lane.id} は単体PRだけで完了判定せず、${dependsOn.join(' -> ')} を取り込んだ累積状態でGateを確認する。`;
  }
  if (lane.id === 'runtime-behavior') {
    if (!requiresCumulativeE2e) {
      return 'runtime差分はUnit/Integrationを単体PRで確認する。E2E Gateが不要な変更では、後続E2Eまたは累積validationを要求しない。';
    }
    return 'runtime差分はUnit/Integrationを単体PRで確認し、E2Eは後続のe2e-gateまたは累積validationで確認する。';
  }
  return `${lane.id} は単体PRとしてレビュー可能。`;
}

function buildFinalValidationPlan({ requiredCommands, requiresCumulativeE2e }) {
  const commands = [requiredCommands.unit, requiredCommands.integration];
  if (requiresCumulativeE2e) commands.push(requiredCommands.e2e);
  return {
    required: requiresCumulativeE2e,
    trigger: requiresCumulativeE2e
      ? 'runtime-behavior と e2e-gate の両方がmerge対象に含まれる'
      : '各PRのisolated checksで十分',
    commands
  };
}

function buildSplitNextActions({ lanes, splitRequired }) {
  if (!splitRequired) {
    return ['現PRのまま進め、split-planをレビュー観点として使う'];
  }
  return lanes.map((lane) => ({
    lane_id: lane.id,
    action: `Create ${lane.suggested_branch} with ${lane.file_count} files`,
    command: `git switch -c ${lane.suggested_branch} <base> && git add ${lane.files.map(shellQuote).join(' ')}`
  }));
}

function getAllGroupFiles(fileGroups) {
  return Object.entries(fileGroups)
    .filter(([key]) => key !== 'vibepro_artifacts')
    .flatMap(([, group]) => group.files ?? []);
}

function isWorkspaceArtifactPath(filePath) {
  return String(filePath ?? '').startsWith('.vibepro/');
}

function isGateInfraPath(filePath) {
  return filePath.startsWith('e2e/')
    || /^playwright\.config\.[cm]?[jt]s$/.test(filePath)
    || /^tsconfig(\..+)?\.json$/.test(filePath)
    || ['package.json', 'package-lock.json'].includes(filePath);
}

function collectLaneGraphInvestigationFiles(files, graphContext) {
  if (!graphContext.available) return [];
  const related = new Set();
  for (const file of files) {
    const item = graphContext.impact_by_file.find((impact) => impact.file === file);
    if (!item) continue;
    for (const relatedFile of item.related_files) {
      if (!files.includes(relatedFile)) related.add(relatedFile);
    }
  }
  return [...related].sort().slice(0, 12);
}

async function buildSplitGraphContext(repoRoot, changedFiles) {
  const graphPath = path.join(getWorkspaceDir(repoRoot), 'graphify', 'graph.json');
  let graph = null;
  try {
    graph = JSON.parse(await readFile(graphPath, 'utf8'));
  } catch {
    return {
      available: false,
      reason: '.vibepro/graphify/graph.json が見つからない',
      graph_path: toWorkspaceRelative(repoRoot, graphPath),
      node_count: 0,
      edge_count: 0,
      matched_file_count: 0,
      related_file_count: 0,
      investigation_files: [],
      impact_by_file: []
    };
  }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const { edges, sourceKey } = normalizeSplitGraphEdges(graph);
  const index = buildSplitGraphIndex(nodes, edges);
  const changedSet = new Set(changedFiles.map(normalizeGraphPath));
  const relatedFiles = new Set();
  const impactByFile = [];

  for (const changedFile of changedSet) {
    const matchedNodes = index.nodesByFile.get(changedFile) ?? [];
    if (matchedNodes.length === 0) continue;
    const fileRelated = new Set();
    for (const node of matchedNodes) {
      for (const edge of index.edgesByNodeId.get(node.id) ?? []) {
        const endpoints = [getSplitEdgeEndpoint(edge, 'source'), getSplitEdgeEndpoint(edge, 'target')].filter(Boolean);
        for (const endpoint of endpoints) {
          const endpointNode = index.nodesById.get(endpoint);
          const endpointFile = endpointNode ? getSplitGraphNodeFile(endpointNode) : null;
          if (!endpointFile) continue;
          const normalized = normalizeGraphPath(endpointFile);
          if (normalized !== changedFile) {
            fileRelated.add(normalized);
            relatedFiles.add(normalized);
          }
        }
      }
    }
    impactByFile.push({
      file: changedFile,
      matched_nodes: matchedNodes.map((node) => node.id).slice(0, 8),
      related_files: [...fileRelated].sort().slice(0, 12)
    });
  }

  return {
    available: true,
    graph_path: toWorkspaceRelative(repoRoot, graphPath),
    edge_source_key: sourceKey,
    node_count: nodes.length,
    edge_count: edges.length,
    matched_file_count: impactByFile.length,
    related_file_count: relatedFiles.size,
    investigation_files: [...relatedFiles].sort().slice(0, 30),
    impact_by_file: impactByFile.sort((a, b) => a.file.localeCompare(b.file))
  };
}

function normalizeSplitGraphEdges(graph) {
  if (Array.isArray(graph.edges)) return { edges: graph.edges, sourceKey: 'edges' };
  if (Array.isArray(graph.links)) return { edges: graph.links, sourceKey: 'links' };
  return { edges: [], sourceKey: null };
}

function buildSplitGraphIndex(nodes, edges) {
  const nodesById = new Map();
  const nodesByFile = new Map();
  const edgesByNodeId = new Map();

  for (const node of nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string') continue;
    nodesById.set(node.id, node);
    const file = getSplitGraphNodeFile(node);
    if (!file) continue;
    const normalized = normalizeGraphPath(file);
    if (!nodesByFile.has(normalized)) nodesByFile.set(normalized, []);
    nodesByFile.get(normalized).push(node);
  }

  for (const edge of edges) {
    const source = getSplitEdgeEndpoint(edge, 'source');
    const target = getSplitEdgeEndpoint(edge, 'target');
    if (!source || !target) continue;
    if (!edgesByNodeId.has(source)) edgesByNodeId.set(source, []);
    if (!edgesByNodeId.has(target)) edgesByNodeId.set(target, []);
    edgesByNodeId.get(source).push(edge);
    edgesByNodeId.get(target).push(edge);
  }

  return { nodesById, nodesByFile, edgesByNodeId };
}

function getSplitGraphNodeFile(node) {
  const explicit = node.source_file
    ?? node.sourceFile
    ?? node.file
    ?? node.path
    ?? node.payload?.source_file
    ?? node.payload?.sourceFile
    ?? null;
  if (explicit) return explicit;
  if (/^(src|app|pages|lib|components|e2e|tests|test|docs)\//.test(node.id)) return node.id;
  return null;
}

function getSplitEdgeEndpoint(edge, endpoint) {
  if (!edge || typeof edge !== 'object') return null;
  const value = endpoint === 'source'
    ? edge.source ?? edge.from ?? edge._src ?? edge.source_id ?? edge.sourceId ?? null
    : edge.target ?? edge.to ?? edge._dst ?? edge._tgt ?? edge.target_id ?? edge.targetId ?? null;
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.id ?? value.name ?? null;
  return String(value);
}

function normalizeGraphPath(filePath) {
  return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
}

async function buildPrContext(repoRoot, { story, taskContext, git, fileGroups, latestStoryRun, verificationEvidence = null }) {
  const storyDocs = await readStoryDocs(repoRoot, fileGroups.story_docs.files);
  let primaryStory = pickPrimaryStory(storyDocs, story);
  const hasSingleChangedStoryDoc = storyDocs.length === 1 && Boolean(primaryStory?.path);
  if (!storyDocMatchesStory(primaryStory, story) && !hasSingleChangedStoryDoc) {
    const filesystemStory = await findStorySource(repoRoot, story);
    if (filesystemStory?.path) {
      try {
        const content = await readFile(path.join(repoRoot, filesystemStory.path), 'utf8');
        primaryStory = parseStoryDoc(filesystemStory.path, content);
      } catch {
        // keep the default primaryStory if the file disappeared between scans
      }
    } else if (filesystemStory) {
      primaryStory = filesystemStory;
    }
  }
  if (!storyDocMatchesStory(primaryStory, story) && !hasSingleChangedStoryDoc) {
    primaryStory = buildUnresolvedStorySource(story);
  }
  const architectureDecision = resolveArchitectureDecision(primaryStory, fileGroups);
  const typecheckCommand = await detectTypecheckCommand(repoRoot);
  const testRunner = await detectTestRunner(repoRoot);
  const verificationCommands = buildVerificationCommands(fileGroups, { typecheckCommand, testRunner });
  const e2eCommand = await detectPlaywrightCommand(repoRoot, fileGroups);
  const latestEvidence = await readRunEvidenceIfExists(repoRoot, latestStoryRun);
  const latestFlowVerification = await readLatestFlowVerification(repoRoot, story.story_id, git);
  const visualQaEvidence = await readVisualQaEvidence(repoRoot);
  const designQualityEvidence = await readDesignQualityEvidence(repoRoot, story.story_id);
  const e2eCoverage = await buildStoryE2eCoverage(repoRoot, story, primaryStory);
  const performanceEvidence = await summarizeStoryPerformanceEvidence(repoRoot, story.story_id);
  const networkContracts = await scanNetworkContracts(repoRoot, {
    changedFiles: git.changed_files,
    baseRef: git.base_ref,
    headRef: git.head_ref === 'HEAD' && git.includes_dirty_in_changed_files ? null : git.head_ref
  });
  const inferredSpec = await readInferredSpec(repoRoot, story.story_id);
  const specDrift = await readDrift(repoRoot, story.story_id);
  const requirementConsistency = await buildRequirementConsistency(repoRoot, {
    story,
    storySource: primaryStory,
    fileGroups,
    inferredSpec
  });
  const changeClassification = classifyChangeRisk({
    fileGroups,
    storySource: primaryStory,
    networkContracts
  });
  const boundVerificationEvidence = bindVerificationEvidenceToGit(verificationEvidence, git);
  const agentReviews = await summarizeAgentReviewsForPr(repoRoot, {
    storyId: story.story_id,
    story,
    fileGroups,
    networkContracts,
    performanceEvidence,
    changeClassification,
    git
  });
  const exploreEvidence = await summarizeExploreEvidenceForPr(repoRoot, {
    storyId: story.story_id
  });
  const context = {
    story_source: primaryStory,
    architecture_decision: architectureDecision,
    requirement_consistency: requirementConsistency,
    change_classification: changeClassification,
    inferred_spec: inferredSpec,
    spec_drift: specDrift,
    change_summary: buildChangeSummary(fileGroups),
    verification_commands: verificationCommands,
    review_points: buildReviewPoints(fileGroups, taskContext),
    refactoring_delta: latestEvidence?.refactoring_delta ?? null,
    flow_verification: latestFlowVerification,
    acceptance_e2e_coverage: e2eCoverage,
    design_quality: designQualityEvidence,
    visual_qa: visualQaEvidence,
    performance_evidence: performanceEvidence,
    network_contracts: networkContracts,
    agent_reviews: agentReviews,
    explore_evidence: exploreEvidence,
    verification_evidence: boundVerificationEvidence,
    risks: []
  };
  context.gate_dag = buildGateDag({
    story,
    storySource: primaryStory,
    architectureDecision,
    requirementConsistency,
    fileGroups,
    verificationCommands,
    e2eCommand,
    flowVerification: latestFlowVerification,
    e2eCoverage,
    designQualityEvidence,
    visualQaEvidence,
    networkContracts,
    agentReviews,
    verificationEvidence: boundVerificationEvidence,
    inferredSpec,
    specDrift,
    changeClassification
  });
  context.completion_quality = buildCompletionQuality({
    gateDag: context.gate_dag,
    flowVerification: latestFlowVerification,
    designQualityEvidence,
    visualQaEvidence
  });
  context.execution_gate = buildExecutionGateStatus(context.gate_dag);
  context.gate_status = {
    schema_version: '0.1.0',
    overall_status: context.gate_dag.overall_status,
    execution_gate: context.execution_gate
  };
  context.risks = buildRisks({ git, fileGroups, latestStoryRun, gateDag: context.gate_dag, taskContext, specDrift, networkContracts, agentReviews });
  return context;
}

async function readRunEvidenceIfExists(repoRoot, run) {
  const evidencePath = run?.artifacts?.evidence;
  if (!evidencePath) return null;
  try {
    return JSON.parse(await readFile(path.resolve(repoRoot, evidencePath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readVerificationEvidenceIfExists(repoRoot, storyId) {
  const evidencePath = path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'verification-evidence.json');
  try {
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    return {
      ...evidence,
      artifact: toWorkspaceRelative(repoRoot, evidencePath)
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function bindVerificationEvidenceToGit(verificationEvidence, git) {
  if (!verificationEvidence) return null;
  const commands = Array.isArray(verificationEvidence.commands)
    ? verificationEvidence.commands.map((command) => bindVerificationCommandToGit(command, git))
    : [];
  return {
    ...verificationEvidence,
    commands,
    binding: {
      current_head_sha: git.head_sha ?? null,
      current_dirty: git.dirty === true,
      current_status_fingerprint_hash: fingerprintHashForContext(git),
      stale_command_count: commands.filter((command) => command.binding?.status !== 'current').length
    }
  };
}

function bindVerificationCommandToGit(command, git) {
  const context = command?.git_context ?? null;
  const binding = resolveVerificationBinding(context, git);
  return {
    ...command,
    binding,
    stale: binding.status !== 'current'
  };
}

function resolveVerificationBinding(context, git) {
  if (!context?.head_sha) {
    return {
      status: 'legacy',
      reason: 'legacy verification evidence is not bound to a git head'
    };
  }
  if (git.head_sha && context.head_sha !== git.head_sha) {
    return {
      status: 'stale',
      reason: `verification evidence was recorded for ${context.head_sha.slice(0, 12)}, current head is ${git.head_sha.slice(0, 12)}`
    };
  }
  const recordedFingerprint = fingerprintHashForContext(context);
  const currentFingerprint = fingerprintHashForContext(git);
  if (recordedFingerprint !== currentFingerprint) {
    return {
      status: 'stale',
      reason: 'verification evidence was recorded with a different dirty worktree fingerprint'
    };
  }
  return {
    status: 'current',
    reason: 'verification evidence is bound to the current git state'
  };
}

async function readLatestFlowVerification(repoRoot, storyId, git = null) {
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
  const runs = Array.isArray(manifest.flow_verification_runs) ? manifest.flow_verification_runs : [];
  const matching = selectLatestFlowVerificationRun(runs, storyId, manifest.latest_flow_verification_run);
  const artifact = matching?.artifacts?.flow_verification_json;
  if (!artifact) return bindFlowVerificationToGit(matching, git);
  try {
    const verification = JSON.parse(await readFile(path.resolve(repoRoot, artifact), 'utf8'));
    const storyMismatch = verification?.story_id && verification.story_id !== storyId;
    return bindFlowVerificationToGit({
      ...matching,
      verification,
      artifact,
      story_mismatch: storyMismatch,
      expected_story_id: storyId
    }, git);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        ...matching,
        artifact,
        missing_artifact: true
      };
    }
    throw error;
  }
}

function selectLatestFlowVerificationRun(runs, storyId, latestRunId = null) {
  const matchingRuns = runs.filter((run) => run?.story_id === storyId);
  if (latestRunId) {
    const explicit = matchingRuns.find((run) => run.run_id === latestRunId);
    if (explicit) return explicit;
  }
  return matchingRuns
    .slice()
    .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))[0] ?? null;
}

function bindFlowVerificationToGit(flowVerification, git) {
  if (!flowVerification || !git) return flowVerification;
  const context = flowVerification.verification?.git_context ?? flowVerification.git_context ?? null;
  const binding = resolveVerificationBinding(context, git);
  return {
    ...flowVerification,
    binding,
    stale: binding.status !== 'current',
    verification: flowVerification.verification
      ? {
        ...flowVerification.verification,
        binding,
        stale: binding.status !== 'current'
      }
      : flowVerification.verification
  };
}

async function readVisualQaEvidence(repoRoot) {
  const qaRoot = path.join(getWorkspaceDir(repoRoot), 'qa');
  let entries = [];
  try {
    entries = await readdir(qaRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const qaDir = path.join(qaRoot, entry.name);
    const run = await readVisualQaRun(repoRoot, qaDir, entry.name);
    if (run) runs.push(run);
  }
  if (runs.length === 0) return null;
  const thresholdPct = 5;
  for (const run of runs) {
    run.status = resolveVisualQaStatus(run, thresholdPct);
  }
  const sortedRuns = runs
    .sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0))
    .slice(0, 5);
  return {
    schema_version: '0.1.0',
    status: sortedRuns.some((run) => run.status === 'needs_review') ? 'needs_review' : 'ready_for_review',
    threshold_pct: thresholdPct,
    runs: sortedRuns,
    artifacts: sortedRuns.flatMap((run) => [
      run.residual_analysis,
      run.latest_residual?.path
    ].filter(Boolean))
  };
}

async function readDesignQualityEvidence(repoRoot, storyId) {
  const root = getWorkspaceDir(repoRoot);
  const designDir = path.join(root, 'design-modernize', storyId);
  const planPath = path.join(designDir, 'design-modernize.json');
  const capturePath = path.join(designDir, 'screen-capture.json');
  let plan = null;
  let capture = null;
  try {
    plan = JSON.parse(await readFile(planPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
  try {
    capture = JSON.parse(await readFile(capturePath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const hasExplicitGate = plan?.spec_gate?.mode === 'explicit' && plan?.spec_gate?.fallback_allowed === false;
  const hasDesignDag = plan?.design_quality_dag?.model === 'vibepro-design-quality-dag-v1';
  const captureStatus = capture?.status ?? 'missing';
  const status = hasExplicitGate && hasDesignDag && captureStatus === 'pass'
    ? 'ready_for_review'
    : 'needs_evidence';
  const missing = [];
  if (!hasExplicitGate) missing.push('explicit spec_gate');
  if (!hasDesignDag) missing.push('design_quality_dag');
  if (captureStatus !== 'pass') missing.push(`screen capture (${captureStatus})`);
  return {
    schema_version: '0.1.0',
    status,
    story_id: storyId,
    model: plan?.design_quality_dag?.model ?? null,
    screen_count: Array.isArray(plan?.screens) ? plan.screens.length : 0,
    capture_status: captureStatus,
    missing,
    artifacts: [
      toWorkspaceRelative(repoRoot, planPath),
      capture ? toWorkspaceRelative(repoRoot, capturePath) : null
    ].filter(Boolean)
  };
}

async function buildStoryE2eCoverage(repoRoot, story, storySource) {
  const acceptanceCriteria = storySource?.acceptance_criteria ?? [];
  const storySlug = slugifyStoryId(story.story_id);
  const expectedFilePatterns = [
    `tests/e2e/${storySlug}-*.spec.ts`,
    `test/e2e/${storySlug}-*.spec.ts`,
    `e2e/${storySlug}-*.spec.ts`
  ];
  const allFiles = (await Promise.all([
    walkFiles(path.join(repoRoot, 'tests', 'e2e')),
    walkFiles(path.join(repoRoot, 'test', 'e2e')),
    walkFiles(path.join(repoRoot, 'e2e'))
  ])).flat()
    .filter((file) => /\.(spec|test)\.[cm]?[jt]sx?$/.test(file));
  const candidates = [];
  for (const file of allFiles) {
    const relativePath = normalizeRepoPath(path.relative(repoRoot, file));
    const content = await readFile(file, 'utf8').catch(() => '');
    if (isStoryE2eCandidate(relativePath, content, story.story_id, storySlug)) {
      candidates.push({
        path: relativePath,
        content,
        executable: hasExecutableE2eAssertions(content)
      });
    }
  }
  const covered = acceptanceCriteria.map((criterion, index) => {
    const id = `ac:${index + 1}`;
    const files = candidates
      .filter((candidate) => candidate.executable && e2eCandidateCoversAcceptance(candidate, story.story_id, criterion, index))
      .map((candidate) => candidate.path);
    return {
      id,
      criterion,
      covered: files.length > 0,
      files
    };
  });
  const missing = covered.filter((item) => !item.covered);
  return {
    schema_version: '0.1.0',
    story_id: story.story_id,
    required: acceptanceCriteria.length > 0,
    status: acceptanceCriteria.length === 0
      ? 'not_applicable'
      : missing.length === 0
        ? 'passed'
        : 'needs_evidence',
    expected_file_patterns: expectedFilePatterns,
    matched_files: candidates.map((candidate) => candidate.path),
    executable_matched_files: candidates.filter((candidate) => candidate.executable).map((candidate) => candidate.path),
    acceptance_criteria_count: acceptanceCriteria.length,
    covered_acceptance_criteria_count: covered.length - missing.length,
    covered_acceptance_criteria: covered.filter((item) => item.covered),
    missing_acceptance_criteria: missing
  };
}

function hasExecutableE2eAssertions(content) {
  return getExecutableE2eBlocks(content).length > 0;
}

function hasExecutableE2eAssertionsInText(content) {
  return /\bassert\s*[.(]/.test(content)
    || /\bexpect\s*\(/.test(content);
}

function isStoryE2eCandidate(relativePath, content, storyId, storySlug) {
  const lowerPath = relativePath.toLowerCase();
  return lowerPath.includes(storySlug)
    || normalizeCoverageText(content).includes(normalizeCoverageText(storyId));
}

function e2eCandidateCoversAcceptance(candidate, storyId, criterion, index) {
  const markers = [
    `${storyId} ac:${index + 1}`,
    `${storyId} ac-${index + 1}`,
    `${storyId} acceptance:${index + 1}`
  ].map(normalizeCoverageText);
  const criterionMarker = normalizeCoverageText(criterion);
  return getExecutableE2eBlocks(candidate.content).some((block) => {
    const content = normalizeCoverageText(block);
    return criterionMarker.length > 0
      && content.includes(criterionMarker)
      && markers.some((marker) => marker.length > 0 && content.includes(marker))
      && blockHasCriterionAssertion(block, criterion);
  });
}

function blockHasCriterionAssertion(block, criterion) {
  const tokens = coverageAssertionTokens(criterion);
  if (tokens.length === 0) return hasExecutableE2eAssertionsInText(block);
  return String(block ?? '')
    .split('\n')
    .filter(hasExecutableE2eAssertionsInText)
    .some((line) => {
      const normalized = normalizeCoverageText(line);
      return tokens.some((token) => normalized.includes(token));
    });
}

function coverageAssertionTokens(text) {
  const normalized = normalizeCoverageText(text);
  const ascii = normalized.match(/[a-z0-9_:-]{4,}/g) ?? [];
  const japanese = normalized.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]{2,}/gu) ?? [];
  return [...new Set([...ascii, ...japanese])]
    .filter((token) => !['with', 'when', 'case', 'true', 'false', 'status', '場合'].includes(token))
    .slice(0, 12);
}

function getExecutableE2eBlocks(content) {
  const lines = String(content ?? '').split('\n');
  const blocks = [];
  let current = [];
  let parenBalance = 0;
  const startsTestBlock = (line) => /^\s*(?:test|it)(?:\.only)?\s*\(/.test(line);
  const updateBalance = (line) => {
    const withoutLineComment = line.replace(/\/\/.*$/, '');
    for (const char of withoutLineComment) {
      if (char === '(') parenBalance += 1;
      if (char === ')') parenBalance = Math.max(0, parenBalance - 1);
    }
  };
  for (const line of lines) {
    const startsBlock = startsTestBlock(line);
    if (startsBlock && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [];
      parenBalance = 0;
    }
    if (current.length > 0 || startsBlock) {
      current.push(line);
      updateBalance(line);
      if (parenBalance === 0 && /[;)]\s*$/.test(line.trim())) {
        blocks.push(current.join('\n'));
        current = [];
      }
    }
  }
  if (current.length > 0) blocks.push(current.join('\n'));
  return blocks.filter(hasExecutableE2eAssertionsInText);
}

function slugifyStoryId(storyId) {
  return String(storyId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCoverageText(value) {
  return String(value)
    .toLowerCase()
    .replace(/[\s"'`*_()[\]{}:;,.!?/\\|]+/g, '');
}

function normalizeRepoPath(value) {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '');
}

async function readVisualQaRun(repoRoot, qaDir, qaId) {
  const files = await walkFiles(qaDir);
  const residualAnalysis = files.find((file) => path.basename(file) === 'residual-analysis.md') ?? null;
  const residualJsonFiles = files.filter((file) => /residual.*\.json$/i.test(path.basename(file)));
  if (!residualAnalysis && residualJsonFiles.length === 0) return null;
  const residuals = [];
  for (const file of residualJsonFiles) {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      const fileStat = await stat(file);
      residuals.push({
        path: toWorkspaceRelative(repoRoot, file),
        updated_at_ms: fileStat.mtimeMs,
        meanAbsResidualPct: normalizeNumber(data.meanAbsResidualPct),
        rmsResidualPct: normalizeNumber(data.rmsResidualPct),
        pixelChangedPctOver32: normalizeNumber(data.pixelChangedPctOver32),
        pixelChangedPctOver64: normalizeNumber(data.pixelChangedPctOver64)
      });
    } catch {
      // Ignore malformed residual snapshots; the markdown analysis is still useful evidence.
    }
  }
  residuals.sort((a, b) => b.updated_at_ms - a.updated_at_ms);
  let semanticLayoutResidualPct = null;
  if (residualAnalysis) {
    try {
      const analysis = await readFile(residualAnalysis, 'utf8');
      semanticLayoutResidualPct = extractSemanticLayoutResidualPct(analysis);
    } catch {
      semanticLayoutResidualPct = null;
    }
  }
  const qaStat = await stat(qaDir);
  return {
    qa_id: qaId,
    status: 'unknown',
    updated_at_ms: Math.max(qaStat.mtimeMs, residuals[0]?.updated_at_ms ?? 0),
    residual_analysis: residualAnalysis ? toWorkspaceRelative(repoRoot, residualAnalysis) : null,
    semantic_layout_residual_pct: semanticLayoutResidualPct,
    latest_residual: residuals[0] ?? null
  };
}

async function walkFiles(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function resolveVisualQaStatus(run, thresholdPct) {
  const residual = run.latest_residual?.meanAbsResidualPct;
  const semantic = run.semantic_layout_residual_pct;
  if (residual != null && residual > thresholdPct) return 'needs_review';
  if (semantic != null && semantic > thresholdPct) return 'needs_review';
  return 'ready_for_review';
}

function extractSemanticLayoutResidualPct(content) {
  const match = content.match(/semantic\/layout residual:\s*\*\*([0-9]+(?:\.[0-9]+)?)%\*\*/i)
    ?? content.match(/semantic\s*\/\s*layout\s*residual[^0-9]+([0-9]+(?:\.[0-9]+)?)%/i);
  return match ? Number(match[1]) : null;
}

function normalizeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function readStoryDocs(repoRoot, files) {
  const docs = [];
  for (const file of files) {
    try {
      const content = await readFile(path.join(repoRoot, file), 'utf8');
      docs.push(parseStoryDoc(file, content));
    } catch {
      docs.push({ path: file, title: null, background: null, acceptance_criteria: [] });
    }
  }
  return docs;
}

function parseStoryDoc(file, content) {
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title ?? findMarkdownTitle(content);
  return {
    path: file,
    story_id: frontmatter.story_id ?? null,
    vibepro_story_id: frontmatter.vibepro_story_id ?? null,
    title,
    requirement_id: frontmatter.id ?? frontmatter.requirement_id ?? frontmatter.source_id ?? null,
    requirement_title: frontmatter.requirement_title ?? frontmatter.source_title ?? frontmatter.title ?? title,
    requirement_url: frontmatter.url ?? frontmatter.source_url ?? null,
    background: extractSectionText(content, ['背景', '現状', '課題'])
      ?? extractStoryIntro(content),
    policy: extractSectionText(content, ['方針', '実装方針', '実装戦略']),
    acceptance_criteria: extractAcceptanceCriteria(content),
    architecture_reason: frontmatter.reason ?? extractFrontmatterBlockReason(content, 'architecture_docs')
  };
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  let currentBlock = null;
  for (const line of match[1].split('\n')) {
    const item = line.match(/^([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (item) {
      currentBlock = null;
      result[item[1]] = item[2].replace(/^['"]|['"]$/g, '');
      continue;
    }
    const block = line.match(/^([A-Za-z0-9_-]+):\s*$/);
    if (block) {
      currentBlock = block[1];
      continue;
    }
    const sourceItem = currentBlock === 'source'
      ? line.match(/^\s+([A-Za-z0-9_-]+):\s*(.+?)\s*$/)
      : null;
    if (sourceItem) {
      result[`source_${sourceItem[1]}`] = sourceItem[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return result;
}

function findMarkdownTitle(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

function extractSectionText(content, headings) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'm'));
    if (!match) continue;
    const paragraph = match[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('|') && !line.startsWith('---'))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 320);
    if (paragraph) return paragraph;
  }
  return null;
}

function extractStoryIntro(content) {
  const withoutFrontmatter = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const storySection = extractTopLevelStorySection(withoutFrontmatter) ?? withoutFrontmatter;
  const paragraph = storySection
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (line.startsWith('#')) return false;
      if (line.startsWith('|')) return false;
      if (line.startsWith('---')) return false;
      if (/^-\s+/.test(line)) return false;
      return true;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 320);
  return paragraph || null;
}

function extractTopLevelStorySection(content) {
  for (const heading of ['Story', 'ストーリー']) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^#\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^#{1,6}\\s+|(?![\\s\\S]))`, 'm'));
    if (match) return match[1];
  }
  return null;
}

function extractAcceptanceCriteria(content) {
  const section = extractRawSection(content, ['受け入れ基準', '完了定義', 'Acceptance Criteria']);
  const source = section ?? content;
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+(?:\[[ xX]\]\s+)?\S/.test(line))
    .map((line) => line.replace(/^-\s+(?:\[[ xX]\]\s+)?/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

function extractRawSection(content, headings) {
  for (const heading of headings) {
    const escaped = escapeRegExp(heading);
    const match = content.match(new RegExp(`^##+\\s+.*${escaped}.*\\n([\\s\\S]*?)(?=^##+\\s+|(?![\\s\\S]))`, 'm'));
    if (match) return match[1];
  }
  return null;
}

function extractFrontmatterBlockReason(content, blockName) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${blockName}:`);
  if (start === -1) return null;
  for (let index = start + 1; index < Math.min(lines.length, start + 12); index += 1) {
    const match = lines[index].match(/^\s+reason:\s*(.+?)\s*$/);
    if (match) return match[1].replace(/^['"]|['"]$/g, '');
  }
  return null;
}

function pickPrimaryStory(storyDocs, story) {
  return storyDocs.find((doc) => doc.story_id === story.story_id || doc.vibepro_story_id === story.story_id)
    ?? storyDocs.find((doc) => doc.path.includes(story.story_id))
    ?? storyDocs.find((doc) => doc.title === story.title || doc.requirement_title === story.title)
    ?? storyDocs[0]
    ?? {
      path: null,
      title: story.title,
      requirement_id: null,
      requirement_title: story.title,
      requirement_url: null,
      background: null,
      policy: null,
      acceptance_criteria: [],
      architecture_reason: null
    };
}

function buildUnresolvedStorySource(story) {
  return {
    path: null,
    title: story.title,
    story_id: story.story_id,
    vibepro_story_id: null,
    requirement_id: null,
    requirement_title: story.title,
    requirement_url: null,
    background: null,
    policy: null,
    acceptance_criteria: [],
    architecture_reason: null
  };
}

function storyDocMatchesStory(doc, story) {
  if (!doc?.path) return false;
  if (doc.story_id === story.story_id || doc.vibepro_story_id === story.story_id) return true;
  if (doc.path.includes(story.story_id)) return true;
  if (doc.title && doc.title === story.title) return true;
  if (doc.requirement_title && doc.requirement_title === story.title) return true;
  return false;
}

function resolveArchitectureDecision(storyDoc, fileGroups) {
  if (fileGroups.architecture_docs.count > 0) {
    return `ADRあり (${fileGroups.architecture_docs.files.join(', ')})`;
  }
  if (storyDoc.architecture_reason) {
    return `ADR不要: ${storyDoc.architecture_reason}`;
  }
  return 'ADR差分なし。既存アーキテクチャ内の変更として扱う';
}

function buildChangeSummary(fileGroups) {
  const items = [];
  if (fileGroups.story_docs.count > 0) {
    items.push(`Story文書を更新: ${formatFileList(fileGroups.story_docs.files)}`);
  }
  if (fileGroups.architecture_docs.count > 0) {
    items.push(`アーキテクチャ判断を追加: ${formatFileList(fileGroups.architecture_docs.files)}`);
  }
  if (fileGroups.specifications.count > 0) {
    items.push(`仕様文書を更新: ${formatFileList(fileGroups.specifications.files)}`);
  }
  if (fileGroups.policy_docs.count > 0) {
    items.push(`方針文書を更新: ${formatFileList(fileGroups.policy_docs.files)}`);
  }
  if (fileGroups.source.count > 0) {
    items.push(`実装を変更: ${formatFileList(fileGroups.source.files)}`);
  }
  if (fileGroups.tests.count > 0) {
    items.push(`テストを追加・更新: ${formatFileList(fileGroups.tests.files)}`);
  }
  if (fileGroups.repo_control.count > 0) {
    items.push(`repo制御ファイルを変更: ${formatFileList(fileGroups.repo_control.files)}`);
  }
  if (fileGroups.other.count > 0) {
    items.push(`その他の差分: ${formatFileList(fileGroups.other.files)}`);
  }
  return items;
}

function buildVerificationCommands(fileGroups, options = {}) {
  const commands = [];
  if (fileGroups.tests.count > 0) {
    const testFiles = fileGroups.tests.files
      .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file))
      .filter((file) => !file.startsWith('e2e/'))
      .slice(0, 6);
    if (testFiles.length > 0) {
      commands.push({
        kind: 'unit',
        command: buildTargetedTestCommand(testFiles, options.testRunner),
        reason: '変更に対応する対象テスト'
      });
    } else {
      commands.push({
        kind: 'unit',
        command: 'npm test',
        reason: 'テスト差分があるため'
      });
    }
  }
  if (fileGroups.source.count > 0) {
    const typecheckCommand = options.typecheckCommand ?? {
      command: 'npm run typecheck',
      reason: 'TypeScript/型境界の確認'
    };
    commands.push({
      kind: 'typecheck',
      command: typecheckCommand.command,
      reason: typecheckCommand.reason
    });
  }
  return commands;
}

function buildTargetedTestCommand(testFiles, testRunner = null) {
  if (testRunner === 'vitest') {
    return `npm test -- ${testFiles.join(' ')}`;
  }
  if (testRunner === 'node') {
    return `node --test ${testFiles.join(' ')}`;
  }
  return `npm test -- --runTestsByPath ${testFiles.join(' ')} --runInBand`;
}

function buildSpecGateNode({ fileGroups, inferredSpec, specDrift }) {
  const driftHighCount = Array.isArray(specDrift?.items)
    ? specDrift.items.filter((item) => item.severity === 'high').length
    : 0;
  if (inferredSpec) {
    const clauseCount = Array.isArray(inferredSpec.clauses) ? inferredSpec.clauses.length : 0;
    const status = clauseCount === 0
      ? 'inferred_empty'
      : (driftHighCount > 0 ? 'needs_review' : 'inferred');
    const baseReason = clauseCount === 0
      ? 'inferred spec clauses が 0 (Spec を再生成してください)'
      : `${clauseCount} clauses inferred from Story+Code+Test`;
    const reason = driftHighCount > 0
      ? `${baseReason} (severity=high な drift が ${driftHighCount} 件)`
      : baseReason;
    return {
      id: 'spec',
      type: 'spec_gate',
      label: 'Spec Gate',
      status,
      reason,
      inferred_spec: {
        story_id: inferredSpec.story_id,
        clauses: clauseCount,
        generated_at: inferredSpec.generated_at ?? null
      },
      drift: specDrift?.summary ?? null
    };
  }
  return {
    id: 'spec',
    type: 'spec_gate',
    label: 'Spec Gate',
    status: fileGroups.specifications.count > 0 ? 'present' : 'implicit',
    reason: fileGroups.specifications.count > 0
      ? '仕様差分がある'
      : 'Story受け入れ基準を仕様として扱う (vibepro spec fingerprint で Spec を生成可)'
  };
}

function buildCompletionQuality({ gateDag, flowVerification, designQualityEvidence, visualQaEvidence }) {
  const unresolved = collectUnresolvedRequiredGates(gateDag);
  const e2eGate = gateDag?.nodes?.find((node) => node.id === 'gate:e2e') ?? null;
  const designQualityGate = gateDag?.nodes?.find((node) => node.id === 'gate:design_quality') ?? null;
  const visualQaGate = gateDag?.nodes?.find((node) => node.id === 'gate:visual_qa') ?? null;
  const architectureGate = gateDag?.nodes?.find((node) => node.id === 'architecture') ?? null;
  const specGate = gateDag?.nodes?.find((node) => node.id === 'spec') ?? null;
  const visualQaPassRate = visualQaGate?.required
    ? (visualQaGate.status === 'ready_for_review' ? 1 : 0)
    : null;
  const designQualityPassRate = designQualityGate?.required
    ? (designQualityGate.status === 'ready_for_review' ? 1 : 0)
    : null;
  const e2eReachRate = e2eGate?.required
    ? (e2eGate.status === 'passed' ? 1 : 0)
    : null;
  const final20Rate = calculateFinal20AutoClosureRate({ e2eReachRate, visualQaPassRate, designQualityPassRate });
  const knownRates = [e2eReachRate, designQualityPassRate, visualQaPassRate, final20Rate].filter((value) => typeof value === 'number');
  const requiredEvidence = [];
  if (architectureGate?.required && isUnresolvedGateStatus(architectureGate.status)) {
    requiredEvidence.push(`Architecture approval: ${architectureGate.status} - ${architectureGate.reason ?? 'reason missing'}`);
  }
  if (specGate?.required && isUnresolvedGateStatus(specGate.status)) {
    requiredEvidence.push(`Spec confirmation: ${specGate.status} - ${specGate.reason ?? 'reason missing'}`);
  }
  if (e2eGate?.required && e2eGate.status !== 'passed') {
    requiredEvidence.push(`E2E experience: ${e2eGate.status} - ${e2eGate.reason ?? flowVerification?.reason ?? 'flow evidence missing'}`);
  }
  if (designQualityGate?.required && designQualityGate.status !== 'ready_for_review') {
    requiredEvidence.push(`Design Quality DAG: ${designQualityGate.status} - ${designQualityGate.reason ?? designQualityEvidence?.missing?.join(', ') ?? 'design quality evidence missing'}`);
  }
  if (visualQaGate?.required && visualQaGate.status !== 'ready_for_review') {
    requiredEvidence.push(`Visual QA polish: ${visualQaGate.status} - ${visualQaGate.reason ?? 'visual residual evidence missing'}`);
  }
  for (const gate of unresolved) {
    if (['architecture', 'spec', 'gate:e2e', 'gate:design_quality', 'gate:visual_qa'].includes(gate.id)) continue;
    requiredEvidence.push(`${gate.label ?? gate.id}: ${gate.status} - ${gate.reason ?? 'reason missing'}`);
  }

  return {
    schema_version: '0.1.0',
    status: requiredEvidence.length === 0 ? 'ready_for_human_acceptance' : 'needs_quality_closure',
    target_quality_rate: 0.95,
    metrics: {
      e2e_experience_reach_rate: e2eReachRate,
      final_20_auto_closure_rate: final20Rate,
      design_quality_pass_rate: designQualityPassRate,
      visual_qa_pass_rate: visualQaPassRate,
      human_usable_quality_rate: knownRates.length > 0 ? Math.min(...knownRates) : null
    },
    required_evidence: requiredEvidence
  };
}

function calculateFinal20AutoClosureRate({ e2eReachRate, visualQaPassRate, designQualityPassRate }) {
  const knownRates = [e2eReachRate, designQualityPassRate, visualQaPassRate].filter((value) => typeof value === 'number');
  if (knownRates.length === 0) return null;
  return Math.min(...knownRates);
}

function buildGateDag({
  story,
  storySource,
  architectureDecision,
  requirementConsistency,
  fileGroups,
  verificationCommands,
  e2eCommand,
  flowVerification,
  e2eCoverage = null,
  designQualityEvidence = null,
  visualQaEvidence = null,
  networkContracts = null,
  agentReviews = null,
  verificationEvidence,
  inferredSpec = null,
  specDrift = null,
  changeClassification = null
}) {
  const acceptanceCriteria = storySource.acceptance_criteria.length > 0
    ? storySource.acceptance_criteria
    : ['Storyの受け入れ基準を明文化する'];
  const gates = buildVerificationGates({
    fileGroups,
    verificationCommands,
    e2eCommand,
    flowVerification,
    e2eCoverage,
    visualQaEvidence,
    verificationEvidence
  });
  const requirementGate = {
    id: 'gate:requirement',
    type: 'requirement_gate',
    label: 'Requirement Gate',
    status: resolveRequirementGateStatus(requirementConsistency),
    required: fileGroups.source.count > 0 || fileGroups.story_docs.count > 0 || fileGroups.policy_docs.count > 0,
    reason: buildRequirementGateReason(requirementConsistency)
  };
  const storyGate = {
    id: 'story',
    type: 'story',
    label: formatPrStoryLabel(story, storySource),
    status: storySource.path ? 'present' : 'transient',
    required: true,
    artifact: storySource.path,
    reason: storySource.path
      ? 'Story source is present'
      : 'Story source could not be resolved; implementation cannot be treated as human-confirmed scope'
  };
  const architectureGate = {
    id: 'architecture',
    type: 'architecture_gate',
    label: 'Architecture Gate',
    status: architectureDecision.startsWith('ADRあり') || architectureDecision.startsWith('ADR不要') ? 'satisfied' : 'needs_review',
    required: true,
    reason: architectureDecision
  };
  const specGate = {
    ...buildSpecGateNode({ fileGroups, inferredSpec, specDrift }),
    required: true
  };
  const changeClassificationGate = buildChangeClassificationGate(changeClassification);
  const uiExperienceChange = hasUiExperienceSourceChange(fileGroups);
  const designQualityGate = designQualityEvidence ? {
    id: 'gate:design_quality',
    type: 'design_quality_gate',
    label: 'Design Quality DAG Gate',
    status: designQualityEvidence.status,
    required: true,
    reason: designQualityEvidence.status === 'ready_for_review'
      ? 'VibePro Design Quality DAG evidence is present and screen capture passed'
      : `Design Quality DAG needs evidence: ${designQualityEvidence.missing?.join(', ') || 'missing quality evidence'}`,
    artifacts: designQualityEvidence.artifacts,
    screen_count: designQualityEvidence.screen_count,
    capture_status: designQualityEvidence.capture_status
  } : null;
  const visualQaGate = visualQaEvidence ? {
    id: 'gate:visual_qa',
    type: 'visual_qa_gate',
    label: 'Visual QA Gate',
    status: visualQaEvidence.status,
    required: true,
    reason: buildVisualQaGateReason(visualQaEvidence),
    artifacts: visualQaEvidence.artifacts,
    runs: visualQaEvidence.runs.map((run) => ({
      qa_id: run.qa_id,
      status: run.status,
      residual_pct: run.latest_residual?.meanAbsResidualPct ?? null,
      semantic_layout_residual_pct: run.semantic_layout_residual_pct
    }))
  } : uiExperienceChange ? {
    id: 'gate:visual_qa',
    type: 'visual_qa_gate',
    label: 'Visual QA Gate',
    status: 'needs_evidence',
    required: true,
    reason: 'UI experience source changed but Visual QA evidence was not recorded',
    artifacts: [],
    runs: []
  } : null;
  const networkContractGate = buildNetworkContractGate(networkContracts, fileGroups, {
    flowVerification,
    verificationEvidence
  });
  const agentReviewGate = buildAgentReviewGate(agentReviews, fileGroups);
  const agentReviewDag = buildAgentReviewProcessDag(agentReviews);
  const workflowHeavyGates = buildWorkflowHeavyGates({
    changeClassification,
    inferredSpec,
    flowVerification,
    e2eCoverage,
    verificationEvidence
  });
  const nodes = [
    storyGate,
    changeClassificationGate,
    architectureGate,
    specGate,
    {
      id: 'code',
      type: 'code_gate',
      label: 'Code Gate',
      status: fileGroups.source.count > 0 ? 'present' : 'not_required',
      files: fileGroups.source.files
    },
    networkContractGate,
    requirementGate,
    ...gates,
    ...(designQualityGate ? [designQualityGate] : []),
    ...(visualQaGate ? [visualQaGate] : []),
    ...workflowHeavyGates,
    ...agentReviewDag.nodes,
    agentReviewGate,
    {
      id: 'pr',
      type: 'pr_gate',
      label: 'PR Gate',
      status: 'pending',
      reason: 'Unit / Integration / E2E Gateの証跡をPR本文で確認する'
    }
  ];

  const acceptanceNodes = acceptanceCriteria.map((criterion, index) => ({
    id: `ac:${index + 1}`,
    type: 'acceptance_criterion',
    label: criterion,
    status: storySource.acceptance_criteria.length > 0 ? 'present' : 'missing'
  }));

  const edges = [
    { from: 'story', to: 'gate:change_classification' },
    { from: 'gate:change_classification', to: 'architecture' },
    { from: 'gate:change_classification', to: 'spec' },
    { from: 'story', to: 'architecture' },
    { from: 'story', to: 'spec' },
    { from: 'architecture', to: 'code' },
    { from: 'spec', to: 'code' },
    ...acceptanceNodes.flatMap((node) => [
      { from: 'story', to: node.id },
      { from: node.id, to: 'gate:requirement' },
      { from: node.id, to: 'gate:unit' },
      { from: node.id, to: 'gate:integration' },
      { from: node.id, to: 'gate:e2e' }
    ]),
    { from: 'code', to: 'gate:network_contract' },
    { from: 'gate:network_contract', to: 'gate:requirement' },
    { from: 'gate:requirement', to: 'gate:unit' },
    { from: 'gate:unit', to: 'gate:integration' },
    { from: 'gate:integration', to: 'gate:e2e' },
    ...(designQualityGate ? [
      { from: 'gate:e2e', to: 'gate:design_quality' }
    ] : []),
    ...(visualQaGate ? [
      { from: designQualityGate ? 'gate:design_quality' : 'gate:e2e', to: 'gate:visual_qa' },
      ...buildWorkflowHeavyEdges({
        workflowHeavyGates,
        defaultUpstreamNodeId: 'gate:visual_qa'
      }),
      ...buildAgentReviewProcessEdges({
        defaultUpstreamNodeId: workflowHeavyGates.length > 0 ? 'gate:release_confidence' : 'gate:visual_qa',
        agentReviewDag,
        stageUpstreams: buildAgentReviewStageUpstreams({ designQualityGate, visualQaGate })
      })
    ] : [
      ...buildWorkflowHeavyEdges({
        workflowHeavyGates,
        defaultUpstreamNodeId: designQualityGate ? 'gate:design_quality' : 'gate:e2e'
      }),
      ...buildAgentReviewProcessEdges({
        defaultUpstreamNodeId: workflowHeavyGates.length > 0 ? 'gate:release_confidence' : designQualityGate ? 'gate:design_quality' : 'gate:e2e',
        agentReviewDag,
        stageUpstreams: buildAgentReviewStageUpstreams({ designQualityGate, visualQaGate })
      })
    ]),
    { from: 'gate:agent_review', to: 'pr' }
  ];

  const allNodes = [...nodes.slice(0, 4), ...acceptanceNodes, ...nodes.slice(4)];
  const requiredGates = [
    storyGate,
    architectureGate,
    specGate,
    changeClassificationGate,
    networkContractGate,
    requirementGate,
    ...gates,
    designQualityGate,
    visualQaGate,
    ...workflowHeavyGates,
    ...agentReviewDag.nodes,
    agentReviewGate
  ].filter((gate) => gate?.required);
  const needsEvidence = requiredGates.filter((gate) => isUnresolvedGateStatus(gate.status));
  return {
    schema_version: '0.1.0',
    model: 'story-acceptance-verification-dag',
    overall_status: needsEvidence.length > 0 ? 'needs_verification' : 'ready_for_review',
    story_id: story.story_id,
    summary: {
      acceptance_criteria_count: acceptanceCriteria.length,
      required_gate_count: requiredGates.length,
      needs_evidence_count: needsEvidence.length,
      story_status: storyGate.status,
      architecture_status: architectureGate.status,
      spec_status: specGate.status,
      requirement_status: requirementGate.status
    },
    nodes: allNodes,
    edges
  };
}

function buildAgentReviewProcessDag(agentReviews) {
  const stages = agentReviews?.parallel_dispatch?.required_stages ?? [];
  if (!agentReviews?.required || stages.length === 0) return { nodes: [], terminal_nodes: [] };
  const stageLookup = new Map((agentReviews.stages ?? []).map((stage) => [stage.stage, stage]));
  const requiredRoleLookup = new Map(stages.map((stage) => [stage.stage, new Set(stage.roles ?? [])]));
  const nodes = [];
  const terminalNodes = [];
  for (const requiredStage of stages) {
    const stage = stageLookup.get(requiredStage.stage);
    const prepareId = `review:prepare:${requiredStage.stage}`;
    const dispatch = stage?.parallel_dispatch ?? {};
    const dispatchPrepared = Boolean(dispatch.prepared || stage?.roles?.some((role) => role.artifact));
    nodes.push({
      id: prepareId,
      type: 'agent_review_prepare_gate',
      label: `Review Prepare: ${requiredStage.stage}`,
      status: dispatchPrepared ? 'passed' : 'needs_review',
      required: true,
      command: requiredStage.prepare_command,
      artifact: requiredStage.dispatch_artifact,
      reason: dispatchPrepared
        ? 'Policy-aware agent review dispatch instructions were generated'
        : 'Policy-aware agent review dispatch instructions have not been generated'
    });

    const requiredRoles = requiredRoleLookup.get(requiredStage.stage);
    for (const role of (stage?.roles ?? []).filter((item) => !requiredRoles || requiredRoles.has(item.role))) {
      const reviewId = `review:${requiredStage.stage}:${role.role}`;
      const recordId = `review:record:${requiredStage.stage}:${role.role}`;
      const reviewStatus = normalizeAgentReviewNodeStatus(role.effective_status);
      const recordStatus = normalizeAgentReviewRecordStatus(role.effective_status);
      nodes.push({
        id: reviewId,
        type: 'agent_review_role_gate',
        label: `Agent Review: ${role.role}`,
        status: reviewStatus,
        required: true,
        reason: role.summary ?? role.stale_reason ?? `Run the ${requiredStage.stage}:${role.role} agent review`
      });
      nodes.push({
        id: recordId,
        type: 'agent_review_record_gate',
        label: `Review Record: ${role.role}`,
        status: recordStatus,
        required: true,
        artifact: role.artifact,
        reason: role.artifact
          ? `Recorded ${requiredStage.stage}:${role.role} review for the current git state`
          : `Record ${requiredStage.stage}:${role.role} with vibepro review record`
      });
      terminalNodes.push(recordId);
    }
  }
  return { nodes, terminal_nodes: terminalNodes };
}

function buildChangeClassificationGate(changeClassification) {
  const profile = changeClassification?.profile ?? 'light';
  return {
    id: 'gate:change_classification',
    type: 'change_classification_gate',
    label: 'Change Classification Gate',
    status: 'passed',
    required: true,
    profile,
    change_type: changeClassification?.change_type ?? 'simple_code_change',
    risk_surfaces: changeClassification?.risk_surfaces ?? [],
    reason: changeClassification?.reasons?.join('; ') || `Gate profile selected: ${profile}`
  };
}

function buildWorkflowHeavyGates({ changeClassification, inferredSpec, flowVerification, e2eCoverage, verificationEvidence }) {
  if (changeClassification?.profile !== 'workflow_heavy') return [];
  const flowEvidence = resolveWorkflowFlowEvidence({ flowVerification, e2eCoverage, verificationEvidence });
  const hasPassingFlowEvidence = flowEvidence.passed;
  const clauses = Array.isArray(inferredSpec?.clauses) ? inferredSpec.clauses : [];
  const scenarioCount = clauses.filter(isWorkflowStateScenarioClause).length;
  const blockerQuestions = (inferredSpec?.open_questions ?? []).filter((item) => item?.blocker === true);
  const stateMachineStatus = scenarioCount > 0 && blockerQuestions.length === 0 ? 'passed' : 'needs_evidence';
  const pathMatrixStatus = hasPassingFlowEvidence ? 'passed' : 'needs_evidence';
  const evidenceCoverageStatus = hasPassingFlowEvidence && scenarioCount > 0 && blockerQuestions.length === 0
    ? 'passed'
    : 'needs_evidence';
  return [
    {
      id: 'gate:workflow_state_machine',
      type: 'workflow_heavy_gate',
      label: 'Workflow State Machine Gate',
      status: stateMachineStatus,
      required: true,
      reason: stateMachineStatus === 'passed'
        ? `${scenarioCount} scenario clause(s) define workflow states and transitions`
        : blockerQuestions.length > 0
          ? `${blockerQuestions.length} blocker open question(s) must be resolved before workflow release readiness`
          : 'workflow_heavy changes require explicit scenario clauses for state transitions'
    },
    {
      id: 'gate:production_path_matrix',
      type: 'workflow_heavy_gate',
      label: 'Production Path Matrix Gate',
      status: pathMatrixStatus,
      required: true,
      reason: pathMatrixStatus === 'passed'
        ? flowEvidence.reason
        : flowEvidence.reason ?? 'workflow_heavy changes require production path matrix evidence via Flow Verification or current E2E evidence with story acceptance coverage'
    },
    {
      id: 'gate:workflow_flow_replay',
      type: 'workflow_heavy_gate',
      label: 'Workflow Flow Replay Gate',
      status: hasPassingFlowEvidence ? 'passed' : 'needs_evidence',
      required: true,
      reason: hasPassingFlowEvidence
        ? flowEvidence.reason
        : flowEvidence.reason ?? 'Run `vibepro verify flow . --base-url <url> --id <story-id>` or record current E2E evidence with story acceptance coverage before release'
    },
    {
      id: 'gate:evidence_coverage',
      type: 'workflow_heavy_gate',
      label: 'Evidence Coverage Gate',
      status: evidenceCoverageStatus,
      required: true,
      reason: evidenceCoverageStatus === 'passed'
        ? 'Workflow clauses and flow replay evidence are both present'
        : 'workflow_heavy release readiness requires scenario clauses plus flow replay evidence'
    },
    {
      id: 'gate:release_confidence',
      type: 'workflow_heavy_gate',
      label: 'Release Confidence Gate',
      status: evidenceCoverageStatus === 'passed' ? 'passed' : 'needs_evidence',
      required: true,
      confidence: {
        implementation_consistency: 'unknown',
        production_flow_coverage: hasPassingFlowEvidence ? 'medium' : 'low',
        state_matrix_coverage: scenarioCount > 0 ? 'medium' : 'low',
        release_confidence: evidenceCoverageStatus === 'passed' ? 'medium' : 'low'
      },
      reason: evidenceCoverageStatus === 'passed'
        ? 'workflow_heavy evidence is sufficient for human release review'
        : 'implementation may be consistent, but production workflow confidence is low'
    }
  ];
}

function resolveWorkflowFlowEvidence({ flowVerification, e2eCoverage, verificationEvidence }) {
  const flowStatus = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  const flowBinding = flowVerification?.verification?.binding ?? flowVerification?.binding ?? null;
  if (flowStatus === 'pass') {
    if (flowVerification?.story_mismatch === true) {
      return {
        passed: false,
        reason: `Flow Verification evidence is for ${flowVerification.verification?.story_id ?? 'another story'}, not ${flowVerification.expected_story_id}`
      };
    }
    if (!flowVerification?.artifact || flowVerification?.missing_artifact === true) {
      return {
        passed: false,
        reason: 'Flow Verification pass requires a readable flow-verification.json artifact'
      };
    }
    if (flowBinding?.status !== 'current') {
      return {
        passed: false,
        reason: flowBinding?.reason ?? 'Flow Verification evidence is not bound to the current git state'
      };
    }
    if (!hasPassingRuntimeProbeEvidence(flowVerification)) {
      return {
        passed: false,
        reason: 'Flow Verification pass requires at least one passing runtime probe'
      };
    }
    return { passed: true, reason: 'Flow Verification passed and is available as workflow replay evidence' };
  }
  if (flowStatus === 'fail') {
    return { passed: false, reason: 'Flow Verification failed; workflow replay evidence must pass before release' };
  }
  if (['needs_setup', 'skipped'].includes(flowStatus)) {
    return { passed: false, reason: 'Flow Verification did not produce passing workflow replay evidence' };
  }

  const e2eEvidence = Array.isArray(verificationEvidence?.commands)
    ? verificationEvidence.commands.find((item) => item.kind === 'e2e' && item.binding?.status === 'current')
    : null;
  if (!['pass', 'passed', 'success', 'ok'].includes(e2eEvidence?.status)) {
    return { passed: false, reason: 'workflow_heavy changes require current passing Flow Verification or E2E replay evidence' };
  }
  if (requiresStoryE2eCoverage(e2eCoverage) && e2eCoverage.status !== 'passed') {
    return { passed: false, reason: buildE2eCoverageReason(e2eCoverage) };
  }
  if (!e2eEvidenceCoversStoryAcceptance(e2eEvidence, e2eCoverage)) {
    return {
      passed: false,
      reason: 'Current E2E evidence must execute a story acceptance E2E file with executable assertions for workflow-heavy replay'
    };
  }
  return {
    passed: true,
    reason: requiresStoryE2eCoverage(e2eCoverage)
      ? 'Current E2E evidence passed with story acceptance coverage'
      : 'Current E2E evidence passed and no story acceptance coverage was required'
  };
}

function e2eEvidenceCoversStoryAcceptance(evidence, e2eCoverage) {
  if (!requiresStoryE2eCoverage(e2eCoverage)) return true;
  const executableFiles = Array.isArray(e2eCoverage.executable_matched_files)
    ? e2eCoverage.executable_matched_files
    : [];
  if (executableFiles.length === 0) return false;
  const command = normalizeRepoPath(evidence?.command ?? '').toLowerCase();
  return executableFiles.some((file) => command.includes(normalizeRepoPath(file).toLowerCase()));
}

function isWorkflowStateScenarioClause(clause) {
  if (clause?.type !== 'scenario') return false;
  const statement = String(clause.statement ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return /\b(workflow|flow|process|journey)\b/.test(statement)
    && /\b(state|status|transition|matrix|retry|poll|resume|rollback)\b/.test(statement);
}

function buildWorkflowHeavyEdges({ workflowHeavyGates, defaultUpstreamNodeId }) {
  if (workflowHeavyGates.length === 0) return [];
  return [
    { from: 'gate:change_classification', to: 'gate:workflow_state_machine' },
    { from: 'spec', to: 'gate:workflow_state_machine' },
    { from: 'gate:workflow_state_machine', to: 'gate:production_path_matrix' },
    { from: defaultUpstreamNodeId, to: 'gate:workflow_flow_replay' },
    { from: 'gate:production_path_matrix', to: 'gate:evidence_coverage' },
    { from: 'gate:workflow_flow_replay', to: 'gate:evidence_coverage' },
    { from: 'gate:evidence_coverage', to: 'gate:release_confidence' }
  ];
}

function buildAgentReviewStageUpstreams({ designQualityGate, visualQaGate }) {
  const implementationUpstream = 'gate:integration';
  const finalEvidenceUpstream = visualQaGate
    ? 'gate:visual_qa'
    : designQualityGate
      ? 'gate:design_quality'
      : 'gate:e2e';
  return {
    requirement: 'gate:requirement',
    architecture_spec: 'spec',
    test_plan: 'gate:requirement',
    implementation: implementationUpstream,
    gate: finalEvidenceUpstream
  };
}

function buildAgentReviewProcessEdges({ defaultUpstreamNodeId, agentReviewDag, stageUpstreams = {} }) {
  if (!agentReviewDag.nodes.length) return [{ from: defaultUpstreamNodeId, to: 'gate:agent_review' }];
  const edges = [];
  const prepareNodes = agentReviewDag.nodes.filter((node) => node.type === 'agent_review_prepare_gate');
  for (const prepareNode of prepareNodes) {
    const [, , stage] = prepareNode.id.split(':');
    edges.push({ from: stageUpstreams[stage] ?? defaultUpstreamNodeId, to: prepareNode.id });
    const roleNodes = agentReviewDag.nodes.filter((node) => node.type === 'agent_review_role_gate' && node.id.startsWith(`review:${stage}:`));
    for (const roleNode of roleNodes) {
      const role = roleNode.id.slice(`review:${stage}:`.length);
      const recordId = `review:record:${stage}:${role}`;
      edges.push({ from: prepareNode.id, to: roleNode.id });
      edges.push({ from: roleNode.id, to: recordId });
    }
  }
  for (const terminalNode of agentReviewDag.terminal_nodes) {
    edges.push({ from: terminalNode, to: 'gate:agent_review' });
  }
  return edges;
}

function normalizeAgentReviewNodeStatus(status) {
  if (status === 'pass') return 'passed';
  if (status === 'block') return 'failed';
  if (status === 'needs_changes') return 'needs_review';
  return status ?? 'missing';
}

function normalizeAgentReviewRecordStatus(status) {
  if (status === 'pass') return 'passed';
  if (status === 'block') return 'failed';
  return 'needs_review';
}

function buildNetworkContractGate(networkContracts, fileGroups, evidenceContext = {}) {
  if (!networkContracts) {
    return {
      id: 'gate:network_contract',
      type: 'verification_gate',
      label: 'Network Contract Gate',
      status: 'not_generated',
      required: fileGroups.source.count > 0,
      reason: 'Network contract scan was not generated'
    };
  }
  const missing = networkContracts.missing_routes?.length ?? 0;
  const dynamic = networkContracts.dynamic_calls?.length ?? 0;
  const replacements = networkContracts.high_risk_replacements?.length ?? 0;
  const introduced = networkContracts.introduced_api_client_call_count ?? 0;
  const networkEvidence = hasNetworkAwareEvidence(evidenceContext);
  let status = 'passed';
  if (missing > 0) status = 'failed';
  else if ((replacements > 0 || dynamic > 0) && !networkEvidence) status = 'needs_review';
  else if (introduced > 0 && !networkEvidence) status = 'needs_evidence';
  return {
    id: 'gate:network_contract',
    type: 'verification_gate',
    label: 'Network Contract Gate',
    status,
    required: fileGroups.source.count > 0 || introduced > 0,
    reason: missing > 0
      ? `${missing} /api client call(s) have no matching Next.js API route`
      : replacements > 0
        ? `${replacements} server function to HTTP API replacement(s) need route/schema/auth/runtime evidence`
        : dynamic > 0
          ? `${dynamic} dynamic /api client path(s) need explicit route/e2e evidence`
          : introduced > 0
            ? networkEvidence
              ? 'New API client calls have network-aware E2E or flow evidence'
              : 'New API client calls require network-aware E2E or route contract evidence'
            : 'No broken API client route contracts detected',
    summary: {
      api_client_call_count: networkContracts.api_client_call_count ?? 0,
      introduced_api_client_call_count: introduced,
      missing_route_count: missing,
      dynamic_call_count: dynamic,
      server_action_replacement_count: replacements
    },
    missing_routes: networkContracts.missing_routes ?? []
  };
}

function buildAgentReviewGate(agentReviews, fileGroups) {
  if (!agentReviews) {
    return {
      id: 'gate:agent_review',
      type: 'agent_review_gate',
      label: 'Agent Review Gate',
      status: 'not_generated',
      required: fileGroups.source.count > 0,
      reason: 'Agent Review summary was not generated',
      required_actions: [
        'Run `vibepro pr prepare` after initializing VibePro agent review support so required review stages can be calculated.'
      ]
    };
  }
  const status = agentReviews.status === 'pass'
    ? 'passed'
    : agentReviews.status === 'block'
      ? 'failed'
      : agentReviews.status === 'not_required'
        ? 'not_required'
        : 'needs_review';
  const unmet = agentReviews.unmet_required_reviews ?? [];
  const requiredActions = buildAgentReviewRequiredActions(agentReviews, status, unmet);
  return {
    id: 'gate:agent_review',
    type: 'agent_review_gate',
    label: 'Agent Review Gate',
    status,
    required: agentReviews.required === true,
    reason: status === 'passed'
      ? 'Required staged agent reviews passed for the current git state'
      : status === 'not_required'
        ? 'No source/API/UI/performance policy required staged agent reviews'
        : `${unmet.length} required agent review role(s) are missing, stale, or blocking; run the listed vibepro review prepare command(s), then dispatch the generated Codex/Claude Code subagent reviews in parallel and record their provenance.`,
    summary: agentReviews.summary,
    parallel_dispatch: agentReviews.parallel_dispatch,
    dispatch_contract: {
      required: status !== 'passed' && status !== 'not_required',
      expected: 'dispatch_parallel_subagents',
      user_confirmation_required_by_vibepro: false,
      runner_policy_may_require_user_delegation: false,
      manual_review_fallback: false,
      applies_to: ['codex', 'claude_code']
    },
    required_actions: requiredActions,
    unmet_required_reviews: unmet.slice(0, 20)
  };
}

function buildAgentReviewRequiredActions(agentReviews, status, unmet) {
  if (status === 'passed' || status === 'not_required') return [];
  const requiredStages = agentReviews.parallel_dispatch?.required_stages ?? [];
  const actions = [];
  const missingOrUnpreparedStages = requiredStages
    .filter((stage) => stage.status !== 'pass' || stage.prepared !== true)
    .map((stage) => ({
      stage: stage.stage,
      command: stage.prepare_command,
      artifact: stage.dispatch_artifact,
      prepared: stage.prepared
    }));
  for (const stage of missingOrUnpreparedStages) {
    actions.push(`Run \`${stage.command}\` and use ${stage.artifact}; dispatch the listed Codex/Claude Code subagent reviews in parallel, close/shutdown each review subagent after receiving its result, then record every result with parallel_subagent provenance and --agent-closed.`);
  }
  if (unmet.length > 0) {
    const roleList = unmet.slice(0, 12)
      .map((item) => `${item.stage}:${item.role}(${item.status}${item.detail ? `: ${item.detail}` : ''})`)
      .join(', ');
    actions.push(`Complete and record current-git review results for: ${roleList}.`);
  }
  actions.push('After closing review subagents and recording all roles with parallel_subagent provenance and closed subagent lifecycle, run `vibepro review status . --id <story-id>` and `vibepro pr prepare . --story-id <story-id> --base <base-ref>` again.');
  return actions;
}

function hasNetworkAwareEvidence({ flowVerification, verificationEvidence }) {
  const flowStatus = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  const flowBinding = flowVerification?.verification?.binding ?? flowVerification?.binding ?? null;
  if (flowStatus === 'pass'
    && flowBinding?.status === 'current'
    && flowVerification?.story_mismatch !== true
    && flowVerification?.artifact
    && flowVerification?.missing_artifact !== true
    && hasPassingRuntimeProbeEvidence(flowVerification)) {
    return true;
  }
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return commands.some((item) => {
    const kind = item.kind === 'flow' ? 'e2e' : item.kind;
    return kind === 'e2e'
      && item.binding?.status === 'current'
      && ['pass', 'passed', 'success', 'ok'].includes(item.status)
      && verificationCommandHasNetworkContractScope(item);
  });
}

function verificationCommandHasNetworkContractScope(item) {
  const text = `${item.command ?? ''}\n${item.summary ?? ''}\n${item.artifact ?? ''}`.toLowerCase();
  return /network[-_\s]?aware|network contract|route contract|api route|\/api\//.test(text);
}

function buildVerificationGates({ fileGroups, verificationCommands, e2eCommand, flowVerification, e2eCoverage, visualQaEvidence, verificationEvidence }) {
  const unitCommand = verificationCommands.find((item) => item.kind === 'unit' || item.command.startsWith('npm test')) ?? null;
  const typecheckCommand = verificationCommands.find((item) => item.kind === 'typecheck' || /\b(type-?check|tsc)\b/.test(item.command)) ?? null;
  const e2eRequired = shouldRequireE2eGate({ fileGroups, e2eCommand, flowVerification, visualQaEvidence });
  const gateE2eCoverage = e2eRequired ? e2eCoverage : markE2eCoverageNotApplicable(e2eCoverage);
  const e2eGateStatus = e2eRequired ? resolveE2eGateStatus(e2eCommand, flowVerification, e2eCoverage) : 'not_required';
  const e2eReason = e2eRequired
    ? buildE2eGateReason(e2eCommand, flowVerification, e2eCoverage)
    : 'UI/E2E対象の差分ではないため、Unit / Integration証跡で完了判定する';
  return [
    {
      id: 'gate:unit',
      type: 'verification_gate',
      label: 'Unit Gate',
      status: unitCommand ? 'candidate' : 'missing',
      required: fileGroups.source.count > 0 || fileGroups.tests.count > 0,
      command: unitCommand?.command ?? 'npm test',
      reason: unitCommand?.reason ?? '受け入れ基準に対応するUnitテストを追加・実行する'
    },
    {
      id: 'gate:integration',
      type: 'verification_gate',
      label: 'Integration Gate',
      status: typecheckCommand || fileGroups.tests.count > 0 ? 'needs_evidence' : 'missing',
      required: fileGroups.source.count > 0,
      command: typecheckCommand?.command ?? 'npm test',
      reason: '最終出力経路や型境界を含む統合確認を実行する'
    },
    {
      id: 'gate:e2e',
      type: 'verification_gate',
      label: 'E2E Gate',
      status: e2eGateStatus,
      required: e2eRequired,
      command: e2eRequired ? e2eCommand.command : null,
      reason: e2eReason,
      flow_verification: flowVerification ? summarizeFlowVerificationForGate(flowVerification) : null,
      acceptance_e2e_coverage: gateE2eCoverage,
      artifact_expectation: e2eRequired ? '.vibepro/verification/<run-id>/ にPlaywright CLIのログとスクリーンショットを残す' : null
    }
  ].map((gate) => applyVerificationEvidence(gate, verificationEvidence));
}

function markE2eCoverageNotApplicable(e2eCoverage) {
  if (!e2eCoverage) return null;
  return {
    ...e2eCoverage,
    required: false,
    status: 'not_applicable',
    not_applicable_reason: 'E2E Gate is not required for this non-UI/non-flow change; Unit and Integration evidence are authoritative.',
    missing_acceptance_criteria: []
  };
}

function shouldRequireE2eGate({ fileGroups, e2eCommand, flowVerification, visualQaEvidence = null }) {
  if (hasUiExperienceSourceChange(fileGroups)) return true;
  if (fileGroups.tests.files.some((file) => file.startsWith('e2e/'))) return true;
  if (fileGroups.repo_control.files.some(isE2eInfraPath)) return true;
  if (e2eCommand?.detected) return true;
  if (flowVerification) return true;
  if (visualQaEvidence) return true;
  return false;
}

function isE2eInfraPath(filePath) {
  return filePath.startsWith('e2e/')
    || /^playwright\.config\.[cm]?[jt]s$/.test(filePath);
}

function isPackageManifestPath(filePath) {
  return ['package.json', 'package-lock.json'].includes(filePath);
}

function hasUiExperienceSourceChange(fileGroups) {
  return fileGroups.source.files.some((file) => {
    if (
      file.startsWith('app/')
      || file.startsWith('pages/')
      || file.startsWith('components/')
      || file.startsWith('public/')
      || file.startsWith('src/app/')
      || file.startsWith('src/pages/')
      || file.startsWith('src/components/')
      || file.startsWith('src/features/')
    ) {
      return true;
    }
    return /\.(css|scss|sass|less|html|vue|svelte|tsx)$/.test(file);
  });
}

function applyVerificationEvidence(gate, verificationEvidence) {
  const evidence = findVerificationEvidenceForGate(gate, verificationEvidence);
  if (!evidence) return gate;
  const evidenceStatus = normalizeVerificationEvidenceStatus(evidence.status);
  const artifact = evidence.artifact ?? verificationEvidence?.artifact ?? null;
  const summary = evidence.summary ?? evidence.reason ?? evidence.status ?? 'verification evidence recorded';
  const coverageReason = gate.id === 'gate:e2e'
    && evidenceStatus === 'passed'
    && requiresStoryE2eCoverage(gate.acceptance_e2e_coverage)
    && gate.acceptance_e2e_coverage.status !== 'passed'
    ? buildE2eCoverageReason(gate.acceptance_e2e_coverage)
    : null;
  const status = coverageReason ? 'needs_evidence' : evidenceStatus;
  const reason = [summary, coverageReason, artifact ? `evidence: ${artifact}` : null]
    .filter(Boolean)
    .join('; ');
  return {
    ...gate,
    status,
    command: evidence.command ?? gate.command,
    reason,
    evidence: {
      kind: evidence.kind ?? null,
      status: evidence.status ?? null,
      summary,
      artifact,
      executed_at: evidence.executed_at ?? null,
      binding: evidence.binding ?? null
    }
  };
}

function findVerificationEvidenceForGate(gate, verificationEvidence) {
  const items = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  if (items.length === 0) return null;
  const kindMap = {
    'gate:unit': ['unit', 'test'],
    'gate:integration': ['integration', 'typecheck', 'build'],
    'gate:e2e': ['e2e', 'flow']
  };
  const expectedKinds = kindMap[gate.id] ?? [];
  const matches = items.filter((item) => expectedKinds.includes(item.kind));
  if (matches.length === 0) return null;
  const currentMatches = matches.filter((item) => item.binding?.status === 'current');
  if (currentMatches.length > 0) {
    return currentMatches.find((item) => ['fail', 'failed', 'error'].includes(item.status))
      ?? currentMatches.find((item) => ['pass', 'passed', 'success', 'ok'].includes(item.status))
      ?? currentMatches[0];
  }
  const stale = matches[0];
  return {
    kind: stale.kind,
    status: 'needs_evidence',
    command: stale.command,
    summary: stale.binding?.reason ?? 'verification evidence is not bound to the current git state',
    artifact: stale.artifact,
    executed_at: stale.executed_at,
    binding: stale.binding ?? {
      status: 'legacy',
      reason: 'legacy verification evidence is not bound to a git head'
    }
  };
}

function normalizeVerificationEvidenceStatus(status) {
  if (['pass', 'passed', 'success', 'ok'].includes(status)) return 'passed';
  if (['fail', 'failed', 'error'].includes(status)) return 'failed';
  if (status === 'needs_setup') return 'needs_setup';
  return 'needs_evidence';
}

function resolveE2eGateStatus(e2eCommand, flowVerification, e2eCoverage = null) {
  const status = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  const binding = flowVerification?.verification?.binding ?? flowVerification?.binding ?? null;
  if (status === 'fail') return 'failed';
  if (status === 'needs_setup') return 'needs_setup';
  if (status === 'skipped') return 'needs_evidence';
  if (e2eCommand.reliable_exit === false) return 'needs_setup';
  if (requiresStoryE2eCoverage(e2eCoverage) && e2eCoverage.status !== 'passed') return 'needs_evidence';
  if (status === 'pass' && (!flowVerification?.artifact || flowVerification?.missing_artifact === true)) return 'needs_evidence';
  if (status === 'pass' && binding?.status !== 'current') return 'needs_evidence';
  if (status === 'pass' && !hasPassingRuntimeProbeEvidence(flowVerification)) return 'needs_evidence';
  if (status === 'pass') return 'passed';
  return e2eCommand.detected ? 'needs_evidence' : 'needs_setup';
}

function buildE2eGateReason(e2eCommand, flowVerification, e2eCoverage = null) {
  const status = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  const runId = flowVerification?.verification?.run_id ?? flowVerification?.run_id ?? null;
  const artifact = flowVerification?.artifact ?? flowVerification?.artifacts?.flow_verification_json ?? null;
  const binding = flowVerification?.verification?.binding ?? flowVerification?.binding ?? null;
  const coverageReason = buildE2eCoverageReason(e2eCoverage);
  if (status === 'pass') {
    if (!artifact || flowVerification?.missing_artifact === true) return 'Flow Verification pass requires a readable flow-verification.json artifact';
    if (binding?.status !== 'current') return binding?.reason ?? 'Flow Verification evidence is not bound to the current git state';
    if (!hasPassingRuntimeProbeEvidence(flowVerification)) return 'Flow Verification pass requires at least one passing runtime probe';
    const flowReason = `Flow Verification passed${runId ? ` (${runId})` : ''}${artifact ? `: ${artifact}` : ''}`;
    return coverageReason ? `${flowReason}; ${coverageReason}` : flowReason;
  }
  if (status === 'fail') {
    const flowReason = `Flow Verification failed${runId ? ` (${runId})` : ''}${artifact ? `: ${artifact}` : ''}`;
    return coverageReason ? `${flowReason}; ${coverageReason}` : flowReason;
  }
  if (status === 'needs_setup') {
    const flowReason = `Flow Verification needs setup${runId ? ` (${runId})` : ''}: ${flowVerification?.verification?.reason ?? flowVerification?.reason ?? e2eCommand.reason}`;
    return coverageReason ? `${flowReason}; ${coverageReason}` : flowReason;
  }
  if (status === 'skipped') {
    const flowReason = `Flow Verification skipped${runId ? ` (${runId})` : ''}; runnable non-mutating probes are required for PR evidence.`;
    return coverageReason ? `${flowReason}; ${coverageReason}` : flowReason;
  }
  return coverageReason ? `${e2eCommand.reason}; ${coverageReason}` : e2eCommand.reason;
}

function requiresStoryE2eCoverage(e2eCoverage) {
  return Boolean(e2eCoverage?.required);
}

function buildE2eCoverageReason(e2eCoverage) {
  if (!requiresStoryE2eCoverage(e2eCoverage)) return null;
  if (e2eCoverage.status === 'passed') {
    return `Story E2E coverage passed: ${e2eCoverage.matched_files.join(', ')}`;
  }
  if ((e2eCoverage.matched_files?.length ?? 0) > 0 && (e2eCoverage.executable_matched_files?.length ?? 0) === 0) {
    return `Story E2E coverage needs evidence: matched files contain no executable assertions (${e2eCoverage.matched_files.join(', ')})`;
  }
  const missing = e2eCoverage.missing_acceptance_criteria ?? [];
  const missingLabel = missing.map((item) => item.id).join(', ') || 'acceptance criteria';
  if ((e2eCoverage.matched_files?.length ?? 0) > 0) {
    return `Story E2E coverage needs evidence: ${missingLabel} must be covered by executable assertions in ${e2eCoverage.expected_file_patterns.join(' or ')}`;
  }
  return `Story E2E coverage needs evidence: ${missingLabel} must be covered by ${e2eCoverage.expected_file_patterns.join(' or ')}`;
}

function summarizeFlowVerificationForGate(flowVerification) {
  const verification = flowVerification.verification ?? flowVerification;
  return {
    run_id: verification.run_id ?? flowVerification.run_id ?? null,
    status: verification.status ?? flowVerification.status ?? null,
    base_url: verification.base_url ?? flowVerification.base_url ?? null,
    artifact: flowVerification.artifact ?? flowVerification.artifacts?.flow_verification_json ?? null,
    report: flowVerification.artifacts?.flow_verification_report ?? null,
    summary: verification.summary ?? flowVerification.summary ?? null
  };
}

function hasPassingRuntimeProbeEvidence(flowVerification) {
  const verification = flowVerification?.verification ?? flowVerification;
  const probes = Array.isArray(verification?.probes)
    ? verification.probes
    : Array.isArray(flowVerification?.probes)
      ? flowVerification.probes
      : [];
  return probes.some((probe) => ['pass', 'passed', 'success', 'ok'].includes(probe?.status));
}

function resolveRequirementGateStatus(requirement) {
  if (!requirement) return 'not_generated';
  if (requirement.status === 'contradicted') return 'contradicted';
  if (requirement.status === 'needs_review') return 'needs_review';
  if (requirement.status === 'pass') return 'passed';
  return 'not_applicable';
}

function buildRequirementGateReason(requirement) {
  if (!requirement) return 'Requirement Consistencyが未生成';
  if (requirement.status === 'contradicted') {
    return `${requirement.summary?.contradiction_count ?? 0}件の要件矛盾候補がある`;
  }
  if (requirement.status === 'needs_review') {
    return `${requirement.summary?.scenario_gap_count ?? 0}件のStory未明示シナリオがある`;
  }
  if (requirement.status === 'pass') {
    return 'Story不変条件と変更コードの既知分岐に明確な矛盾は検出されていない';
  }
  return 'Story不変条件を抽出できなかったため適用外';
}

async function detectPlaywrightCommand(repoRoot, fileGroups = null) {
  let packageJson = null;
  try {
    packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    return {
      detected: false,
      command: 'npx playwright test',
      reason: 'package.jsonが見つからないため、Playwright CLIでE2E確認を追加する'
    };
  }

  const scripts = packageJson.scripts ?? {};
  const harnessRisk = await detectPlaywrightHarnessRisk(repoRoot);
  const scopedE2eFiles = findScopedE2eSpecFiles(fileGroups);
  if (scopedE2eFiles.length > 0 && hasPlaywrightDependency(packageJson)) {
    return {
      detected: true,
      reliable_exit: !harnessRisk.masks_exit,
      command: `npx playwright test ${scopedE2eFiles.join(' ')} --project=chromium`,
      reason: withPlaywrightHarnessRisk('差分に含まれるE2E specへスコープしてPlaywright CLIで確認する', harnessRisk)
    };
  }

  const preferredNames = ['test:e2e', 'e2e', 'test:playwright', 'playwright'];
  const preferred = preferredNames.find((name) => scripts[name]);
  if (preferred) {
    if (scriptMasksFailures(scripts[preferred]) && hasPlaywrightDependency(packageJson)) {
      return {
        detected: true,
        reliable_exit: !harnessRisk.masks_exit,
        command: 'npx playwright test',
        reason: withPlaywrightHarnessRisk(`package.json の ${preferred} scriptは失敗exit codeを握りつぶす可能性があるため、Playwright CLIを直接実行する`, harnessRisk)
      };
    }
    return {
      detected: true,
      reliable_exit: !harnessRisk.masks_exit,
      command: `npm run ${preferred}`,
      reason: withPlaywrightHarnessRisk(`package.json の ${preferred} scriptでPlaywright E2Eを実行する`, harnessRisk)
    };
  }

  const scriptEntry = Object.entries(scripts).find(([, command]) => /\bplaywright\b/.test(command));
  if (scriptEntry) {
    if (scriptMasksFailures(scriptEntry[1]) && hasPlaywrightDependency(packageJson)) {
      return {
        detected: true,
        reliable_exit: !harnessRisk.masks_exit,
        command: 'npx playwright test',
        reason: withPlaywrightHarnessRisk(`package.json の ${scriptEntry[0]} scriptは失敗exit codeを握りつぶす可能性があるため、Playwright CLIを直接実行する`, harnessRisk)
      };
    }
    return {
      detected: true,
      reliable_exit: !harnessRisk.masks_exit,
      command: `npm run ${scriptEntry[0]}`,
      reason: withPlaywrightHarnessRisk(`package.json の ${scriptEntry[0]} scriptでPlaywright E2Eを実行する`, harnessRisk)
    };
  }

  if (hasPlaywrightDependency(packageJson)) {
    return {
      detected: true,
      reliable_exit: !harnessRisk.masks_exit,
      command: 'npx playwright test',
      reason: withPlaywrightHarnessRisk('Playwright依存があるためCLIでE2Eを実行する', harnessRisk)
    };
  }

  return {
    detected: false,
    reliable_exit: !harnessRisk.masks_exit,
    command: 'npx playwright test',
    reason: withPlaywrightHarnessRisk('Playwright scriptが未検出のため、対象フローのE2Eを追加してCLIで確認する', harnessRisk)
  };
}

async function detectTypecheckCommand(repoRoot) {
  let packageJson = null;
  try {
    packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    return {
      command: 'npm run typecheck',
      reason: 'TypeScript/型境界の確認'
    };
  }

  const scripts = packageJson.scripts ?? {};
  for (const name of ['type-check', 'typecheck', 'check:types', 'tsc']) {
    if (scripts[name]) {
      return {
        command: `npm run ${name}`,
        reason: `package.json の ${name} scriptでTypeScript/型境界を確認する`
      };
    }
  }
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  if (deps.typescript) {
    return {
      command: 'npx tsc --noEmit',
      reason: 'TypeScript依存があるためCLIで型境界を確認する'
    };
  }
  return {
    command: 'npm run typecheck',
    reason: 'TypeScript/型境界の確認'
  };
}

async function detectTestRunner(repoRoot) {
  let packageJson = null;
  try {
    packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const testScript = packageJson.scripts?.test ?? '';
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  if (/\bvitest\b/.test(testScript) || deps.vitest) return 'vitest';
  if (/\bjest\b/.test(testScript) || deps.jest) return 'jest';
  if (/\bnode\s+--test\b/.test(testScript)) return 'node';
  return null;
}

function hasPlaywrightDependency(packageJson) {
  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  return Boolean(deps['@playwright/test'] || deps.playwright);
}

function findScopedE2eSpecFiles(fileGroups) {
  return (fileGroups?.tests?.files ?? [])
    .filter((file) => file.startsWith('e2e/'))
    .filter((file) => /\.(spec|test)\.[jt]sx?$/.test(file))
    .slice(0, 4);
}

function scriptMasksFailures(command) {
  return /\|\|\s*true\b/.test(command)
    || /;\s*exit\s+0\b/.test(command);
}

async function detectPlaywrightHarnessRisk(repoRoot) {
  for (const configName of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs', 'playwright.config.cjs']) {
    let content = null;
    try {
      content = await readFile(path.join(repoRoot, configName), 'utf8');
    } catch {
      continue;
    }
    const teardownMatch = content.match(/globalTeardown\s*:\s*['"](.+?)['"]/);
    if (!teardownMatch) return { masks_exit: false, reason: null };
    const teardownPath = path.resolve(repoRoot, teardownMatch[1]);
    try {
      const teardown = await readFile(teardownPath, 'utf8');
      if (/process\.exit\(\s*0\s*\)/.test(teardown)) {
        return {
          masks_exit: true,
          reason: `${path.relative(repoRoot, teardownPath)} が process.exit(0) でE2E失敗を成功exitに上書きする可能性がある`
        };
      }
    } catch {
      return {
        masks_exit: true,
        reason: `${teardownMatch[1]} が参照されているが読み取れないため、E2E teardownのexit code信頼性を確認する`
      };
    }
    return { masks_exit: false, reason: null };
  }
  return { masks_exit: false, reason: null };
}

function withPlaywrightHarnessRisk(reason, harnessRisk) {
  if (!harnessRisk?.masks_exit) return reason;
  return `${reason}; ${harnessRisk.reason}`;
}

function buildReviewPoints(fileGroups, taskContext = null) {
  const points = [];
  if (taskContext) points.push(`Task/Handoffの完了条件と差分が対応しているか: ${taskContext.task.id}`);
  if (fileGroups.story_docs.count > 0) points.push('Storyの受け入れ基準と実装差分が対応しているか');
  if (fileGroups.policy_docs.count > 0) points.push('方針文書とStory / Spec / Architectureが矛盾していないか');
  if (fileGroups.architecture_docs.count === 0) points.push('ADRなしで既存設計の範囲に収まっているか');
  if (fileGroups.source.count > 0) points.push(`主要ソース差分: ${formatFileList(fileGroups.source.files)}`);
  if (fileGroups.tests.count > 0) points.push(`テスト差分: ${formatFileList(fileGroups.tests.files)}`);
  return points;
}

function buildRisks({ git, fileGroups, latestStoryRun, gateDag, taskContext = null, specDrift = null, networkContracts = null, agentReviews = null }) {
  const risks = [];
  const dirtyFiles = git.dirty_files.filter((file) => !isWorkspaceArtifactPath(file.path));
  if (Array.isArray(specDrift?.items)) {
    const highDrift = specDrift.items.filter((item) => item.severity === 'high');
    if (highDrift.length > 0) {
      risks.push(`Spec drift severity=high が ${highDrift.length} 件 (詳細: .vibepro/spec/${specDrift.story_id}/drift.md)`);
    }
  }
  if (taskContext && !taskContext.artifacts.handoff_json) {
    risks.push('Task指定はあるがhandoff.jsonが見つからない');
  }
  if (fileGroups.tests.count === 0 && fileGroups.source.count > 0) {
    risks.push('ソース差分に対するテスト差分がない');
  }
  if (dirtyFiles.length > 0) {
    risks.push(`未コミット差分が ${dirtyFiles.length} files ある`);
  }
  if ((git.commit_message_health?.empty_message_count ?? 0) > 0) {
    const shas = git.commit_message_health.empty_message_commits
      .map((commit) => commit.short_sha ?? commit.sha)
      .filter(Boolean)
      .join(', ');
    risks.push(`commit messageが空のcommitが ${git.commit_message_health.empty_message_count} 件ある${shas ? ` (${shas})` : ''}`);
  }
  if (fileGroups.repo_control.count > 0) {
    risks.push('repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする');
  }
  if (latestStoryRun?.gate_status && !['pass', 'ok'].includes(latestStoryRun.gate_status)) {
    risks.push(`最新診断gateが ${latestStoryRun.gate_status}`);
  }
  if ((networkContracts?.missing_routes?.length ?? 0) > 0) {
    risks.push(`Network Contract Gate: 対応routeがない /api client call が ${networkContracts.missing_routes.length} 件`);
  }
  if ((networkContracts?.introduced_api_client_call_count ?? 0) > 0 && fileGroups.tests.count === 0) {
    risks.push('新規API client callがあるが、差分内にネットワーク/E2E/route契約テストがない');
  }
  if ((agentReviews?.unmet_required_reviews?.length ?? 0) > 0) {
    risks.push(`Agent Review Gate: required review role が ${agentReviews.unmet_required_reviews.length} 件未解決`);
  }
  const e2eGate = gateDag?.nodes?.find((node) => node.id === 'gate:e2e');
  if (e2eGate?.required && ['needs_evidence', 'needs_setup'].includes(e2eGate.status)) {
    risks.push('E2E GateのPlaywright CLI証跡が未記録');
  }
  if (e2eGate?.required && e2eGate.status === 'failed') {
    risks.push(`E2E Gateが failed: ${e2eGate.reason}`);
  }
  const requirementGate = gateDag?.nodes?.find((node) => node.id === 'gate:requirement');
  if (requirementGate?.required && ['needs_review', 'contradicted'].includes(requirementGate.status)) {
    risks.push(`Requirement Gateが ${requirementGate.status}: ${requirementGate.reason}`);
  }
  const architectureGate = gateDag?.nodes?.find((node) => node.id === 'architecture');
  if (architectureGate?.required && isUnresolvedGateStatus(architectureGate.status)) {
    risks.push(`Architecture Gateが ${architectureGate.status}: ${architectureGate.reason}`);
  }
  const specGate = gateDag?.nodes?.find((node) => node.id === 'spec');
  if (specGate?.required && isUnresolvedGateStatus(specGate.status)) {
    risks.push(`Spec Gateが ${specGate.status}: ${specGate.reason}`);
  }
  const networkGate = gateDag?.nodes?.find((node) => node.id === 'gate:network_contract');
  if (networkGate?.required && isUnresolvedGateStatus(networkGate.status)) {
    risks.push(`Network Contract Gateが ${networkGate.status}: ${networkGate.reason}`);
  }
  const agentReviewGate = gateDag?.nodes?.find((node) => node.id === 'gate:agent_review');
  if (agentReviewGate?.required && isUnresolvedGateStatus(agentReviewGate.status)) {
    risks.push(`Agent Review Gateが ${agentReviewGate.status}: ${agentReviewGate.reason}`);
  }
  return risks;
}

function renderPrGateSummary(gateDag) {
  const gates = gateDag.nodes.filter((node) => node.type === 'verification_gate');
  const storyGate = gateDag.nodes.find((node) => node.id === 'story');
  const architectureGate = gateDag.nodes.find((node) => node.id === 'architecture');
  const specGate = gateDag.nodes.find((node) => node.id === 'spec');
  const requirementGate = gateDag.nodes.find((node) => node.id === 'gate:requirement');
  const agentReviewGate = gateDag.nodes.find((node) => node.id === 'gate:agent_review');
  const lines = [
    `- overall: ${gateDag.overall_status}`,
    `- acceptance criteria: ${gateDag.summary.acceptance_criteria_count}`,
    storyGate
      ? `- ${storyGate.label}: ${storyGate.status} (${storyGate.required ? 'required' : 'optional'}) - ${storyGate.reason ?? storyGate.artifact ?? '-'}`
      : null,
    architectureGate
      ? `- ${architectureGate.label}: ${architectureGate.status} (${architectureGate.required ? 'required' : 'optional'}) - ${architectureGate.reason ?? '-'}`
      : null,
    specGate
      ? `- ${specGate.label}: ${specGate.status} (${specGate.required ? 'required' : 'optional'}) - ${specGate.reason ?? '-'}`
      : null,
    requirementGate
      ? `- ${requirementGate.label}: ${requirementGate.status} (${requirementGate.required ? 'required' : 'optional'}) - ${requirementGate.reason}`
      : null,
    agentReviewGate
      ? `- ${agentReviewGate.label}: ${agentReviewGate.status} (${agentReviewGate.required ? 'required' : 'optional'}) - ${agentReviewGate.reason}`
      : null,
    ...gates.map((gate) => {
      const required = gate.required ? 'required' : 'optional';
      const detail = gate.command ? `\`${gate.command}\`` : (gate.reason ?? '-');
      return `- ${gate.label}: ${gate.status} (${required}) - ${detail}`;
    })
  ].filter(Boolean);
  return lines.join('\n');
}

function renderRequirementPrSection(requirement, language = 'ja') {
  if (!requirement) {
    return localizedText(language, {
      ja: '- Requirement Consistency未生成\n- 次に足すもの: Storyに受け入れ基準、Specに守るべき挙動、Architectureに境界/ADR要否を追加すると判定できます。',
      en: '- Requirement Consistency not generated\n- What to add next: add Story acceptance criteria, Spec behavioral invariants, and Architecture boundary/ADR notes.'
    });
  }
  const summary = requirement.summary ?? {};
  const sources = [
    `- Requirement Sources: ${summary.requirement_source_count ?? 0}`,
    `- Spec Sources: ${summary.spec_ref_count ?? 0}`,
    `- Architecture Sources: ${summary.architecture_ref_count ?? 0}`,
    `- Policy Sources: ${summary.policy_ref_count ?? 0}`
  ].join('\n');
  const sourceRefs = (requirement.requirement_sources ?? []).slice(0, 6)
    .map((item) => `- Requirement Source: ${item.kind}:${item.path}${item.title ? ` - ${item.title}` : ''}`)
    .join('\n');
  const invariants = (requirement.invariants ?? []).slice(0, 5)
    .map((item) => {
      const source = item.source ? ` (${item.source.kind}:${item.source.path ?? '-'})` : '';
      return `- Invariant: ${item.text}${source}`;
    })
    .join('\n');
  const gaps = (requirement.scenario_gaps ?? []).slice(0, 5)
    .map((item) => `- Scenario Gap: ${item.detail}`)
    .join('\n');
  const contradictions = (requirement.contradictions ?? []).slice(0, 5)
    .map((item) => `- Potential Contradiction: ${item.detail}`)
    .join('\n');
  return [
    renderRequirementGateSummary(requirement),
    renderRequirementPrHint(requirement, language),
    sources,
    sourceRefs,
    invariants,
    gaps,
    contradictions
  ].filter(Boolean).join('\n');
}

function renderRequirementPrHint(requirement, language = 'ja') {
  if (requirement.status === 'not_applicable') {
    return localizedText(language, {
      ja: '- 次に足すもの: Story/Spec/Architectureから判定に使える不変条件が十分に取れていません。Storyに受け入れ基準、Specに守るべき挙動、Architectureに境界やADR要否を書くと有効になります。',
      en: '- What to add next: VibePro could not extract enough invariants from Story/Spec/Architecture. Add acceptance criteria to Story, behavioral invariants to Spec, and boundary/ADR notes to Architecture.'
    });
  }
  if (requirement.status === 'needs_review') {
    return localizedText(language, {
      ja: '- 次に見るもの: Story未明示シナリオを確認し、意図した挙動ならStory/Specへ追記、意図しないなら実装かテストを修正してください。',
      en: '- Review next: scenario gaps. If intended, add them to Story/Spec; otherwise fix implementation or tests.'
    });
  }
  if (requirement.status === 'contradicted') {
    return localizedText(language, {
      ja: '- 次に直すもの: Story/Spec/Architectureと実装の矛盾候補を解消してください。',
      en: '- Fix next: resolve potential contradictions between Story/Spec/Architecture and implementation.'
    });
  }
  return localizedText(language, {
    ja: '- 補足: Story/Spec/Architectureと既知の実装分岐に明確な矛盾はありません。',
    en: '- Note: no clear contradiction was found between Story/Spec/Architecture and known implementation branches.'
  });
}

function renderPrGateEnforcement(gateDag) {
  const unresolved = collectUnresolvedRequiredGates(gateDag);
  if (unresolved.length === 0) {
    return [
      '- status: ready_for_review',
      '- completion: Gate証跡が揃っているため、VibePro上は完了扱い可能'
    ].join('\n');
  }

  return [
    '- status: blocked_by_gate',
    '- completion: 未完了Gateが残っているため、このPRはVibePro上の完了扱い不可',
    `- unresolved: ${formatUnresolvedGateList(unresolved)}`,
    '- required action: critical Gateは証跡で解消する。非critical Gateのみ `vibepro pr create --allow-needs-verification --verification-waiver <reason>` で理由付きwaiverを記録できる',
    '- guardrail: 生の `gh pr create` はVibePro Gateを通らないため、PR作成経路として使わない'
  ].join('\n');
}

function collectUnresolvedRequiredGates(gateDag) {
  return (gateDag?.nodes ?? [])
    .filter((node) => [
      'story',
      'architecture_gate',
      'spec_gate',
      'verification_gate',
      'requirement_gate',
      'visual_qa_gate',
      'design_quality_gate',
      'workflow_heavy_gate',
      'agent_review_prepare_gate',
      'agent_review_role_gate',
      'agent_review_record_gate',
      'agent_review_gate'
    ].includes(node.type))
    .filter((node) => node.required)
    .filter((node) => isUnresolvedGateStatus(node.status))
    .map((node) => ({
      id: node.id,
      type: node.type,
      label: node.label,
      status: node.status,
      command: node.command,
      artifact: node.artifact,
      required_actions: node.required_actions,
      reason: node.reason
    }));
}

function isUnresolvedGateStatus(status) {
  return [
    'candidate',
    'missing',
    'transient',
    'implicit',
    'inferred_empty',
    'needs_evidence',
    'needs_setup',
    'needs_review',
    'needs_changes',
    'contradicted',
    'stale',
    'block',
    'failed'
  ].includes(status);
}

function formatUnresolvedGateList(gates) {
  if (!gates || gates.length === 0) return 'none';
  return gates
    .map((gate) => `${gate.label ?? gate.id}:${gate.status}`)
    .join(', ');
}

function formatCriticalGateEvidenceInstructions(gates) {
  if (!gates || gates.length === 0) return 'none';
  return gates
    .map((gate) => {
      if (gate.id === 'gate:e2e') return 'E2E Gate requires passing `vibepro verify record --kind e2e --status pass` evidence or passing flow verification, plus Story acceptance coverage in tests/e2e/<story-id>-*.spec.ts.';
      if (gate.id === 'gate:visual_qa') return 'Visual QA Gate requires ready_for_review visual QA evidence.';
      if (gate.id === 'architecture') return 'Architecture Gate requires an ADR or explicit ADR-unnecessary decision in the Story.';
      if (gate.id === 'spec') return 'Spec Gate requires present/inferred Spec evidence without high-severity drift.';
      if (gate.id === 'story') return 'Story Gate requires a resolvable Story source.';
      if (gate.id === 'gate:requirement') return 'Requirement Gate requires scenario gaps/contradictions to be resolved in Story/Spec/Architecture.';
      if (gate.id === 'gate:network_contract') return 'Network Contract Gate requires matching Next.js API routes and network-aware E2E evidence for new /api client calls.';
      if (gate.id?.startsWith('gate:workflow_') || gate.id === 'gate:production_path_matrix' || gate.id === 'gate:evidence_coverage' || gate.id === 'gate:release_confidence') {
        return `${gate.label ?? gate.id} requires workflow-heavy evidence: explicit scenario clauses, production path matrix coverage, and passing flow replay evidence.`;
      }
      if (gate.id?.startsWith('review:prepare:')) return `${gate.label ?? gate.id} requires running the listed \`vibepro review prepare\` command and using the generated review requests with permitted Codex/Claude Code subagents.`;
      if (gate.id?.startsWith('review:record:')) return `${gate.label ?? gate.id} requires recording the review result with \`vibepro review record --agent-closed\` for the current git head, dirty fingerprint, and closed subagent lifecycle.`;
      if (gate.id?.startsWith('review:')) return `${gate.label ?? gate.id} requires completing the assigned review role.`;
      if (gate.id === 'gate:agent_review') return 'Agent Review Gate requires `vibepro review prepare` plus passing `vibepro review record --execution-mode parallel_subagent --agent-closed` results from permitted Codex/Claude Code subagents for the current git head, dirty fingerprint, and closed subagent lifecycle.';
      if (gate.status === 'failed' || gate.status === 'contradicted') return `${gate.label ?? gate.id} requires a passing or non-contradicted state.`;
      return `${gate.label ?? gate.id} requires evidence before PR creation.`;
    })
    .join(' ');
}

function buildGateOverride(gateDag, options, context = {}) {
  if (!gateDag || gateDag.overall_status === 'ready_for_review') return null;
  if (!options.allowNeedsVerification) return null;
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag);
  const criticalGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const completionQuality = context.completionQuality ?? null;
  return {
    allowed: true,
    waiver_policy: 'cli_reason',
    severity: criticalGates.length > 0
      ? 'critical'
      : 'warning',
    reason: options.verificationWaiver,
    unresolved_gates: unresolvedGates,
    critical_unresolved_gates: criticalGates,
    completion_quality: completionQuality ? {
      status: completionQuality.status,
      target_quality_rate: completionQuality.target_quality_rate,
      metrics: completionQuality.metrics,
      required_evidence: completionQuality.required_evidence
    } : null,
    required_evidence: completionQuality?.required_evidence ?? [],
    toolchain: context.toolchain ?? null,
    overall_status: gateDag.overall_status,
    recorded_at: new Date().toISOString()
  };
}

function isCriticalUnresolvedGate(gate) {
  if (gate.id === 'story' && gate.status === 'transient') return true;
  if (gate.id === 'architecture' && gate.status === 'needs_review') return true;
  if (gate.id === 'spec' && ['implicit', 'inferred_empty', 'needs_review'].includes(gate.status)) return true;
  if (gate.id === 'gate:e2e' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:visual_qa' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:design_quality' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:requirement' && ['needs_review', 'contradicted'].includes(gate.status)) return true;
  if (gate.id === 'gate:network_contract' && gate.status !== 'passed') return true;
  if (gate.type === 'workflow_heavy_gate' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:agent_review' && gate.status !== 'passed') return true;
  return gate.status === 'failed' || gate.status === 'contradicted';
}

async function assertStrictTaskArtifacts(repoRoot, storyId, taskId, groupId = null) {
  const baseDir = groupId
    ? path.join(getWorkspaceDir(repoRoot), 'stories', storyId, 'tasks', taskId, 'groups', groupId)
    : path.join(getWorkspaceDir(repoRoot), 'stories', storyId, 'tasks', taskId);
  const required = [
    { name: 'briefing.md', path: path.join(baseDir, 'briefing.md') },
    { name: 'plan.md', path: path.join(baseDir, 'plan.md') },
    { name: 'handoff.md', path: path.join(baseDir, 'handoff.md') }
  ];
  const missing = [];
  for (const item of required) {
    try {
      await readFile(item.path);
    } catch {
      missing.push(item.name);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Strict mode requires task artifacts to exist before pr prepare/create. ` +
      `Missing: ${missing.join(', ')}. ` +
      `Run \`vibepro task ${missing[0].replace('.md', '')} ${repoRoot} --task ${taskId} --id ${storyId}\` first.`
    );
  }
}

function assertStrictTargetFiles(taskContext, changedFiles, options) {
  const targetFiles = taskContext?.task?.target_files ?? [];
  if (targetFiles.length === 0) {
    if (!options.allowExtraFiles) {
      throw new Error(
        `Strict mode: task "${taskContext.task.id}" has no target_files. ` +
        `Run \`vibepro task plan\` to populate target_files, or pass --allow-extra-files to bypass.`
      );
    }
    return;
  }
  const targetSet = new Set(targetFiles);
  // テストファイルは target_files に無くても許容（証跡として追加されるのが普通）
  const isTestFile = (file) => /(^|\/)(tests?|__tests__|spec)\//i.test(file)
    || /\.(test|spec)\.[jt]sx?$/.test(file);
  const extra = (changedFiles ?? [])
    .map((file) => typeof file === 'string' ? file : file.path)
    .filter(Boolean)
    .filter((file) => !targetSet.has(file) && !isTestFile(file));
  if (extra.length > 0 && !options.allowExtraFiles) {
    throw new Error(
      `Strict mode: PR includes ${extra.length} files outside task.target_files. ` +
      `Extra: ${extra.slice(0, 5).join(', ')}${extra.length > 5 ? ', ...' : ''}. ` +
      `Either narrow the PR scope, update task.target_files, or pass --allow-extra-files.`
    );
  }
}

async function loadPrTaskContext(repoRoot, storyId, taskId, groupId = null) {
  const taskState = await readTaskState(repoRoot, storyId);
  const task = (taskState.tasks ?? []).find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found for PR prepare: ${taskId}`);
  const group = groupId ? (task.target_groups ?? []).find((item) => item.id === groupId) : null;
  if (groupId && !group) throw new Error(`Target group not found for PR prepare: ${groupId}`);
  const artifacts = resolveTaskArtifacts(repoRoot, storyId, taskId, groupId);
  return {
    story_id: storyId,
    task,
    group,
    source_run: taskState.source_run ?? null,
    artifacts: await filterExistingArtifacts(repoRoot, artifacts)
  };
}

async function readTaskState(repoRoot, storyId) {
  const taskPath = path.join(getWorkspaceDir(repoRoot), 'stories', storyId, 'tasks', 'tasks.json');
  try {
    return JSON.parse(await readFile(taskPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Task state not found for PR prepare: ${toWorkspaceRelative(repoRoot, taskPath)}`);
    }
    throw error;
  }
}

function resolveTaskArtifacts(repoRoot, storyId, taskId, groupId = null) {
  const baseDir = groupId
    ? path.join(getWorkspaceDir(repoRoot), 'stories', storyId, 'tasks', taskId, 'groups', groupId)
    : path.join(getWorkspaceDir(repoRoot), 'stories', storyId, 'tasks', taskId);
  return {
    briefing_json: toWorkspaceRelative(repoRoot, path.join(baseDir, 'briefing.json')),
    briefing_markdown: toWorkspaceRelative(repoRoot, path.join(baseDir, 'briefing.md')),
    plan_json: toWorkspaceRelative(repoRoot, path.join(baseDir, 'plan.json')),
    plan_markdown: toWorkspaceRelative(repoRoot, path.join(baseDir, 'plan.md')),
    handoff_json: toWorkspaceRelative(repoRoot, path.join(baseDir, 'handoff.json')),
    handoff_markdown: toWorkspaceRelative(repoRoot, path.join(baseDir, 'handoff.md'))
  };
}

async function filterExistingArtifacts(repoRoot, artifacts) {
  const result = {};
  for (const [key, value] of Object.entries(artifacts)) {
    try {
      await readFile(path.join(repoRoot, value), 'utf8');
      result[key] = value;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      result[key] = null;
    }
  }
  return result;
}

function buildPrTitle(preparation) {
  const task = preparation.task_context?.task;
  if (task) return `${task.id} ${task.title}`;
  return formatPrStoryLabel(preparation.story, preparation.pr_context?.story_source);
}

function mapArtifactPaths(repoRoot, artifacts) {
  return Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => [key, toWorkspaceRelative(repoRoot, value)])
  );
}

function formatCommand(command) {
  const [bin, args] = command;
  return [bin, ...args.map(shellQuote)].join(' ');
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runCommand(repoRoot, command, options = {}) {
  const [bin, args] = command;
  const startedAt = new Date().toISOString();
  try {
    const result = await execFileAsync(bin, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      env: options.env
    });
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim()
    };
  } catch (error) {
    return {
      command: formatCommand(command),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      stdout: String(error.stdout ?? '').trim(),
      stderr: String(error.stderr ?? error.message ?? '').trim()
    };
  }
}

function extractPrUrl(stdout) {
  const match = stdout.match(/https?:\/\/\S+/);
  return match?.[0] ?? null;
}

async function writePrCreateArtifacts(repoRoot, prepareResult, execution) {
  const prDir = path.dirname(prepareResult.artifacts.json);
  const jsonPath = path.join(prDir, 'pr-create.json');
  const reportPath = path.join(prDir, 'pr-create.html');
  await writeFile(jsonPath, `${JSON.stringify(execution, null, 2)}\n`);
  await writeFile(reportPath, renderPrCreateHtml(execution, {
    language: execution.output?.language ?? 'ja'
  }));

  if (!execution.workspace_initialized) {
    return {
      pr_create_json: jsonPath,
      pr_create_report: reportPath
    };
  }

  try {
    const manifest = await readManifest(repoRoot);
    manifest.pr_creations = {
      ...(manifest.pr_creations ?? {}),
      [execution.story.story_id]: {
        latest_create: toWorkspaceRelative(repoRoot, jsonPath),
        latest_report: toWorkspaceRelative(repoRoot, reportPath),
        latest_pr_url: execution.pr_url ?? null,
        latest_created_at: execution.created_at,
        latest_dry_run: execution.dry_run
      }
    };
    await writeManifest(repoRoot, manifest);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return {
    pr_create_json: jsonPath,
    pr_create_report: reportPath
  };
}

function formatFileList(files) {
  const visible = files.slice(0, 4).join(', ');
  return files.length > 4 ? `${visible}, ...` : visible;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveStory(repoRoot, config, storyId, options = {}) {
  const stories = normalizeActiveStories(config.brainbase?.stories);
  const targetStoryId = storyId ?? config.brainbase?.current_story_id ?? null;
  const story = targetStoryId
    ? stories.find((item) => item.story_id === targetStoryId)
    : stories[0];
  if (!story && targetStoryId) {
    const source = await findStorySource(repoRoot, {
      story_id: targetStoryId,
      title: targetStoryId
    });
    if (source?.path) {
      return {
        story_id: targetStoryId,
        title: source.title ?? targetStoryId,
        ssot: source.path,
        status: 'active',
        horizon: null,
        view: null,
        period: null,
        started_at: null,
        due_at: null
      };
    }
  }
  if (!story && options.allowTransient && targetStoryId) {
    return {
      story_id: targetStoryId,
      title: targetStoryId,
      ssot: 'transient',
      status: 'active',
      horizon: null,
      view: null,
      period: null,
      started_at: null,
      due_at: null
    };
  }
  if (!story) throw new Error(`Story not found: ${targetStoryId}`);
  return story;
}

function findLatestStoryRun(manifest, storyId) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const latestRunId = manifest.latest_run_by_story?.[storyId] ?? null;
  return runs.find((run) => run.run_id === latestRunId)
    ?? runs.find((run) => run.story_id === storyId)
    ?? null;
}

function buildBranchName(story) {
  const slug = story.story_id
    .replace(/^story-/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `feat/${slug || 'vibepro-story'}`;
}

function stripRemote(ref) {
  return ref.replace(/^origin\//, '');
}

function toDisplayPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function gitRefExists(repoRoot, ref) {
  try {
    await git(repoRoot, ['rev-parse', '--verify', ref]);
    return true;
  } catch {
    return false;
  }
}

async function gitOptional(repoRoot, args) {
  try {
    return await git(repoRoot, args);
  } catch {
    return '';
  }
}

async function gitStatus(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return stdout.trimEnd();
  } catch {
    return '';
  }
}

async function git(repoRoot, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return stdout.trim();
}
