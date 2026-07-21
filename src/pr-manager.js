import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { formatCounts } from './refactoring-delta-reporter.js';
import {
  aggregateDeliveryMetrics,
  evaluateDeliveryBudget,
  resolveEfficiencyPolicy,
  summarizeEfficiencyDebt
} from './delivery-efficiency-guardrail.js';
import {
  buildRequirementConsistency,
  findStorySource,
  isStoryDocPath,
  renderRequirementGateSummary
} from './requirement-consistency.js';
import { renderGateDagHtml, renderPrCreateHtml, renderPrMergeHtml, renderPrPrepareHtml, renderSplitPlanHtml } from './html-report.js';
import { classifyChangeRisk } from './change-risk-classifier.js';
import {
  evaluateValidationSequence,
  reconcileValidationSequenceState,
  readValidationSequence,
  writeValidationSequence
} from './validation-sequencing.js';
import { normalizeActiveStories } from './story-manager.js';
import { readNarrative } from './report-store.js';
import { collectRuntimeInfo } from './runtime-info.js';
import { localizedText, resolveOutputLanguage } from './language.js';
import { scanNetworkContracts } from './network-contract-scanner.js';
import { scanRegressionRisk } from './regression-risk-scanner.js';
import { describeScanStatus } from './scan-status.js';
import { readDrift, readInferredSpec } from './spec-store.js';
import { buildTraceability, buildTraceabilityClauseMap, summarizeTraceabilityClauseMap } from './traceability.js';
import { buildEvidenceAdjudicationGate, buildJudgmentDagAdjudicationGate, collectJudgmentItems, isAdjudicationEnabled, isJudgmentAdjudicationEnabled, readAdjudicationIfExists, readJudgmentAdjudicationIfExists, summarizeAdjudicationForPr, summarizeJudgmentAdjudicationForPr } from './adjudication.js';
import { evaluateDesignDiagramsGate } from './spec-validator.js';
import { resolveRequiredDiagrams } from './diagram-requirement-resolver.js';
import { runRecipePreflight } from './recipe-preflight.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, initWorkspace, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';
import {
  renderPerformancePrSection,
  summarizeStoryPerformanceEvidence
} from './performance-evidence.js';
import {
  prepareAgentReview,
  renderAgentReviewPrSection,
  summarizeAgentReviewsForPr
} from './agent-review.js';
import { importCiEvidence } from './ci-evidence.js';
import { recordVerificationEvidence } from './verification-evidence.js';
import {
  renderExplorePrSection,
  summarizeExploreEvidenceForPr
} from './explore-evidence.js';
import {
  readLatestJourneyMap,
  readCuratedJourneyMap,
  renderJourneyPrSection,
  summarizeJourneyForPr
} from './journey-map.js';
import { readUiuxIaFlowMapForPr } from './uiux-flow-map.js';
import { readResponsiveA11yMatrixForPr } from './uiux-responsive-a11y.js';
import { readDecisionRecordsIfExists, summarizeDecisionRecords } from './decision-records.js';
import { readEnvironmentGraphIfExists, deployTargetsFromGraph } from './environment-graph.js';
import { scoreAuthorization } from './authorization-scoring.js';
import { evaluateManagedWorktreeCommandContext } from './managed-worktree.js';
import { buildManagedWorktreeGate as buildManagedWorktreePolicyGate, formatManagedWorktreePrStatus } from './managed-worktree-gate.js';
import { collectGitStatusFingerprints, compareFingerprintContexts, fingerprintHashForContext } from './git-fingerprint.js';
import {
  appendEvidenceDrilldownEntry,
  buildEvidenceDecisionIndex,
  buildEvidenceDrilldownEntry,
  buildEvidencePlan
} from './evidence-depth-planner.js';
import { planArtifactBudget, resolveHandoffArtifact, resolvePrArtifactBudgetBytes } from './pr-artifact-budget.js';
import {
  buildEvidenceReuse,
  buildEvidenceReuseGate,
  readEvidenceReuseIfExists,
  summarizeEvidenceReuse
} from './evidence-reuse.js';
import {
  buildResponsibilityAuthorityGate,
  renderResponsibilityAuthorityPrSection,
  resolveResponsibilityAuthority
} from './responsibility-authority.js';
import {
  buildDesignSsotGate,
  reconcileDesignSsot
} from './design-ssot.js';
import {
  buildSeniorGapJudgment,
  buildSeniorGapJudgmentGate
} from './senior-gap-judgment.js';
import { buildCodeTopologyContext } from './code-topology-provider.js';
import { evaluateContentBinding } from './content-binding.js';
import { recordResolvedGateOutcomes } from './gate-outcome-ledger.js';
import { assertArtifactWritePath, collectCurrentGeneratedProjectionPaths, projectArtifact, resolveArtifactRoute, resolveGraphifyArtifactFile } from './artifact-routing.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_REVIEWABLE_FILES = 30;
const DEFAULT_PR_PREPARE_STAGE_TIMEOUT_MS = 600000;
const DEFAULT_VISUAL_QA_THRESHOLD_PCT = 5;

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
  const committedChangedFiles = Array.isArray(git.committed_changed_files) ? git.committed_changed_files : git.changed_files;
  const workspaceArtifactFiles = committedChangedFiles.filter((file) => isWorkspaceArtifactPath(file.path));
  fileGroups.vibepro_artifacts = {
    count: workspaceArtifactFiles.length,
    files: workspaceArtifactFiles.map((file) => file.path)
  };
  const scope = assessScope({
    changedFiles: reviewChangedFiles,
    fileGroups,
    dirtyFiles: reviewDirtyFiles,
    dirtyFilesAffectScope: reviewGit.includes_dirty_in_changed_files,
    commits: reviewGit.commits,
    storyId: story.story_id,
    maxReviewableFiles: options.maxReviewableFiles ?? DEFAULT_MAX_REVIEWABLE_FILES
  });
  const latestStoryRun = findLatestStoryRun(manifest, story.story_id);
  const designInputStoryRun = findLatestStoryRunByPhase(manifest, story.story_id, 'design_input');
  const preImplementationStoryRun = findLatestStoryRunByPhase(manifest, story.story_id, 'pre_implementation');
  const verificationEvidence = workspace.initialized
    ? await progress.stage('read_verification_evidence', () => readVerificationEvidenceIfExists(root, story.story_id))
    : null;
  const decisionRecords = workspace.initialized
    ? await progress.stage('read_decision_records', () => readDecisionRecordsIfExists(root, story.story_id))
    : null;
  const managedWorktreeGate = workspace.initialized
    ? await progress.stage('evaluate_managed_worktree_gate', () => buildManagedWorktreePolicyGate(root, {
      storyId: story.story_id,
      decisionRecords
    }))
    : null;
  const prContext = await progress.stage('build_pr_context', () => buildPrContext(root, {
    story,
    taskContext,
    git: reviewGit,
    fileGroups,
    scope,
    latestStoryRun,
    designInputStoryRun,
    preImplementationStoryRun,
    verificationEvidence,
    decisionRecords,
    managedWorktreeGate,
    env: options.env ?? process.env
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
  prContext.gate_dag.accepted_current_story_lineage = collectAcceptedCurrentStoryLineage(scope);
  reconcileAtomicScopeGateDag(prContext.gate_dag, splitPlan.atomic_scope);
  let gateStatus = buildPrPrepareGateStatus(prContext.gate_dag, prContext.completion_quality);
  const authorizationScoring = buildAuthorizationScoring({
    fileGroups,
    storySource: prContext.story_source,
    decisionRecords
  });
  const prRoute = workspace.initialized
    ? await resolveArtifactRoute(root, 'pr', { storyId: story.story_id })
    : null;
  const gateRoute = workspace.initialized
    ? await resolveArtifactRoute(root, 'gate', { storyId: story.story_id })
    : null;
  const prDir = workspace.initialized
    ? path.dirname(await assertArtifactWritePath(root, prRoute.canonical.relative_path))
    : await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-prepare-'));
  await mkdir(prDir, { recursive: true });
  const evidenceReusePath = path.join(prDir, 'evidence-reuse.json');
  const evidencePlanPath = path.join(prDir, 'evidence-plan.json');
  const evidenceDrilldownLogPath = path.join(prDir, 'evidence-drilldown-log.json');
  const decisionIndexPath = path.join(prDir, 'decision-index.json');
  const jsonPath = prRoute?.canonical.absolute_path ?? path.join(prDir, 'pr-prepare.json');
  const reportPath = path.join(prDir, 'pr-prepare.html');
  const reviewCockpitPath = path.join(prDir, 'review-cockpit.html');
  const humanReviewPath = path.join(prDir, 'human-review.json');
  const architectureReviewPath = path.join(prDir, 'architecture-review.json');
  const decisionRecordsPath = path.join(prDir, 'decision-records.json');
  const bodyPath = path.join(prDir, 'pr-body.md');
  const designSsotPath = path.join(prDir, 'design-ssot-reconciliation.json');
  const seniorGapJudgmentPath = path.join(prDir, 'senior-gap-judgment.json');
  const refTopologyPath = path.join(prDir, 'ref-topology.json');
  const gateDagJsonPath = gateRoute
    ? await assertArtifactWritePath(root, gateRoute.canonical.relative_path)
    : path.join(prDir, 'gate-dag.json');
  await mkdir(path.dirname(gateDagJsonPath), { recursive: true });
  const gateDagReportPath = path.join(prDir, 'gate-dag.html');
  const splitPlanJsonPath = path.join(prDir, 'split-plan.json');
  const splitPlanReportPath = path.join(prDir, 'split-plan.html');
  const traceabilityPath = path.join(prDir, 'traceability.json');
  const previousPrPrepare = workspace.initialized
    ? await progress.stage('read_previous_pr_prepare', () => readJsonIfExists(jsonPath))
    : null;
  const previousGateDag = workspace.initialized
    ? await progress.stage('read_previous_gate_dag', () => readJsonIfExists(gateDagJsonPath))
    : null;
  const previousDrilldownLog = workspace.initialized
    ? await progress.stage('read_evidence_drilldown_log', () => readJsonIfExists(evidenceDrilldownLogPath))
    : null;
  const traceabilityEvidenceForCoverage = buildTraceabilityEvidence({
    root,
    bodyPath,
    gateDagJsonPath,
    verificationEvidence,
    currentHeadSha: reviewGit.head_sha
  });
  const storyTextForTraceability = prContext.story_source?.path
    ? await readFile(path.join(root, prContext.story_source.path), 'utf8').catch(() => '')
    : '';
  const changedFilesForTraceability = (reviewGit.changed_files ?? [])
    .map((file) => ({ path: file.path ?? file }));
  const testsForTraceability = changedFilesForTraceability
    .filter((file) => /(^|\/)(test|tests|e2e)\//.test(file.path) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file.path));
  const traceabilityMap = buildTraceabilityClauseMap({
    storyText: storyTextForTraceability,
    changedFiles: changedFilesForTraceability,
    tests: testsForTraceability,
    evidence: traceabilityEvidenceForCoverage,
    scenarioClauses: prContext.gate_dag?.summary?.scenario_clauses ?? []
  });
  prContext.traceability_clause_coverage = summarizeTraceabilityClauseMap(traceabilityMap);
  prContext.gate_dag.nodes.push(buildTraceabilityClauseCoverageGate(prContext.traceability_clause_coverage));
  prContext.gate_dag.summary.traceability_clause_coverage = prContext.traceability_clause_coverage;
  if (isAdjudicationEnabled(workspace.config)) {
    const adjudicationAcceptanceCriteria = (traceabilityMap.acceptance_criteria ?? [])
      .map((clause) => ({ id: clause.id, text: clause.source_text }));
    const adjudicationRecords = workspace.initialized
      ? await progress.stage('read_evidence_adjudication', () => readAdjudicationIfExists(root, story.story_id))
      : null;
    const adjudicationGate = buildEvidenceAdjudicationGate({
      storyId: story.story_id,
      acceptanceCriteria: adjudicationAcceptanceCriteria,
      adjudication: adjudicationRecords,
      headSha: reviewGit.head_sha,
      decisions: prContext.decision_records?.decisions ?? []
    });
    prContext.evidence_adjudication = summarizeAdjudicationForPr({
      acceptanceCriteria: adjudicationAcceptanceCriteria,
      adjudication: adjudicationRecords,
      headSha: reviewGit.head_sha
    });
    prContext.gate_dag.nodes.push(adjudicationGate);
    prContext.gate_dag.summary.evidence_adjudication = {
      status: adjudicationGate.status,
      ...prContext.evidence_adjudication
    };
  }
  if (isJudgmentAdjudicationEnabled(workspace.config)) {
    const judgmentItems = collectJudgmentItems({
      gateDag: prContext.gate_dag,
      routeType: prContext.engineering_judgment?.route_type ?? null,
      changeProfile: prContext.change_classification?.profile ?? null
    });
    const judgmentRecords = workspace.initialized
      ? await progress.stage('read_judgment_adjudication', () => readJudgmentAdjudicationIfExists(root, story.story_id))
      : null;
    const judgmentGate = buildJudgmentDagAdjudicationGate({
      storyId: story.story_id,
      items: judgmentItems,
      adjudication: judgmentRecords,
      headSha: reviewGit.head_sha,
      decisions: prContext.decision_records?.decisions ?? []
    });
    prContext.judgment_dag_adjudication = summarizeJudgmentAdjudicationForPr({
      storyId: story.story_id,
      items: judgmentItems,
      adjudication: judgmentRecords,
      headSha: reviewGit.head_sha,
      decisions: prContext.decision_records?.decisions ?? []
    });
    prContext.gate_dag.nodes.push(judgmentGate);
    prContext.gate_dag.summary.judgment_dag_adjudication = {
      status: judgmentGate.status,
      ...prContext.judgment_dag_adjudication
    };
  }
  reconcileGateDagOutcomeSummary(prContext.gate_dag);
  prContext.execution_gate = buildExecutionGateStatus(prContext.gate_dag);
  gateStatus = buildPrPrepareGateStatus(prContext.gate_dag, prContext.completion_quality);
  const createdAt = new Date().toISOString();
  const evidencePlan = buildEvidencePlan({
    story,
    git: reviewGit,
    fileGroups,
    scope,
    prContext,
    gateStatus,
    requestedDepth: options.evidenceDepth,
    requestedDepthReason: options.evidenceDepthReason,
    requestedDepthConsumer: options.evidenceDepthConsumer,
    requestedDepthTargets: options.evidenceDepthTargets,
    createdAt
  });
  const drilldownEntry = buildEvidenceDrilldownEntry({ evidencePlan, git: reviewGit, createdAt });
  const decisionIndex = buildEvidenceDecisionIndex({
    story,
    git: reviewGit,
    fileGroups,
    scope,
    prContext,
    gateStatus,
    splitPlan,
    evidencePlan,
    createdAt
  });
  const artifactPolicy = evidencePlan.artifact_policy ?? {};
  const writePrPrepareHtml = artifactPolicy.write_pr_prepare_html === true;
  const writeReviewCockpitHtml = artifactPolicy.write_review_cockpit_html === true;
  const writeGateDagHtml = artifactPolicy.write_gate_dag_html === true;
  const writeSplitPlanHtml = artifactPolicy.write_split_plan_html === true;
  const writeGateDagDump = artifactPolicy.write_full_gate_dag_dump !== false;
  const drilldownLogAvailable = Boolean(
    drilldownEntry || (Array.isArray(previousDrilldownLog?.entries) && previousDrilldownLog.entries.length > 0)
  );
  const previousEvidenceReuse = workspace.initialized
    ? await progress.stage('read_evidence_reuse', () => readEvidenceReuseIfExists(root, story.story_id))
    : null;
  const evidenceReuse = buildEvidenceReuse({
    repoRoot: root,
    story,
    git: reviewGit,
    prContext,
    evidencePlan,
    decisionIndex,
    verificationEvidence,
    previousReuse: previousEvidenceReuse,
    decisionUsage: options.evidenceDecisionUsage ?? null,
    artifacts: {
      evidenceReusePath,
      evidencePlanPath,
      decisionIndexPath,
      jsonPath,
      gateDagJsonPath: writeGateDagDump ? gateDagJsonPath : null
    },
    createdAt
  });
  const evidenceReuseSummary = summarizeEvidenceReuse(evidenceReuse);
  evidencePlan.evidence_reuse = evidenceReuseSummary;
  decisionIndex.evidence_reuse = evidenceReuseSummary;
  prContext.evidence_reuse = evidenceReuseSummary;
  prContext.gate_dag.nodes.push(buildEvidenceReuseGate(evidenceReuse));
  prContext.gate_dag.summary.evidence_reuse = evidenceReuseSummary;
  reconcileGateDagOutcomeSummary(prContext.gate_dag);
  prContext.execution_gate = buildExecutionGateStatus(prContext.gate_dag);
  gateStatus = buildPrPrepareGateStatus(prContext.gate_dag, prContext.completion_quality);
  const seniorGapJudgment = buildSeniorGapJudgment({
    story,
    git: reviewGit,
    fileGroups,
    scope,
    prContext,
    gateStatus,
    evidencePlan,
    evidenceReuse: evidenceReuseSummary,
    createdAt
  });
  prContext.senior_gap_judgment = seniorGapJudgment;
  prContext.gate_dag.nodes.push(buildSeniorGapJudgmentGate(seniorGapJudgment, {
    artifact: `.vibepro/pr/${story.story_id}/senior-gap-judgment.json`
  }));
  prContext.gate_dag.summary.senior_gap_judgment = {
    status: seniorGapJudgment.decision.status,
    gap_count: seniorGapJudgment.gaps.length,
    blocking_gap_count: seniorGapJudgment.decision.blocking_gap_count,
    residual_risk_count: seniorGapJudgment.residual_risks.length,
    followup_count: seniorGapJudgment.followups.length
  };
  decisionIndex.senior_gap_judgment = prContext.gate_dag.summary.senior_gap_judgment;
  reconcileGateDagOutcomeSummary(prContext.gate_dag);
  prContext.execution_gate = buildExecutionGateStatus(prContext.gate_dag);
  gateStatus = buildPrPrepareGateStatus(prContext.gate_dag, prContext.completion_quality);
  const gateOutcomeLedger = workspace.initialized
    ? await progress.stage('record_gate_outcome_ledger', () => recordResolvedGateOutcomes(root, {
      storyId: story.story_id,
      previousGateDag,
      currentGateDag: prContext.gate_dag,
      previousPrepareCreatedAt: previousPrPrepare?.created_at ?? null,
      createdAt,
      git: reviewGit,
      fileGroups,
      verificationEvidence,
      agentReviews: prContext.agent_reviews,
      decisionRecords,
      overrideOutcome: options.gateOutcome ?? null
    }))
    : null;
  const traceabilityEvidence = buildTraceabilityEvidence({
    root,
    bodyPath,
    gateDagJsonPath: writeGateDagDump ? gateDagJsonPath : null,
    verificationEvidence,
    currentHeadSha: reviewGit.head_sha
  });
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
  // Per-artifact size budget pass: serialize the emitted content artifacts once,
  // reuse the exact strings when writing so the measured bytes match the files,
  // and route LLM handoff surfaces through bounded summaries for over-budget ones.
  const artifactBudgetBytes = resolvePrArtifactBudgetBytes(workspace.config);
  const evidenceReuseJson = `${JSON.stringify(evidenceReuse, null, 2)}\n`;
  const evidencePlanJson = `${JSON.stringify(evidencePlan, null, 2)}\n`;
  const decisionIndexJson = `${JSON.stringify(decisionIndex, null, 2)}\n`;
  const designSsotJson = `${JSON.stringify(prContext.design_ssot_reconciliation ?? null, null, 2)}\n`;
  const seniorGapJudgmentJson = `${JSON.stringify(prContext.senior_gap_judgment ?? null, null, 2)}\n`;
  const refTopologyJson = `${JSON.stringify(reviewGit.ref_topology ?? null, null, 2)}\n`;
  const splitPlanJson = `${JSON.stringify(splitPlan, null, 2)}\n`;
  const decisionRecordsJson = `${JSON.stringify(prContext.decision_records, null, 2)}\n`;
  const gateDagJson = writeGateDagDump ? `${JSON.stringify(prContext.gate_dag, null, 2)}\n` : null;
  const artifactBudgetInputs = [
    { filename: 'evidence-reuse.json', content: evidenceReuseJson },
    { filename: 'evidence-plan.json', content: evidencePlanJson },
    { filename: 'decision-index.json', content: decisionIndexJson },
    { filename: 'design-ssot-reconciliation.json', content: designSsotJson },
    { filename: 'senior-gap-judgment.json', content: seniorGapJudgmentJson },
    { filename: 'ref-topology.json', content: refTopologyJson },
    { filename: 'split-plan.json', content: splitPlanJson },
    { filename: 'decision-records.json', content: decisionRecordsJson },
    ...(gateDagJson !== null ? [{ filename: 'gate-dag.json', content: gateDagJson }] : [])
  ];
  const artifactBudgetPlan = planArtifactBudget({ artifacts: artifactBudgetInputs, budgetBytes: artifactBudgetBytes });
  const artifactBudgetReport = {
    budget_bytes: artifactBudgetPlan.budget_bytes,
    over_budget: artifactBudgetPlan.over_budget.map((entry) => ({
      artifact: entry.artifact,
      bytes: entry.bytes,
      summary_path: entry.summary_filename
        ? toWorkspaceRelative(root, path.join(prDir, entry.summary_filename))
        : null,
      summary_status: entry.summary_status
    }))
  };
  const scannedArtifactFilenames = artifactBudgetInputs.map((input) => input.filename);
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
    artifactBudget: artifactBudgetPlan,
    language: outputLanguage
  }));
  const preparation = {
    schema_version: '0.1.0',
    story,
    created_at: createdAt,
    output: {
      language: outputLanguage
    },
    evidence_plan: evidencePlan,
    decision_index: decisionIndex,
    evidence_reuse: evidenceReuse,
    artifact_budget: artifactBudgetReport,
    gate_status: gateStatus,
    session_boundary: buildSessionBoundaryAdvisory({
      storyId: story.story_id,
      env: options.env ?? process.env,
      git: reviewGit
    }),
    authorization_scoring: authorizationScoring,
    workspace: {
      initialized: workspace.initialized,
      artifact_location: workspace.initialized ? 'repo' : 'temporary'
    },
    git: sanitizeGitStateForOutput(reviewGit),
    file_groups: sanitizeFileGroupsForOutput(fileGroups),
    scope,
    split_plan: splitPlan,
    pr_context: prContext,
    toolchain,
    task_context: taskContext,
    latest_story_run: latestStoryRun,
    gate_outcome_ledger: gateOutcomeLedger,
    suggested_branch: suggestedBranch,
    next_commands: nextCommands,
    diagnostics: {
      pr_prepare_stages: progress.snapshot()
    }
  };
  const usedForDecision = buildUsedForDecisionSummary({
    verificationEvidence: prContext.verification_evidence,
    gateDag: prContext.gate_dag,
    engineeringJudgment: prContext.engineering_judgment,
    gateStatus,
    decisionRecords: prContext.decision_records
  });
  if (usedForDecision) {
    preparation.used_for_decision = usedForDecision;
  }

  const lifecycleArtifacts = workspace.initialized
    ? await progress.stage('inspect_pr_lifecycle_artifacts', () => inspectPrLifecycleArtifacts(root, story.story_id, {
      currentHeadSha: reviewGit.head_sha,
      checkedAt: preparation.created_at
    }))
    : buildMissingLifecycleArtifactSummary({
      storyId: story.story_id,
      currentHeadSha: reviewGit.head_sha,
      checkedAt: preparation.created_at
    });
  preparation.lifecycle_artifacts = lifecycleArtifacts;
  await progress.stage('write_pr_prepare_artifacts', async ({ signal }) => {
    await writeFile(evidenceReusePath, evidenceReuseJson, { signal });
    await writeFile(evidencePlanPath, evidencePlanJson, { signal });
    await writeFile(decisionIndexPath, decisionIndexJson, { signal });
    await writeFile(designSsotPath, designSsotJson, { signal });
    await writeFile(seniorGapJudgmentPath, seniorGapJudgmentJson, { signal });
    await writeFile(refTopologyPath, refTopologyJson, { signal });
    await writeFile(bodyPath, prBody, { signal });
    if (writeGateDagDump) {
      await writeFile(gateDagJsonPath, gateDagJson, { signal });
    } else {
      await rm(gateDagJsonPath, { force: true });
    }
    if (writeGateDagHtml) {
      await writeFile(gateDagReportPath, renderGateDagHtml(prContext.gate_dag, {
        generatedAt: preparation.created_at,
        language: outputLanguage
      }), { signal });
    } else await rm(gateDagReportPath, { force: true });
    await writeFile(splitPlanJsonPath, splitPlanJson, { signal });
    if (writeSplitPlanHtml) {
      await writeFile(splitPlanReportPath, renderSplitPlanHtml(splitPlan, {
        generatedAt: preparation.created_at,
        language: outputLanguage
      }), { signal });
    } else await rm(splitPlanReportPath, { force: true });
    if (writePrPrepareHtml || writeReviewCockpitHtml) {
      const reviewCockpitHtml = renderPrPrepareHtml({
        preparation,
        bodyPath: toWorkspaceRelative(root, bodyPath),
        gateDagPath: writeGateDagHtml ? toWorkspaceRelative(root, gateDagReportPath) : null,
        splitPlanPath: writeSplitPlanHtml ? toWorkspaceRelative(root, splitPlanReportPath) : null,
        language: outputLanguage
      });
      if (writePrPrepareHtml) await writeFile(reportPath, reviewCockpitHtml, { signal });
      else await rm(reportPath, { force: true });
      if (writeReviewCockpitHtml) await writeFile(reviewCockpitPath, reviewCockpitHtml, { signal });
      else await rm(reviewCockpitPath, { force: true });
    } else {
      await Promise.all([rm(reportPath, { force: true }), rm(reviewCockpitPath, { force: true })]);
    }
    const existingTraceability = await readJsonIfExists(traceabilityPath);
    await writeFile(traceabilityPath, `${JSON.stringify(buildTraceability(existingTraceability, {
      storyId: story.story_id,
      storyDocPath: prContext.story_source?.path ?? null,
      source: 'pr_prepare',
      lifecycle: 'in_progress',
      evidence: traceabilityEvidence,
      acceptanceCriteria: traceabilityMap.acceptance_criteria,
      scenarioClauses: traceabilityMap.scenario_clauses
    }), null, 2)}\n`, { signal });
    const existingArchitectureReview = await readJsonIfExists(architectureReviewPath);
    const existingHumanReview = await readJsonIfExists(humanReviewPath);
    await writeFile(architectureReviewPath, `${JSON.stringify(buildArchitectureReviewTemplate({
      preparation,
      reviewCockpitPath: writeReviewCockpitHtml ? toWorkspaceRelative(root, reviewCockpitPath) : null,
      gateDagPath: writeGateDagDump ? toWorkspaceRelative(root, gateDagJsonPath) : null,
      existingReview: existingArchitectureReview
    }), null, 2)}\n`, { signal });
    await writeFile(decisionRecordsPath, decisionRecordsJson, { signal });
    await writeFile(humanReviewPath, `${JSON.stringify(buildHumanReviewTemplate({
      preparation,
      reviewCockpitPath: writeReviewCockpitHtml ? toWorkspaceRelative(root, reviewCockpitPath) : null,
      architectureReviewPath: toWorkspaceRelative(root, architectureReviewPath),
      bodyPath: toWorkspaceRelative(root, bodyPath),
      gateDagPath: writeGateDagDump ? toWorkspaceRelative(root, gateDagJsonPath) : null,
      splitPlanPath: toWorkspaceRelative(root, splitPlanJsonPath),
      decisionRecordsPath: toWorkspaceRelative(root, decisionRecordsPath),
      existingReview: existingHumanReview
    }), null, 2)}\n`, { signal });
    if (workspace.initialized) {
      await annotatePrLifecycleArtifacts(root, story.story_id, lifecycleArtifacts, { signal });
    }
    // Bounded summaries for over-budget artifacts, and stale-summary cleanup so
    // within-budget artifacts never leave a sibling behind (PAB invariant).
    const generatedSummaryFilenames = new Set(artifactBudgetPlan.summaries.map((summary) => summary.filename));
    for (const summary of artifactBudgetPlan.summaries) {
      await writeFile(path.join(prDir, summary.filename), summary.content, { signal });
    }
    for (const filename of scannedArtifactFilenames) {
      const summaryFilename = filename.replace(/\.json$/i, '') + '.summary.json';
      if (!generatedSummaryFilenames.has(summaryFilename)) {
        await rm(path.join(prDir, summaryFilename), { force: true });
      }
    }
  });
  preparation.diagnostics.pr_prepare_stages = progress.snapshot();

  if (workspace.initialized) {
    manifest.pr_preparations = {
      ...(manifest.pr_preparations ?? {}),
      [story.story_id]: {
        latest_evidence_reuse: toWorkspaceRelative(root, evidenceReusePath),
        latest_evidence_plan: toWorkspaceRelative(root, evidencePlanPath),
        latest_evidence_drilldown_log: drilldownLogAvailable ? toWorkspaceRelative(root, evidenceDrilldownLogPath) : null,
        latest_decision_index: toWorkspaceRelative(root, decisionIndexPath),
        latest_prepare: toWorkspaceRelative(root, jsonPath),
        latest_report: writePrPrepareHtml ? toWorkspaceRelative(root, reportPath) : null,
        latest_review_cockpit: writeReviewCockpitHtml ? toWorkspaceRelative(root, reviewCockpitPath) : null,
        latest_human_review: toWorkspaceRelative(root, humanReviewPath),
        latest_architecture_review: toWorkspaceRelative(root, architectureReviewPath),
        latest_decision_records: toWorkspaceRelative(root, decisionRecordsPath),
        latest_pr_body: toWorkspaceRelative(root, bodyPath),
        latest_gate_dag: writeGateDagDump ? toWorkspaceRelative(root, gateDagJsonPath) : null,
        latest_senior_gap_judgment: toWorkspaceRelative(root, seniorGapJudgmentPath),
        latest_ref_topology: toWorkspaceRelative(root, refTopologyPath),
        latest_gate_dag_report: writeGateDagHtml ? toWorkspaceRelative(root, gateDagReportPath) : null,
        latest_split_plan: toWorkspaceRelative(root, splitPlanJsonPath),
        latest_split_plan_report: writeSplitPlanHtml ? toWorkspaceRelative(root, splitPlanReportPath) : null,
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
  await progress.stage('write_final_gate_dag_artifacts', async ({ signal }) => {
    if (writeGateDagDump) {
      await writeFile(gateDagJsonPath, gateDagJson, { signal });
    } else {
      await rm(gateDagJsonPath, { force: true });
    }
    if (writeGateDagHtml) {
      await writeFile(gateDagReportPath, renderGateDagHtml(preparation.pr_context.gate_dag, {
        generatedAt: preparation.created_at,
        language: outputLanguage
      }), { signal });
    } else await rm(gateDagReportPath, { force: true });
  });
  await writeFileWithTimeout(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`, {
    timeoutMs: progress.timeoutMs,
    stage: 'write_pr_prepare_json'
  });
  if (workspace.initialized) {
    await projectArtifact(root, 'gate', { storyId: story.story_id, content: preparation.pr_context.gate_dag, writeCanonical: true });
    await projectArtifact(root, 'pr', { storyId: story.story_id, content: preparation });
  }
  if (drilldownEntry) {
    await writeFile(evidenceDrilldownLogPath, `${JSON.stringify(
      appendEvidenceDrilldownEntry(previousDrilldownLog, drilldownEntry, story.story_id),
      null,
      2
    )}\n`);
  }

  return {
    story,
    preparation,
    artifacts: {
      evidence_reuse: evidenceReusePath,
      evidence_plan: evidencePlanPath,
      evidence_drilldown_log: drilldownLogAvailable ? evidenceDrilldownLogPath : null,
      decision_index: decisionIndexPath,
      json: jsonPath,
      report: writePrPrepareHtml ? reportPath : null,
      review_cockpit: writeReviewCockpitHtml ? reviewCockpitPath : null,
      human_review: humanReviewPath,
      architecture_review: architectureReviewPath,
      decision_records: decisionRecordsPath,
      pr_body: bodyPath,
      design_ssot_reconciliation: designSsotPath,
      senior_gap_judgment: seniorGapJudgmentPath,
      ref_topology: refTopologyPath,
      gate_dag: writeGateDagDump ? gateDagJsonPath : null,
      gate_dag_report: writeGateDagHtml ? gateDagReportPath : null,
      split_plan: splitPlanJsonPath,
      split_plan_report: writeSplitPlanHtml ? splitPlanReportPath : null
    }
  };
}

/**
 * Read-only Gate DAG evaluation for CI enforcement (`vibepro gate check`).
 *
 * `preparePullRequest` is the single source of truth for gate computation.
 * It is not a pure function: whenever the workspace is initialized it
 * unconditionally persists PR-lifecycle artifacts under
 * `.vibepro/pr/<story-id>/` (pr-prepare.json, gate-dag.json, evidence-plan.json,
 * human-review.json, pr-body.md, html reports, ...) and, via
 * `recordResolvedGateOutcomes`, appends to `.vibepro/gate-outcomes/ledger.json`.
 * `gate check` must be safe to run in CI with zero net filesystem effects, so
 * this wrapper snapshots exactly those two subpaths - `.vibepro/pr/<story-id>/`
 * and `.vibepro/gate-outcomes/` - before delegating to the real
 * `preparePullRequest`, and restores both to their exact prior byte-for-byte
 * state (or removes them again if they did not exist before) in a `finally`
 * block. No gate logic is reimplemented here; this only isolates the existing
 * computation's filesystem effects to the two subpaths it is known to write.
 *
 * Knowing the story id *before* calling `preparePullRequest` (so the correct
 * `.vibepro/pr/<story-id>/` path can be snapshotted first) requires mirroring
 * the same story resolution `preparePullRequest` performs internally:
 * `readWorkspaceState` (a pure read of `.vibepro/config.json`) followed by
 * `resolveStory` (a pure read of config + story docs, no filesystem writes).
 * Both are exported from this module specifically so this wrapper can call
 * them directly without duplicating story-resolution business logic.
 */
export async function evaluateGateReadiness(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const generatedAt = () => new Date().toISOString();

  let storyId;
  try {
    const workspace = await readWorkspaceState(root);
    const story = await resolveStory(root, workspace.config, options.storyId, {
      allowTransient: !workspace.initialized
    });
    storyId = story.story_id;
  } catch (error) {
    return {
      schema_version: '0.1.0',
      story_id: options.storyId ?? null,
      status: 'error',
      overall_status: 'error',
      ready_for_pr_create: false,
      gates: [],
      unresolved_gate_count: null,
      critical_unresolved_gate_count: null,
      error: error instanceof Error ? error.message : String(error),
      generated_at: generatedAt()
    };
  }

  const workspaceDir = getWorkspaceDir(root);
  const prRoute = await resolveArtifactRoute(root, 'pr', { storyId });
  const gateRoute = await resolveArtifactRoute(root, 'gate', { storyId });
  const prDir = path.dirname(prRoute.canonical.absolute_path);
  const gateDir = path.dirname(gateRoute.canonical.absolute_path);
  const gateOutcomesDir = path.join(workspaceDir, 'gate-outcomes');
  const snapshotRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gate-check-snapshot-'));
  const snapshots = [
    { targetPath: prDir, snapshotPath: path.join(snapshotRoot, 'pr'), existedBefore: existsSync(prDir) },
    ...(gateDir === prDir ? [] : [{ targetPath: gateDir, snapshotPath: path.join(snapshotRoot, 'gate'), existedBefore: existsSync(gateDir) }]),
    { targetPath: gateOutcomesDir, snapshotPath: path.join(snapshotRoot, 'gate-outcomes'), existedBefore: existsSync(gateOutcomesDir) }
  ];

  try {
    for (const entry of snapshots) {
      if (entry.existedBefore) {
        await cp(entry.targetPath, entry.snapshotPath, { recursive: true, preserveTimestamps: true });
      }
    }

    let preparation;
    try {
      const prepareResult = await preparePullRequest(root, {
        storyId: options.storyId,
        baseRef: options.baseRef,
        headRef: options.headRef,
        language: options.language,
        env: options.env
      });
      preparation = prepareResult.preparation;
    } catch (error) {
      return {
        schema_version: '0.1.0',
        story_id: storyId,
        status: 'error',
        overall_status: 'error',
        ready_for_pr_create: false,
        gates: [],
        unresolved_gate_count: null,
        critical_unresolved_gate_count: null,
        error: error instanceof Error ? error.message : String(error),
        generated_at: generatedAt()
      };
    }

    const gateDag = preparation.pr_context?.gate_dag ?? null;
    const gateStatus = preparation.gate_status ?? null;
    const unresolvedIds = new Set((gateStatus?.unresolved_gates ?? []).map((gate) => gate.id));
    const criticalIds = new Set((gateStatus?.critical_unresolved_gates ?? []).map((gate) => gate.id));
    const reasonById = new Map((gateStatus?.unresolved_gates ?? []).map((gate) => [gate.id, gate.reason ?? null]));
    const gates = (gateDag?.nodes ?? []).map((node) => ({
      id: node.id,
      status: node.status,
      blocking: unresolvedIds.has(node.id),
      reason: reasonById.get(node.id) ?? node.reason ?? null,
      label: node.label ?? node.id,
      required: node.required !== false,
      critical: criticalIds.has(node.id)
    }));

    return {
      schema_version: '0.1.0',
      story_id: preparation.story?.story_id ?? storyId,
      overall_status: gateDag?.overall_status ?? 'unknown',
      ready_for_pr_create: gateStatus?.ready_for_pr_create === true,
      gates,
      unresolved_gate_count: gateStatus?.unresolved_gate_count ?? null,
      critical_unresolved_gate_count: gateStatus?.critical_unresolved_gate_count ?? null,
      status: gateStatus?.ready_for_pr_create ? 'passed' : 'blocked',
      unresolved_gates: gateStatus?.unresolved_gates ?? [],
      critical_unresolved_gates: gateStatus?.critical_unresolved_gates ?? [],
      generated_at: generatedAt()
    };
  } finally {
    for (const entry of snapshots) {
      await rm(entry.targetPath, { recursive: true, force: true });
      if (entry.existedBefore) {
        await mkdir(path.dirname(entry.targetPath), { recursive: true });
        await cp(entry.snapshotPath, entry.targetPath, { recursive: true, preserveTimestamps: true });
      }
    }
    await rm(snapshotRoot, { recursive: true, force: true });
  }
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

function buildHumanReviewTemplate({ preparation, reviewCockpitPath, architectureReviewPath, bodyPath, gateDagPath, splitPlanPath, decisionRecordsPath = null, existingReview = null }) {
  const visualQa = preparation.pr_context?.visual_qa ?? null;
  const completionQuality = preparation.pr_context?.completion_quality ?? null;
  return {
    schema_version: '0.1.0',
    story_id: preparation.story.story_id,
    created_at: preparation.created_at,
    recommended_decision: recommendHumanDecision(preparation),
    recommendation_reason: buildHumanReviewReason(preparation),
    accepted_current_story_lineage: collectAcceptedCurrentStoryLineage(preparation.scope),
    source_artifacts: {
      review_cockpit: reviewCockpitPath,
      architecture_review: architectureReviewPath,
      pr_body: bodyPath,
      gate_dag: gateDagPath,
      split_plan: splitPlanPath,
      decision_records: decisionRecordsPath,
      visual_qa: visualQa?.artifacts ?? []
    },
    evidence_summary: {
      architecture: summarizeReviewGate(preparation.pr_context?.gate_dag, 'architecture'),
      spec: summarizeReviewGate(preparation.pr_context?.gate_dag, 'spec'),
      decision_records: preparation.pr_context?.decision_records?.summary ?? null,
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
    if (splitPlan.atomic_scope?.status === 'accepted') {
      reasons.push(`Automatic split advice is retained for review, but the typed atomic scope declaration accepts one cumulative PR: ${splitPlan.atomic_scope.reason}`);
    }
  }
  if (preparation.scope?.status && preparation.scope?.recommended_strategy) {
    reasons.push(`Scope is ${preparation.scope.status}; recommended strategy is ${preparation.scope.recommended_strategy}.`);
    if (preparation.scope.reasons?.length > 0) {
      reasons.push(`Scope evidence: ${preparation.scope.reasons.join('; ')}`);
    }
  }
  if (preparation.pr_context?.visual_qa) {
    const visualQa = preparation.pr_context.visual_qa;
    const needsReviewCount = visualQa.runs.filter((run) => run.status === 'needs_review').length;
    reasons.push(`Visual QA is ${visualQa.status}; ${needsReviewCount} run(s) exceed the ${formatVisualQaThreshold(visualQa)} residual threshold.`);
  }
  return reasons.join(' ');
}

const GITHUB_PR_BODY_CHARACTER_LIMIT = 65536;

async function resolvePrBodyForGithub(repoRoot, prepareResult, preparation) {
  const generatedBodyFile = prepareResult.artifacts.pr_body;
  const generatedBody = await readFile(generatedBodyFile, 'utf8');
  const originalStats = measurePrBody(generatedBody);
  if (originalStats.characters <= GITHUB_PR_BODY_CHARACTER_LIMIT) {
    return {
      body_file: generatedBodyFile,
      metadata: buildPrBodyLimitMetadata(repoRoot, {
        status: 'within_limit',
        strategy: 'original_body',
        reason: 'generated_pr_body_within_github_limit',
        originalBody: generatedBody,
        postedBody: generatedBody,
        generatedBodyFile,
        postedBodyFile: generatedBodyFile,
        omittedSections: []
      })
    };
  }

  const postedBodyFile = path.join(path.dirname(generatedBodyFile), 'pr-body.github.md');
  const auditOmitted = stripPrBodyAuditLog(generatedBody);
  const candidates = auditOmitted.omitted
    ? [{
        body: appendPrBodyLimitNotice(auditOmitted.body, preparation.story.story_id),
        strategy: 'omit_audit_log_section',
        omittedSections: auditOmitted.omitted_sections
      }]
    : [];
  candidates.push({
    body: buildMinimalGithubPrBody(preparation, generatedBody),
    strategy: 'artifact_reference_fallback',
    omittedSections: auditOmitted.omitted_sections
  });

  let selected = candidates.find((candidate) => measurePrBody(candidate.body).characters <= GITHUB_PR_BODY_CHARACTER_LIMIT);
  if (!selected) {
    selected = {
      body: forceBoundPrBody(buildMinimalGithubPrBody(preparation, generatedBody)),
      strategy: 'forced_artifact_reference_fallback',
      omittedSections: auditOmitted.omitted_sections
    };
  }
  const postedBody = selected.body.endsWith('\n') ? selected.body : `${selected.body}\n`;
  await writeFile(postedBodyFile, postedBody);
  return {
    body_file: postedBodyFile,
    metadata: buildPrBodyLimitMetadata(repoRoot, {
      status: 'truncated',
      strategy: selected.strategy,
      reason: 'generated_pr_body_exceeded_github_limit',
      originalBody: generatedBody,
      postedBody,
      generatedBodyFile,
      postedBodyFile,
      omittedSections: selected.omittedSections
    })
  };
}

function measurePrBody(body) {
  return {
    characters: Array.from(body ?? '').length,
    bytes: Buffer.byteLength(body ?? '', 'utf8')
  };
}

function buildPrBodyLimitMetadata(repoRoot, {
  status,
  strategy,
  reason,
  originalBody,
  postedBody,
  generatedBodyFile,
  postedBodyFile,
  omittedSections
}) {
  const original = measurePrBody(originalBody);
  const posted = measurePrBody(postedBody);
  return {
    status,
    strategy,
    reason,
    limit_characters: GITHUB_PR_BODY_CHARACTER_LIMIT,
    original: {
      characters: original.characters,
      bytes: original.bytes,
      body_file: toWorkspaceRelative(repoRoot, generatedBodyFile)
    },
    posted: {
      characters: posted.characters,
      bytes: posted.bytes,
      body_file: toWorkspaceRelative(repoRoot, postedBodyFile)
    },
    omitted_sections: omittedSections
  };
}

function stripPrBodyAuditLog(body) {
  const match = body.match(/^##\s+(監査ログ|Audit Log)\s*$/m);
  if (!match) {
    return {
      body,
      omitted: false,
      omitted_sections: []
    };
  }
  return {
    body: body.slice(0, match.index).trimEnd(),
    omitted: true,
    omitted_sections: [match[1] === 'Audit Log' ? '## Audit Log' : '## 監査ログ']
  };
}

function appendPrBodyLimitNotice(body, storyId) {
  return `${body.trimEnd()}

## 詳細
- GitHub本文の65,536文字制限を超えたため、監査ログ詳細はartifact参照に集約しました。
- 生成本文: ${formatRepoPathLink(`.vibepro/pr/${storyId}/pr-body.md`)}
- PR準備: ${formatRepoPathLink(`.vibepro/pr/${storyId}/pr-prepare.json`)}
`;
}

function buildMinimalGithubPrBody(preparation, generatedBody) {
  const story = preparation.story;
  const evidenceDir = `.vibepro/pr/${story.story_id}`;
  const gateStatus = preparation.pr_context?.gate_dag?.overall_status ?? '-';
  const executionStatus = preparation.pr_context?.execution_gate?.status ?? '-';
  const sourcePath = preparation.pr_context?.story_source?.path ?? null;
  const changedCount = Array.isArray(preparation.git?.changed_files) ? preparation.git.changed_files.length : 0;
  const generatedStats = measurePrBody(generatedBody);
  return `## 判断
- Story: ${story.title ?? story.story_id} (${story.story_id})
- 正本: ${sourcePath ? formatRepoPathLink(sourcePath) : 'Story未検出'}
- 変更範囲: ${changedCount} files
- GitHub本文の65,536文字制限を超えたため、投稿本文はartifact参照版に圧縮しました。

## 確認
- Gate: ${gateStatus}
- 実行状態: ${executionStatus}

## 詳細
- 生成本文: ${formatRepoPathLink(`${evidenceDir}/pr-body.md`)}
- PR準備: ${formatRepoPathLink(`${evidenceDir}/pr-prepare.json`)}
- 判断索引: ${formatRepoPathLink(`${evidenceDir}/decision-index.json`)}
- Gate DAG: ${formatRepoPathLink(`${evidenceDir}/gate-dag.json`)}
- 生成本文サイズ: ${generatedStats.characters} characters / ${generatedStats.bytes} bytes
`;
}

function forceBoundPrBody(body) {
  const suffix = '\n\n詳細は `.vibepro/pr/` artifacts を確認してください。\n';
  const maxBodyCharacters = GITHUB_PR_BODY_CHARACTER_LIMIT - Array.from(suffix).length;
  return `${Array.from(body).slice(0, Math.max(0, maxBodyCharacters)).join('')}${suffix}`;
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
  const nonWorkspaceDirtyFiles = (preparation.git.dirty_files ?? []).filter((file) => !isWorkspaceArtifactPath(file.path));
  if (nonWorkspaceDirtyFiles.length > 0) {
    throw new Error(
      `Pre-create dirty worktree check failed: ${nonWorkspaceDirtyFiles.length} non-workspace file(s) are dirty and would not be included in the pushed PR branch. ` +
      `Commit, stash, or discard these files before \`vibepro pr create\`: ${nonWorkspaceDirtyFiles.map((file) => file.path).join(', ')}`
    );
  }
  if (gateDag && gateDag.overall_status !== 'ready_for_review' && !options.allowNeedsVerification) {
    const unresolved = collectPrReadinessBlockingItems(gateDag);
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
  const generatedBodyFile = prepareResult.artifacts.pr_body;
  const warnings = [];
  const gateOverride = buildGateOverride(gateDag, options, {
    completionQuality: preparation.pr_context?.completion_quality ?? null,
    toolchain: preparation.toolchain ?? null
  });
  if (gateOverride?.allowed) {
    warnings.push(`Gate override used: ${gateOverride.reason}`);
    warnings.push(`Unresolved gates: ${formatUnresolvedGateList(gateOverride.unresolved_gates)}`);
    await appendGateOverrideToPrBody(generatedBodyFile, gateOverride);
  }
  if (headBranch === baseBranch) {
    warnings.push(`head branch equals base branch: ${headBranch}`);
    if (!options.dryRun) {
      throw new Error(`Cannot create PR because head branch equals base branch: ${headBranch}. Switch to a feature branch or specify --head.`);
    }
  }
  const prBodyForGithub = await resolvePrBodyForGithub(root, prepareResult, preparation);
  const bodyFile = prBodyForGithub.body_file;
  if (prBodyForGithub.metadata.status === 'truncated') {
    warnings.push(
      `GitHub PR body limit guard compressed generated body from ` +
      `${prBodyForGithub.metadata.original.characters} to ${prBodyForGithub.metadata.posted.characters} characters ` +
      `using ${prBodyForGithub.metadata.strategy}.`
    );
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
  const ghExistingPrListCommand = ['gh', [
    'pr',
    'list',
    '--base',
    baseBranch,
    '--head',
    headBranch,
    '--state',
    'open',
    '--json',
    'number,url,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus',
    '--limit',
    '1'
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
    current_head_sha: preparation.git.head_sha ?? null,
    artifact_freshness: buildCurrentPrLifecycleArtifactFreshness('pr_create', preparation.git.head_sha ?? null, createdAt),
    base: baseBranch,
    head: headBranch,
    title,
    body_file: toWorkspaceRelative(root, bodyFile),
    generated_body_file: toWorkspaceRelative(root, generatedBodyFile),
    pr_body_limit: prBodyForGithub.metadata,
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
      if (!isExistingPullRequestCreateError(ghResult)) {
        execution.status = 'failed';
        execution.error = `Command failed: ${ghResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      execution.commands.push(formatCommand(ghExistingPrListCommand));
      const existingPrListResult = await runCommand(root, ghExistingPrListCommand, options);
      execution.results.push(existingPrListResult);
      if (existingPrListResult.exit_code !== 0) {
        execution.status = 'failed';
        execution.error = `Existing PR lookup failed after duplicate PR create response: ${existingPrListResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      const existingPr = parseExistingPullRequestFromList(existingPrListResult.stdout);
      if (!existingPr) {
        execution.status = 'failed';
        execution.error = 'Existing PR create response was returned, but no open PR matched the requested base/head.';
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      const normalizedExistingPr = normalizeExistingPullRequest(existingPr);
      const expectedHeadSha = preparation.git.head_sha ?? null;
      if (!isMatchingHeadOid(normalizedExistingPr.head_ref_oid, expectedHeadSha)) {
        execution.status = 'failed';
        execution.existing_pr = {
          ...normalizedExistingPr,
          body_updated: false
        };
        execution.error = `Existing PR head mismatch: expected current head ${expectedHeadSha ?? '-'}, got ${normalizedExistingPr.head_ref_oid ?? '-'}.`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      const editTarget = normalizedExistingPr.url ?? (normalizedExistingPr.number ? String(normalizedExistingPr.number) : null);
      if (!editTarget) {
        execution.status = 'failed';
        execution.existing_pr = {
          ...normalizedExistingPr,
          body_updated: false
        };
        execution.error = 'Existing PR lookup succeeded, but no URL or number was available for PR body refresh.';
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      const ghExistingPrEditCommand = ['gh', [
        'pr',
        'edit',
        editTarget,
        '--title',
        title,
        '--body-file',
        bodyFile
      ]];
      execution.commands.push(formatCommand(ghExistingPrEditCommand));
      const existingPrEditResult = await runCommand(root, ghExistingPrEditCommand, options);
      execution.results.push(existingPrEditResult);
      if (existingPrEditResult.exit_code !== 0) {
        execution.status = 'failed';
        execution.existing_pr = {
          ...normalizedExistingPr,
          body_updated: false
        };
        execution.error = `Existing PR body refresh failed: ${existingPrEditResult.command}`;
        await writePrCreateArtifacts(root, prepareResult, execution);
        throw new Error(execution.error);
      }
      execution.status = 'updated_existing_pr';
      execution.pr_url = normalizedExistingPr.url;
      execution.existing_pr = {
        ...normalizedExistingPr,
        body_updated: true
      };
      execution.warnings.push('Existing open PR detected for the requested base/head; refreshed PR body and pr-create artifact for the current head instead of creating a duplicate PR.');
    } else {
      execution.pr_url = extractPrUrl(ghResult.stdout);
    }
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

export async function shipPullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const dryRun = options.dryRun === true;
  const prepareResult = await preparePullRequest(root, options);
  const { preparation } = prepareResult;
  const gateStatus = preparation.gate_status
    ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
  const agentReviewActions = buildAgentReviewShipActions(gateStatus, preparation.story.story_id);
  const humanJudgments = buildShipHumanJudgments(gateStatus);
  const safeOperations = [{
    id: 'pr_prepare',
    status: 'executed',
    command: buildShipPrepareCommand(preparation, options),
    artifact: prepareResult.artifacts?.json ? toWorkspaceRelative(root, prepareResult.artifacts.json) : null,
    reason: 'pr ship always regenerates PR prepare artifacts before deciding the next step'
  }];
  const readyForPrCreate = gateStatus.ready_for_pr_create === true;
  const prCreateCommand = buildShipPrCreateCommand(preparation, options);
  const ship = {
    schema_version: '0.1.0',
    story_id: preparation.story.story_id,
    created_at: new Date().toISOString(),
    dry_run: dryRun,
    status: readyForPrCreate
      ? dryRun ? 'ready_for_pr_create' : 'pr_create_attempted'
      : 'blocked',
    stop_reason: readyForPrCreate
      ? dryRun ? 'ready_for_pr_create_dry_run' : null
      : buildShipStopReason(gateStatus),
    safe_operations: safeOperations,
    human_judgments_required: humanJudgments,
    required_agent_review: agentReviewActions,
    next_commands: readyForPrCreate
      ? dryRun ? [prCreateCommand] : []
      : buildShipNextCommands({ preparation, gateStatus, agentReviewActions, options }),
    pr_create_command: readyForPrCreate ? prCreateCommand : null,
    raw_gh_pr_create_suggested: false,
    gate_status: gateStatus,
    prepare_artifacts: mapArtifactPaths(root, prepareResult.artifacts)
  };

  if (!readyForPrCreate || dryRun) {
    return {
      story: preparation.story,
      preparation,
      ship,
      execution: null,
      artifacts: prepareResult.artifacts
    };
  }

  const createResult = await createPullRequest(root, options);
  ship.status = createResult.execution?.status ?? 'pr_created';
  ship.execution = createResult.execution;
  return {
    ...createResult,
    ship
  };
}

export async function autopilotPullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const dryRun = options.dryRun === true;
  const operations = [];
  const reviewPreparations = [];
  // Preflight runs first (before gate evaluation): detect recipe-known evidence
  // pitfalls and either auto-fix schema-identical artifacts or report the exact
  // next command. It never touches gate verdicts, waivers, or review records.
  const preflight = await runRecipePreflight(root, {
    storyId: options.storyId,
    dryRun
  });
  let prepareResult = await preparePullRequest(root, options);
  let { preparation } = prepareResult;
  let gateStatus = preparation.gate_status
    ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
  operations.push({
    id: 'pr_prepare_initial',
    status: 'executed',
    command: buildShipPrepareCommand(preparation, options),
    artifact: prepareResult.artifacts?.json ? toWorkspaceRelative(root, prepareResult.artifacts.json) : null,
    reason: 'autopilot starts from the current PR gate state'
  });

  const configuredCommands = await resolveAutopilotVerificationCommands(root, {
    rawVerifyCommands: options.verifyCommands,
    preparation
  });
  const existingEvidence = await bindVerificationEvidenceToGit(
    root,
    await readVerificationEvidenceIfExists(root, preparation.story.story_id),
    preparation.git
  );
  const passingKinds = new Set((existingEvidence?.commands ?? [])
    .filter((command) => isPassingVerificationStatus(command.status) && command.binding?.status === 'current')
    .map((command) => command.kind));
  const commandsToRun = configuredCommands.filter((command) => !passingKinds.has(command.kind));

  for (const command of configuredCommands.filter((item) => passingKinds.has(item.kind))) {
    operations.push({
      id: `verify_${command.kind}`,
      status: 'skipped',
      command: command.command,
      kind: command.kind,
      reason: 'existing current passing verification record is present; autopilot does not overwrite it'
    });
  }

  for (const command of commandsToRun) {
    if (dryRun) {
      operations.push({
        id: `verify_${command.kind}`,
        status: 'planned',
        command: command.command,
        kind: command.kind,
        reason: 'dry-run: command would execute and record by exit code'
      });
      continue;
    }
    await initWorkspace(root, { language: options.language });
    const run = await runAutopilotVerificationCommand(root, preparation.story.story_id, command);
    const artifact = await writeAutopilotVerificationArtifact(root, preparation.story.story_id, command.kind, run);
    await recordVerificationEvidence(root, {
      storyId: preparation.story.story_id,
      kind: command.kind,
      status: run.exit_code === 0 ? 'pass' : 'fail',
      command: command.command,
      summary: run.exit_code === 0
        ? `Autopilot verification passed for ${command.kind}`
        : `Autopilot verification failed for ${command.kind}`,
      artifact: toWorkspaceRelative(root, artifact),
      targets: command.targets,
      scenarios: [`autopilot executed ${command.kind} verification command`],
      observed: [
        `exit_code=${run.exit_code}`,
        `head_sha=${run.head_sha ?? 'unknown'}`
      ]
    });
    operations.push({
      id: `verify_${command.kind}`,
      status: run.exit_code === 0 ? 'executed' : 'failed',
      command: command.command,
      kind: command.kind,
      exit_code: run.exit_code,
      artifact: toWorkspaceRelative(root, artifact),
      reason: run.exit_code === 0
        ? 'verification evidence recorded from command exit code'
        : 'verification failed and was recorded as fail; autopilot stops without promoting it to pass'
    });
    prepareResult = await preparePullRequest(root, options);
    preparation = prepareResult.preparation;
    gateStatus = preparation.gate_status
      ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
    operations.push({
      id: `pr_prepare_after_verify_${command.kind}`,
      status: 'executed',
      command: buildShipPrepareCommand(preparation, options),
      artifact: prepareResult.artifacts?.json ? toWorkspaceRelative(root, prepareResult.artifacts.json) : null,
      reason: 'gate state was re-evaluated after verification evidence changed'
    });
    if (run.exit_code !== 0) {
      return buildAutopilotResult(root, prepareResult, {
        dryRun,
        preflight,
        operations,
        reviewPreparations,
        stopReason: 'verification_failed',
        configuredCommands,
        options
      });
    }
  }

  if ((options.importCi === true || options.pr) && !dryRun) {
    await initWorkspace(root, { language: options.language });
    const ci = await importCiEvidence(root, {
      storyId: preparation.story.story_id,
      pr: options.pr,
      checks: options.ciChecks,
      coverage: options.ciCoverage,
      env: options.env
    });
    operations.push({
      id: 'verify_import_ci',
      status: ci.failures.length > 0 ? 'failed' : ci.pending.length > 0 ? 'blocked' : 'executed',
      command: buildAutopilotImportCiCommand(preparation.story.story_id, options),
      imported: ci.imported.length,
      pending: ci.pending.length,
      failures: ci.failures.length,
      reason: ci.failures.length > 0
        ? 'CI failures were not imported as pass'
        : ci.pending.length > 0
          ? 'CI is not complete yet'
          : 'CI evidence imported from current PR head'
    });
    prepareResult = await preparePullRequest(root, options);
    preparation = prepareResult.preparation;
    gateStatus = preparation.gate_status
      ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
    operations.push({
      id: 'pr_prepare_after_ci_import',
      status: 'executed',
      command: buildShipPrepareCommand(preparation, options),
      artifact: prepareResult.artifacts?.json ? toWorkspaceRelative(root, prepareResult.artifacts.json) : null,
      reason: 'gate state was re-evaluated after CI evidence import'
    });
    if (ci.failures.length > 0 || ci.pending.length > 0) {
      return buildAutopilotResult(root, prepareResult, {
        dryRun,
        preflight,
        operations,
        reviewPreparations,
        stopReason: ci.failures.length > 0 ? 'ci_failed' : 'ci_incomplete',
        configuredCommands,
        options
      });
    }
  } else if (options.importCi === true || options.pr) {
    operations.push({
      id: 'verify_import_ci',
      status: 'planned',
      command: buildAutopilotImportCiCommand(preparation.story.story_id, options),
      reason: 'dry-run: CI evidence would be imported if PR checks are complete and successful'
    });
  }

  let agentReviewActions = buildAgentReviewShipActions(gateStatus, preparation.story.story_id);
  const reviewActionsToPrepare = agentReviewActions.filter((action) => hasConcreteReviewPrepareInputs(action));
  for (const action of reviewActionsToPrepare) {
    if (dryRun) {
      operations.push({
        id: `review_prepare_${action.stage}`,
        status: 'planned',
        command: action.prepare_command,
        stage: action.stage,
        roles: action.roles,
        reason: 'dry-run: review dispatch artifact would be generated'
      });
      continue;
    }
    await initWorkspace(root, { language: options.language });
    let review;
    try {
      review = await prepareAgentReview(root, {
        storyId: preparation.story.story_id,
        stage: action.stage,
        roles: action.roles,
        language: options.language
      });
    } catch (error) {
      operations.push({
        id: `review_prepare_${action.stage}`,
        status: 'blocked',
        command: action.prepare_command,
        stage: action.stage,
        roles: action.roles,
        reason: error?.message
          ? `review dispatch requires coordinator judgment: ${error.message}`
          : 'review dispatch requires coordinator judgment'
      });
      return buildAutopilotResult(root, prepareResult, {
        dryRun,
        preflight,
        operations,
        reviewPreparations,
        stopReason: 'review_prepare_requires_human_judgment',
        configuredCommands,
        agentReviewActions,
        options
      });
    }
    reviewPreparations.push(review);
    operations.push({
      id: `review_prepare_${action.stage}`,
      status: 'executed',
      command: action.prepare_command,
      stage: action.stage,
      roles: action.roles,
      artifact: review.artifacts?.parallel_dispatch ?? action.artifact,
      reason: 'review dispatch instructions generated; verdict recording remains a human/coordinator judgment'
    });
  }

  if (reviewActionsToPrepare.length > 0 && !dryRun) {
    prepareResult = await preparePullRequest(root, options);
    preparation = prepareResult.preparation;
    gateStatus = preparation.gate_status
      ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
    operations.push({
      id: 'pr_prepare_after_review_prepare',
      status: 'executed',
      command: buildShipPrepareCommand(preparation, options),
      artifact: prepareResult.artifacts?.json ? toWorkspaceRelative(root, prepareResult.artifacts.json) : null,
      reason: 'gate state was re-evaluated after review dispatch generation'
    });
    agentReviewActions = buildAgentReviewShipActions(gateStatus, preparation.story.story_id);
  }

  return buildAutopilotResult(root, prepareResult, {
    dryRun,
    preflight,
    operations,
    reviewPreparations,
    stopReason: null,
    configuredCommands,
    agentReviewActions,
    options
  });
}

export function createSafeAutopilotPullRequest(dependencies = {}) {
  const prepare = dependencies.preparePullRequest ?? preparePullRequest;
  const resolveCommands = dependencies.resolveCommands ?? resolveAutopilotVerificationCommands;
  const readEvidence = dependencies.readEvidence ?? readVerificationEvidenceIfExists;
  const bindEvidence = dependencies.bindEvidence ?? bindVerificationEvidenceToGit;
  return async function safeAutopilot(repoRoot, options = {}) {
  if (options.importCi === true || options.pr || options.ciChecks || options.env) {
    return {
      status: 'waiting_for_human',
      stop_reason: 'approval_required',
      reason: 'external autopilot options are not repo-local'
    };
  }
  const root = path.resolve(repoRoot);
  const prepareResult = await prepare(root, options);
  const artifact = prepareResult.artifacts?.json ? toWorkspaceRelative(root, prepareResult.artifacts.json) : null;
  const commands = await resolveCommands(root, {
    rawVerifyCommands: options.verifyCommands,
    preparation: prepareResult.preparation
  });
  const existing = await bindEvidence(
    root,
    await readEvidence(root, prepareResult.preparation.story.story_id),
    prepareResult.preparation.git
  );
  const currentEvidence = (existing?.commands ?? []).filter((item) => item.binding?.status === 'current');
  const passing = new Set(currentEvidence
    .filter((item) => isPassingVerificationStatus(item.status) && item.binding?.status === 'current')
    .map((item) => item.kind));
  const failed = new Set(currentEvidence
    .filter((item) => !isPassingVerificationStatus(item.status))
    .map((item) => item.kind));
  if (commands.some((item) => failed.has(item.kind))) {
    const failedKinds = commands.filter((item) => failed.has(item.kind)).map((item) => item.kind);
    return {
      status: 'blocked',
      stop_reason: 'verification_failed',
      artifact,
      recovery: { failed_kinds: failedKinds },
      preparation: prepareResult.preparation
    };
  }
  if (commands.some((item) => !passing.has(item.kind))) {
    const missingKinds = commands.filter((item) => !passing.has(item.kind)).map((item) => item.kind);
    return {
      status: 'waiting_for_runtime',
      stop_reason: 'runtime_required',
      artifact,
      recovery: { missing_kinds: missingKinds },
      preparation: prepareResult.preparation
    };
  }
  const gate = prepareResult.preparation.gate_status
    ?? buildPrPrepareGateStatus(prepareResult.preparation.pr_context?.gate_dag, prepareResult.preparation.pr_context?.completion_quality);
  if (gate.ready_for_pr_create === true) return { status: 'pr_ready', artifact, preparation: prepareResult.preparation };
  if ((gate.human_judgments_required ?? []).length > 0) {
    return {
      status: 'waiting_for_human',
      stop_reason: 'human_judgment_required',
      artifact,
      recovery: { judgments: gate.human_judgments_required },
      preparation: prepareResult.preparation
    };
  }
  const critical = (gate.unresolved_gates ?? []).find((item) => item.severity === 'critical' || item.critical === true);
  return {
    status: 'blocked',
    stop_reason: critical?.id ?? gate.stop_reason ?? 'gate_blocked',
    artifact,
    recovery: { required_actions: gate.next_required_actions ?? [] },
    preparation: prepareResult.preparation
  };
  };
}

export const safeAutopilotPullRequest = createSafeAutopilotPullRequest();

export function renderPrAutopilotSummary(result) {
  const autopilot = result.autopilot;
  const gateStatus = autopilot.gate_status ?? {};
  const operations = autopilot.safe_operations?.length
    ? autopilot.safe_operations.map((operation) => `- ${operation.id}: ${operation.status} (${operation.command ?? '-'})`).join('\n')
    : '- none';
  const judgments = autopilot.human_judgments_required?.length
    ? autopilot.human_judgments_required.map((item) => `- ${item.kind}: ${item.reason}`).join('\n')
    : '- none';
  const nextCommands = autopilot.next_commands?.length
    ? autopilot.next_commands.map((command) => `- ${command}`).join('\n')
    : '- none';
  const preflightResults = autopilot.preflight?.results?.filter((item) => item.detected) ?? [];
  const preflight = preflightResults.length
    ? preflightResults.map((item) => {
      // Keep every rendered line attached to its bullet: the reason explains
      // why the recipe fired, and multiline next_commands (e.g. frontmatter
      // guidance) are indented so they cannot read as orphaned paragraphs.
      const lines = [`- ${item.recipe_id}: ${item.action_taken ?? item.action}${item.reason ? ` — ${item.reason}` : ''}`];
      if (item.next_command) {
        const [first, ...rest] = String(item.next_command).split('\n');
        lines.push(`    next: ${first}`);
        for (const continuation of rest) lines.push(`    ${continuation}`);
      }
      return lines.join('\n');
    }).join('\n')
    : '- none detected';
  return `# PR Autopilot

| 項目 | 内容 |
|------|------|
| Story | ${autopilot.story_id} |
| Status | ${autopilot.status} |
| Stop reason | ${autopilot.stop_reason ?? '-'} |
| Gate readiness | ${gateStatus.overall_status ?? '-'} |
| Ready for pr create | ${gateStatus.ready_for_pr_create ? 'yes' : 'no'} |
| Automated steps | ${autopilot.automated_step_count} |
| Human judgments | ${autopilot.human_judgment_count} |

## Preflight

${preflight}

## Safe Operations

${operations}

## Human Judgment Required

${judgments}

## Next Commands

${nextCommands}
`;
}

async function resolveAutopilotVerificationCommands(repoRoot, { rawVerifyCommands = [], preparation }) {
  const fromCli = normalizeAutopilotVerificationCommands(rawVerifyCommands, 'cli');
  const fromConfig = normalizeAutopilotVerificationCommands(await readAutopilotVerificationCommandsFromConfig(repoRoot), 'config');
  const fromPrepare = normalizeAutopilotVerificationCommands(preparation.pr_context?.verification_commands, 'pr_prepare');
  const merged = new Map();
  for (const command of [...fromPrepare, ...fromConfig, ...fromCli]) {
    if (!command.kind || !command.command) continue;
    merged.set(command.kind, command);
  }
  return [...merged.values()];
}

async function readAutopilotVerificationCommandsFromConfig(repoRoot) {
  try {
    const config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
    return config.pr_autopilot?.verification_commands
      ?? config.verification?.commands
      ?? [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function normalizeAutopilotVerificationCommands(values, source) {
  const entries = Array.isArray(values) ? values : [];
  return entries.map((entry) => normalizeAutopilotVerificationCommand(entry, source)).filter(Boolean);
}

function normalizeAutopilotVerificationCommand(entry, source) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const separator = entry.indexOf('=');
    const kind = separator > 0 ? entry.slice(0, separator).trim() : '';
    const command = separator > 0 ? entry.slice(separator + 1).trim() : '';
    if (!kind || !command) throw new Error(`pr autopilot --verify must be kind=command, got: ${entry}`);
    return {
      kind,
      command,
      source,
      targets: []
    };
  }
  const kind = String(entry.kind ?? '').trim();
  const command = String(entry.command ?? '').trim();
  if (!kind || !command) return null;
  return {
    kind,
    command,
    source,
    targets: Array.isArray(entry.targets) ? entry.targets : []
  };
}

async function runAutopilotVerificationCommand(repoRoot, storyId, verificationCommand) {
  const startedAt = new Date();
  const shell = process.env.SHELL || '/bin/sh';
  const headSha = await gitOptionalValue(repoRoot, ['rev-parse', 'HEAD']);
  try {
    const { stdout, stderr } = await execFileAsync(shell, ['-lc', verificationCommand.command], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024
    });
    return {
      schema_version: '0.1.0',
      story_id: storyId,
      kind: verificationCommand.kind,
      command: verificationCommand.command,
      status: 'pass',
      exit_code: 0,
      stdout,
      stderr,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      head_sha: headSha || null
    };
  } catch (error) {
    return {
      schema_version: '0.1.0',
      story_id: storyId,
      kind: verificationCommand.kind,
      command: verificationCommand.command,
      status: 'fail',
      exit_code: Number.isInteger(error.code) ? error.code : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      head_sha: headSha || null
    };
  }
}

async function writeAutopilotVerificationArtifact(repoRoot, storyId, kind, run) {
  const dir = path.join(getWorkspaceDir(repoRoot), 'pr', storyId, 'autopilot');
  await mkdir(dir, { recursive: true });
  const artifactPath = path.join(dir, `${kind}-verification.json`);
  await writeFile(artifactPath, `${JSON.stringify(run, null, 2)}\n`);
  return artifactPath;
}

async function gitOptionalValue(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

function buildAutopilotImportCiCommand(storyId, options = {}) {
  const args = ['vibepro verify import-ci .', '--id', shellQuote(storyId)];
  if (options.pr) args.push('--pr', shellQuote(options.pr));
  for (const check of options.ciChecks ?? []) args.push('--check', shellQuote(check));
  for (const coverage of options.ciCoverage ?? []) args.push('--coverage', shellQuote(coverage));
  return args.join(' ');
}

function hasConcreteReviewPrepareInputs(action) {
  return Boolean(action?.stage)
    && Array.isArray(action.roles)
    && action.roles.length > 0
    && action.roles.every((role) => role && !String(role).includes('<'));
}

function buildAutopilotResult(root, prepareResult, {
  dryRun,
  preflight = null,
  operations,
  reviewPreparations,
  stopReason,
  configuredCommands,
  agentReviewActions = null,
  options = {}
}) {
  const { preparation } = prepareResult;
  const gateStatus = preparation.gate_status
    ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
  const effectiveAgentReviewActions = agentReviewActions ?? buildAgentReviewShipActions(gateStatus, preparation.story.story_id);
  const humanJudgments = buildShipHumanJudgments(gateStatus);
  const noConfiguredVerification = configuredCommands.length === 0
    && gateStatus.unresolved_gates?.some((gate) => isVerificationGate(gate));
  const nextCommands = buildAutopilotNextCommands({
    preparation,
    gateStatus,
    agentReviewActions: effectiveAgentReviewActions,
    options
  });
  if (noConfiguredVerification) {
    nextCommands.unshift(
      `vibepro pr autopilot . --story-id ${shellQuote(preparation.story.story_id)} --verify <kind=command>`
    );
  }
  const ready = gateStatus.ready_for_pr_create === true;
  const resolvedStopReason = stopReason
    ?? (ready
      ? dryRun ? 'ready_for_pr_create_dry_run' : null
      : noConfiguredVerification
        ? 'verification_command_undefined'
        : buildShipStopReason(gateStatus));
  const autopilot = {
    schema_version: '0.1.0',
    story_id: preparation.story.story_id,
    created_at: new Date().toISOString(),
    dry_run: dryRun,
    preflight: preflight ?? { schema_version: '0.1.0', results: [] },
    status: ready
      ? 'ready_for_pr_create'
      : dryRun
        ? 'planned'
        : 'stopped',
    stop_reason: resolvedStopReason,
    safe_operations: operations,
    automated_step_count: operations.filter((operation) => ['executed', 'skipped'].includes(operation.status)).length,
    human_judgment_count: humanJudgments.length,
    human_judgments_required: humanJudgments,
    required_agent_review: effectiveAgentReviewActions,
    review_preparations: reviewPreparations,
    configured_verification_commands: configuredCommands,
    next_commands: [...new Set(nextCommands)],
    gate_status: gateStatus,
    prepare_artifacts: mapArtifactPaths(root, prepareResult.artifacts)
  };
  return {
    story: preparation.story,
    preparation,
    autopilot,
    artifacts: prepareResult.artifacts
  };
}

function isVerificationGate(gate) {
  return String(gate?.id ?? '').startsWith('gate:unit')
    || String(gate?.id ?? '').startsWith('gate:integration')
    || String(gate?.id ?? '').startsWith('gate:e2e')
    || String(gate?.id ?? '').startsWith('gate:typecheck')
    || String(gate?.id ?? '').startsWith('gate:build')
    || String(gate?.type ?? '').includes('verification');
}

function buildAutopilotNextCommands({ preparation, gateStatus, agentReviewActions, options }) {
  const commands = buildShipNextCommands({ preparation, gateStatus, agentReviewActions, options });
  if (gateStatus.ready_for_pr_create === true) {
    commands.unshift(buildShipPrCreateCommand(preparation, options));
  }
  return commands;
}

export function renderPrShipSummary(result) {
  const ship = result.ship;
  const gateStatus = ship.gate_status ?? {};
  const agentActions = ship.required_agent_review?.length
    ? ship.required_agent_review.flatMap((action) => [
        `- prepare: ${action.prepare_command}`,
        `- start: ${action.start_command_template}`,
        `- record: ${action.record_command_template}`
      ]).join('\n')
    : '- none';
  const humanJudgments = ship.human_judgments_required?.length
    ? ship.human_judgments_required.map((item) => `- ${item.kind}: ${item.reason}`).join('\n')
    : '- none';
  const nextCommands = ship.next_commands?.length
    ? ship.next_commands.map((command) => `- ${command}`).join('\n')
    : '- none';
  return `# PR Ship

| 項目 | 内容 |
|------|------|
| Story | ${ship.story_id} |
| Status | ${ship.status} |
| Stop reason | ${ship.stop_reason ?? '-'} |
| Gate readiness | ${gateStatus.overall_status ?? '-'} |
| Ready for pr create | ${gateStatus.ready_for_pr_create ? 'yes' : 'no'} |
| Raw gh pr create suggested | ${ship.raw_gh_pr_create_suggested ? 'yes' : 'no'} |

## Safe Operations

${ship.safe_operations.map((operation) => `- ${operation.id}: ${operation.status} (${operation.command})`).join('\n')}

## Human Judgment Required

${humanJudgments}

## Agent Review Actions

${agentActions}

## Next Commands

${nextCommands}
`;
}

function buildAgentReviewShipActions(gateStatus, storyId = '<story-id>') {
  const unresolved = gateStatus?.unresolved_gates ?? [];
  const rolesByStage = new Map();
  for (const gate of unresolved) {
    const parsed = parseAgentReviewRoleGate(gate.id);
    if (!parsed) continue;
    const roles = rolesByStage.get(parsed.stage) ?? new Set();
    roles.add(parsed.role);
    rolesByStage.set(parsed.stage, roles);
  }
  const prepareGateActions = unresolved
    .filter((gate) => gate.type === 'agent_review_prepare_gate' && gate.command)
    .map((gate) => {
      const stage = String(gate.id ?? '').replace(/^review:prepare:/, '');
      const roles = [...(rolesByStage.get(stage) ?? new Set(['<role>']))];
      const roleArg = roles.length === 1 ? roles[0] : '<role>';
      return {
        stage,
        roles,
        prepare_command: gate.command,
        start_command_template: buildReviewStartCommandTemplate(storyId, stage, roleArg),
        close_command_template: `vibepro review close . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(roleArg)} --agent-id ${shellQuote('<agent-id>')} --close-reason completed --close-evidence ${shellQuote('<artifact>')}`,
        record_command_template: buildReviewRecordCommandTemplate(storyId, stage, roleArg),
        artifact: gate.artifact ?? null,
        reason: gate.reason ?? 'required Agent Review prepare is missing'
      };
    });
  if (prepareGateActions.length > 0) return prepareGateActions;
  return [...rolesByStage.entries()].map(([stage, roleSet]) => {
    const roles = [...roleSet];
    const roleArg = roles.length === 1 ? roles[0] : '<role>';
    return {
      stage,
      roles,
      prepare_command: buildReviewPrepareCommand(storyId, stage, roles),
      start_command_template: buildReviewStartCommandTemplate(storyId, stage, roleArg),
      close_command_template: `vibepro review close . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(roleArg)} --agent-id ${shellQuote('<agent-id>')} --close-reason completed --close-evidence ${shellQuote('<artifact>')}`,
      record_command_template: buildReviewRecordCommandTemplate(storyId, stage, roleArg),
      artifact: `.vibepro/reviews/${storyId}/${stage}/parallel-dispatch.md`,
      reason: 'required Agent Review role is missing or stale'
    };
  });
}

function buildReviewStartCommandTemplate(storyId, stage, roleArg, { identity = 'agent' } = {}) {
  return `vibepro review start . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(roleArg)} --agent-system codex --agent-id ${shellQuote(`<${identity}-id>`)} --agent-thread-id ${shellQuote(`<${identity}-thread-id>`)} --agent-session-id ${shellQuote(`<${identity}-session-id>`)}`;
}

function buildReviewRecordCommandTemplate(storyId, stage, roleArg, { contentBinding = null, identity = 'agent' } = {}) {
  const command = [
    'vibepro review record .',
    '--id',
    shellQuote(storyId),
    '--stage',
    shellQuote(stage),
    '--role',
    shellQuote(roleArg),
    `--status ${shellQuote('<pass|needs_changes|block>')}`,
    '--summary "<summary>"',
    '--inspection-summary "<inspection-summary>"',
    `--inspection-evidence ${shellQuote('<inspection-evidence>')}`,
    `--inspection-input ${shellQuote('<inspection-input>')}`,
    '--judgment-delta "<initial judgment -> final judgment because evidence>"',
    '--agent-system codex',
    '--execution-mode parallel_subagent',
    `--agent-id ${shellQuote(`<${identity}-id>`)}`,
    `--agent-thread-id ${shellQuote(`<${identity}-thread-id>`)}`,
    `--agent-session-id ${shellQuote(`<${identity}-session-id>`)}`,
    `--implementation-session-id ${shellQuote('<implementation-session-id>')}`,
    '--reviewer-identity separate_session',
    `--agent-transcript ${shellQuote(`<${identity}-transcript>`)}`,
    '--agent-closed',
    `--agent-close-evidence ${shellQuote(`<${identity}-close-evidence>`)}`
  ].join(' ');
  if (contentBinding?.mode !== 'strict_head') return command;
  return `${command} --strict-head-binding --strict-head-reason "preserve the recorded strict HEAD freshness policy during recovery"`;
}

function buildReviewPrepareCommand(storyId, stage, roles = []) {
  const args = [
    'vibepro review prepare .',
    '--id',
    shellQuote(storyId),
    '--stage',
    shellQuote(stage)
  ];
  for (const role of roles) {
    args.push('--role', shellQuote(role));
  }
  return args.join(' ');
}

function isAgentReviewInternalGate(gate) {
  return gate?.type === 'agent_review_gate'
    || gate?.type === 'agent_review_dispatch_batch_gate'
    || gate?.type === 'agent_review_dispatch_preflight_gate'
    || gate?.type === 'agent_review_prepare_gate'
    || gate?.type === 'agent_review_role_gate'
    || gate?.type === 'agent_review_record_gate'
    || gate?.type === 'agent_review_stage_join_gate';
}

function buildShipHumanJudgments(gateStatus) {
  const judgments = [];
  const agentActions = buildAgentReviewShipActions(gateStatus);
  if (agentActions.length > 0 || gateStatus?.agent_review_dispatch_required) {
    judgments.push({
      kind: 'subagent_dispatch',
      reason: 'Required Agent Review must be dispatched and recorded with parallel_subagent provenance before PR creation.'
    });
  }
  const critical = gateStatus?.critical_unresolved_gates ?? [];
  for (const gate of critical) {
    if (isAgentReviewInternalGate(gate)) continue;
    judgments.push({
      kind: 'critical_gate',
      gate_id: gate.id,
      reason: gate.reason ?? `${gate.label ?? gate.id} is unresolved`
    });
  }
  const unresolved = gateStatus?.unresolved_gates ?? [];
  const nonCritical = unresolved.filter((gate) => !isAgentReviewInternalGate(gate) && !(critical ?? []).some((criticalGate) => criticalGate.id === gate.id));
  if (nonCritical.length > 0) {
    judgments.push({
      kind: 'waiver_or_evidence',
      reason: `${nonCritical.length} non-critical unresolved gate(s) require evidence or an auditable waiver.`
    });
  }
  return judgments;
}

function buildShipNextCommands({ preparation, gateStatus, agentReviewActions, options }) {
  const commands = [];
  for (const action of agentReviewActions) {
    commands.push(action.prepare_command);
    commands.push(action.start_command_template);
    commands.push(action.record_command_template);
  }
  if (gateStatus?.agent_review_dispatch_required) {
    commands.push(`vibepro review status . --id ${shellQuote(preparation.story.story_id)}`);
  }
  commands.push(buildShipPrepareCommand(preparation, options));
  return [...new Set(commands)].filter((command) => !/(^|\s)gh\s+pr\s+create(\s|$)/.test(command));
}

function parseAgentReviewRoleGate(id) {
  const value = String(id ?? '');
  let match = value.match(/^review:record:([^:]+):(.+)$/);
  if (match) return { stage: match[1], role: match[2] };
  match = value.match(/^review:([^:]+):(.+)$/);
  if (match) return { stage: match[1], role: match[2] };
  return null;
}

function buildShipStopReason(gateStatus) {
  if (gateStatus?.agent_review_dispatch_required) return 'required_agent_review_missing';
  if ((gateStatus?.critical_unresolved_gate_count ?? 0) > 0) return 'critical_gate_unresolved';
  if ((gateStatus?.unresolved_gate_count ?? 0) > 0) return 'unresolved_gate_requires_evidence_or_waiver';
  return 'not_ready';
}

function buildShipPrepareCommand(preparation, options = {}) {
  const args = ['vibepro pr prepare .'];
  args.push('--story-id', shellQuote(preparation.story.story_id));
  const base = options.baseRef ?? preparation.git?.base_ref;
  if (base) args.push('--base', shellQuote(base));
  const head = options.headRef;
  if (head) args.push('--head', shellQuote(head));
  return args.join(' ');
}

function buildShipPrCreateCommand(preparation, options = {}) {
  const args = ['vibepro pr create .'];
  args.push('--story-id', shellQuote(preparation.story.story_id));
  const base = options.prBase ?? options.baseRef ?? preparation.git?.base_ref;
  if (base) args.push('--base', shellQuote(base));
  const head = options.headBranch ?? preparation.git?.current_branch;
  if (head) args.push('--head', shellQuote(head));
  if (options.title) args.push('--title', shellQuote(options.title));
  return args.join(' ');
}

export function renderPrPrepareSummary(result) {
  const { preparation } = result;
  const language = preparation.output?.language ?? 'ja';
  const gateStatus = preparation.gate_status
    ?? buildPrPrepareGateStatus(preparation.pr_context?.gate_dag, preparation.pr_context?.completion_quality);
  const firstLook = renderPrPrepareFirstLook({ preparation, gateStatus, result, language });
  const artifactConsistencySummary = renderArtifactConsistencyGateSummary(preparation.pr_context?.gate_dag, language);
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
| Evidence depth | ${preparation.evidence_plan?.evidence_depth ?? '-'} |
| Evidence planner | ${preparation.evidence_plan?.planner_version ?? '-'} |
| Evidence reuse | ${preparation.evidence_reuse?.status ?? '-'} |
| Evidence key | ${preparation.evidence_reuse?.evidence_key ?? '-'} |
| UI/UX IA flow map | ${preparation.pr_context?.uiux_ia_flow_map?.status ?? '-'} (${preparation.pr_context?.uiux_ia_flow_map?.artifact ?? '-'}) |
| UI/UX responsive/a11y matrix | ${preparation.pr_context?.uiux_responsive_a11y_matrix?.status ?? '-'} missing=${preparation.pr_context?.uiux_responsive_a11y_matrix?.missing_evidence_count ?? '-'} (${preparation.pr_context?.uiux_responsive_a11y_matrix?.artifact ?? '-'}) |
| Base | ${preparation.git.base_ref} |
| Head | ${preparation.git.head_ref} |
| Current branch | ${preparation.git.current_branch ?? '-'} |
| Changed files | ${preparation.git.changed_files.length} |
| Commits | ${preparation.git.commits.length} |
| Scope | ${preparation.scope.status} (PR size only; not completion approval) |
| Recommended strategy | ${preparation.scope.recommended_strategy} |
| Scope reasons | ${(preparation.scope.reasons ?? []).join('; ') || '-'} |
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

${artifactConsistencySummary}
## Artifacts

- evidence_plan_json: ${toDisplayPath(result.artifacts.evidence_plan)}
- decision_index_json: ${toDisplayPath(result.artifacts.decision_index)}
- evidence_reuse_json: ${toDisplayPath(result.artifacts.evidence_reuse)}
- report_html: ${toDisplayPath(result.artifacts.report)}
- review_cockpit_html: ${toDisplayPath(result.artifacts.review_cockpit)}
- human_review_json: ${toDisplayPath(result.artifacts.human_review)}
- architecture_review_json: ${toDisplayPath(result.artifacts.architecture_review)}
- decision_records_json: ${toDisplayPath(result.artifacts.decision_records)}
- pr_body_markdown: ${toDisplayPath(result.artifacts.pr_body)}
- design_ssot_reconciliation_json: ${toDisplayPath(result.artifacts.design_ssot_reconciliation)}
- senior_gap_judgment_json: ${toDisplayPath(result.artifacts.senior_gap_judgment)}
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

function renderArtifactConsistencyGateSummary(gateDag, language = 'ja') {
  const gate = (gateDag?.nodes ?? []).find((node) => node.id === 'gate:artifact_consistency');
  const details = gate?.stale_artifact_details ?? [];
  if (!gate || details.length === 0) return '';
  const rows = details.slice(0, 10).map((detail) => [
    toDisplayPath(detail.artifact_path ?? '-'),
    detail.artifact_type ?? '-',
    detail.root_cause ?? '-',
    detail.stale_reason ?? '-',
    formatArtifactRemediationCommands(detail)
  ]);
  const overflow = details.length > rows.length
    ? localizedText(language, {
        ja: `\n\n- 他 ${details.length - rows.length} 件は pr-prepare.json の stale_artifact_details を参照してください。`,
        en: `\n\n- See stale_artifact_details in pr-prepare.json for ${details.length - rows.length} additional item(s).`
      })
    : '';
  const title = localizedText(language, {
    ja: '## Artifact Consistency',
    en: '## Artifact Consistency'
  });
  return `${title}

| Artifact | Type | Root cause | Reason | Remediation |
|----------|------|------------|--------|-------------|
${rows.map((row) => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`).join('\n')}${overflow}
`;
}

function escapeMarkdownTableCell(value) {
  return String(value ?? '-')
    .replaceAll('\\', '\\\\')
    .replaceAll('|', '\\|')
    .replaceAll('\n', '<br>');
}

function formatArtifactRemediationCommands(detail) {
  const commands = Array.isArray(detail?.remediation_commands) && detail.remediation_commands.length > 0
    ? detail.remediation_commands
    : [detail?.remediation_command].filter(Boolean);
  return commands.length > 0 ? commands.join('\n') : '-';
}

function renderPrPrepareFirstLook({ preparation, gateStatus, result, language }) {
  const unresolvedCount = gateStatus.unresolved_gate_count ?? gateStatus.unresolved_gates?.length ?? 0;
  const minimalRecovery = renderAgentReviewMinimalRecoveryPlan(gateStatus.agent_review_minimal_recovery_plan, language);
  const agentReviewLine = gateStatus.agent_review_instruction
    ? localizedText(language, {
        ja: `\n## Agent Review Gate\n\n- ${gateStatus.agent_review_instruction}${minimalRecovery ? `\n${minimalRecovery}` : ''}\n`,
        en: `\n## Agent Review Gate\n\n- ${gateStatus.agent_review_instruction}${minimalRecovery ? `\n${minimalRecovery}` : ''}\n`
      })
    : '';
  const summaryDepth = preparation.evidence_plan?.evidence_depth === 'summary';
  const artifactHint = (summaryDepth
    ? [
        `evidence-reuse: ${toDisplayPath(result.artifacts.evidence_reuse)}`,
        `decision-index: ${toDisplayPath(result.artifacts.decision_index)}`,
        `evidence-plan: ${toDisplayPath(result.artifacts.evidence_plan)}`,
        `pr-body: ${toDisplayPath(result.artifacts.pr_body)}`,
        `pr-prepare-json: ${toDisplayPath(result.artifacts.json)}`
      ]
    : [
        `evidence-reuse: ${toDisplayPath(result.artifacts.evidence_reuse)}`,
        `review-cockpit: ${toDisplayPath(result.artifacts.review_cockpit)}`,
        `pr-body: ${toDisplayPath(result.artifacts.pr_body)}`,
        `gate-dag: ${toDisplayPath(result.artifacts.gate_dag_report)}`,
        `split-plan: ${toDisplayPath(result.artifacts.split_plan_report)}`
      ]).join('\n- ');
  const completionReference = summaryDepth
    ? localizedText(language, {
        ja: '完了条件は decision-index.json の gate_summary と engineering_judgment を参照してください。',
        en: 'Use decision-index.json gate_summary and engineering_judgment as the completion reference.'
      })
    : localizedText(language, {
        ja: '完了条件は gate-dag.html、PR分割は split-plan.html を参照させてください。',
        en: 'Use gate-dag.html as the completion contract, and split-plan.html for PR splitting.'
      });
  return localizedText(language, {
    ja: `## まず見る場所

- 状態: ${gateStatus.ready_for_pr_create ? 'PR作成可能' : '未解決Gateあり'}
- 未解決Gate: ${unresolvedCount}
- base branch: ${preparation.git.base_ref}
- evidence depth: ${preparation.evidence_plan?.evidence_depth ?? '-'}
- .vibepro は診断・Story・PR gate・レビュー証跡を保存する作業台です。

## AIエージェントへの渡し方

- ${artifactHint}
- 実装依頼には pr-body.md を渡し、${completionReference}
${agentReviewLine}
`,
    en: `## Where To Look First

- Status: ${gateStatus.ready_for_pr_create ? 'ready for PR creation' : 'unresolved gates remain'}
- Unresolved gates: ${unresolvedCount}
- base branch: ${preparation.git.base_ref}
- evidence depth: ${preparation.evidence_plan?.evidence_depth ?? '-'}
- .vibepro is the workspace for diagnosis, Story, PR gate, and review evidence.

## Agent Handoff

- ${artifactHint}
- Hand pr-body.md to the coding agent. ${completionReference}
${agentReviewLine}
`
  });
}

function renderAgentReviewMinimalRecoveryPlan(plan, language = 'ja') {
  if (!plan) return '';
  const currentStage = plan.current_stage?.stage
    ? `${plan.current_stage.serial_index ?? '?'}:${plan.current_stage.stage}`
    : '-';
  const currentRoles = (plan.current_stage_work ?? [])
    .slice(0, 5)
    .map((item) => `${item.stage}:${item.role}(${item.recovery_kind})`)
    .join(', ') || '-';
  const blocked = (plan.later_stages_blocked ?? [])
    .map((stage) => `${stage.serial_index ?? '?'}:${stage.stage}`)
    .join(', ') || '-';
  const firstCommand = plan.first_command ?? '-';
  return localizedText(language, {
    ja: [
      '',
      '- minimal_recovery_plan:',
      `  - current_stage: ${currentStage}`,
      `  - current_roles: ${currentRoles}`,
      `  - first_command: \`${firstCommand}\``,
      `  - later_stages_blocked: ${blocked}`
    ].join('\n'),
    en: [
      '',
      '- minimal_recovery_plan:',
      `  - current_stage: ${currentStage}`,
      `  - current_roles: ${currentRoles}`,
      `  - first_command: \`${firstCommand}\``,
      `  - later_stages_blocked: ${blocked}`
    ].join('\n')
  });
}

function buildAuthorizationScoring({ fileGroups, storySource, decisionRecords }) {
  const riskProfile = classifyChangeRisk({
    fileGroups: fileGroups ?? {},
    storySource: storySource ?? {},
    networkContracts: null
  });
  const decisions = Array.isArray(decisionRecords?.decisions) ? decisionRecords.decisions : [];
  const scoringStorySource = storySource?.path ? storySource : null;
  const scoring = scoreAuthorization({
    riskProfile,
    storySource: scoringStorySource,
    decisions
  });
  return {
    ...scoring,
    risk_profile: riskProfile
  };
}

export function buildPrPrepareGateStatus(gateDag, completionQuality = null) {
  const unresolvedGates = collectPrReadinessBlockingItems(gateDag);
  const criticalGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const overallStatus = gateDag?.overall_status ?? 'unknown';
  const executionGate = buildExecutionGateStatus(gateDag);
  const readyForPrCreate = overallStatus === 'ready_for_review'
    && executionGate.pr_create_allowed === true
    && unresolvedGates.length === 0;
  const agentReviewAction = buildAgentReviewGateInstruction(unresolvedGates);
  const agentReviewMinimalRecoveryPlan = unresolvedGates.find((gate) => gate.id === 'gate:agent_review')?.minimal_recovery_plan ?? null;
  const fastLaneNode = (gateDag?.nodes ?? []).find((node) => node.id === 'gate:fast_lane');
  const agentReviewNode = (gateDag?.nodes ?? []).find((node) => node.id === 'gate:agent_review');
  const reviewerIndependence = agentReviewNode?.reviewer_independence ?? null;
  const agentReviewIndependence = reviewerIndependence
    ? reviewerIndependence.same_session_review_count > 0
      ? {
        status: 'same_session_warning',
        enforcement: 'warning_only',
        same_session_reviews: reviewerIndependence.same_session_reviews,
        unknown_identity_review_count: reviewerIndependence.unknown_identity_review_count,
        note: `Reviewer independence is not established: ${reviewerIndependence.same_session_review_count} review(s) were recorded by the same session as the implementation (${reviewerIndependence.same_session_reviews.join(', ')}). Warning only; the Agent Review Gate status is unchanged.`
      }
      : {
        status: 'no_same_session_reviews',
        enforcement: 'warning_only',
        same_session_reviews: [],
        unknown_identity_review_count: reviewerIndependence.unknown_identity_review_count
      }
    : null;
  return {
    schema_version: '0.1.0',
    overall_status: overallStatus,
    ready_for_pr_create: readyForPrCreate,
    execution_gate: executionGate,
    fast_lane: fastLaneNode?.evaluation?.applicable === true,
    completion_quality_status: completionQuality?.status ?? null,
    unresolved_gate_count: unresolvedGates.length,
    critical_unresolved_gate_count: criticalGates.length,
    unresolved_gates: unresolvedGates,
    critical_unresolved_gates: criticalGates,
    agent_review_independence: agentReviewIndependence,
    next_required_actions: executionGate.required_actions,
    agent_review_instruction: agentReviewAction,
    agent_review_minimal_recovery_plan: agentReviewMinimalRecoveryPlan,
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

export function buildExecutionGateStatus(gateDag) {
  const unresolvedGates = collectPrReadinessBlockingItems(gateDag);
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

function collectPrReadinessBlockingItems(gateDag) {
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag).map(enrichGateNextCommand);
  const overallStatus = gateDag?.overall_status ?? null;
  if (!gateDag || overallStatus === 'ready_for_review' || unresolvedGates.length > 0) return unresolvedGates;
  return [
    enrichGateNextCommand({
      id: 'gate:overall_status',
      type: 'gate_dag_status_gate',
      label: 'Gate DAG Overall Status',
      status: overallStatus,
      reason: 'Gate DAG overall_status is not ready_for_review, but no unresolved required gate details were emitted. Regenerate PR evidence or inspect the Gate DAG status source before PR creation.',
      required_actions: [
        'Rerun `vibepro pr prepare . --view blocking-gates` after refreshing evidence, or inspect why Gate DAG overall_status is not ready_for_review.'
      ]
    })
  ];
}

function enrichGateNextCommand(gate) {
  const commands = collectGateNextCommands(gate);
  if (commands.length === 0) return gate;
  const existingCommands = Array.isArray(gate.next_commands) ? gate.next_commands : [];
  const nextCommands = [...new Set([...existingCommands, ...commands])];
  return {
    ...gate,
    primary_next_command: gate.primary_next_command ?? nextCommands[0],
    next_commands: nextCommands
  };
}

function collectGateNextCommands(gate) {
  const commands = [];
  for (const action of gate?.required_actions ?? []) {
    commands.push(...extractCommandsFromText(action));
  }
  commands.push(...extractCommandsFromText(gate?.command));
  for (const command of gate?.next_commands ?? []) {
    commands.push(...extractCommandsFromText(command));
  }
  return commands.filter(Boolean);
}

function extractCommandsFromText(value) {
  if (typeof value !== 'string') return [];
  const text = value.trim();
  if (!text) return [];
  const tickedCommands = [...text.matchAll(/`([^`]+)`/g)]
    .map((match) => match[1]?.trim())
    .filter((command) => isLikelyNextCommand(command));
  if (tickedCommands.length > 0) return tickedCommands;
  return isLikelyNextCommand(text) ? [text] : [];
}

function isLikelyNextCommand(value) {
  return /^(vibepro|git|gh|node|npm|pnpm|yarn)\b/.test(String(value ?? '').trim());
}

function formatExecutionGateAction(gate) {
  if (gate.id === 'gate:e2e') return `Record current-head E2E evidence for ${gate.label ?? gate.id}: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:visual_qa') return `Run \`vibepro verify visual . --id <story-id> --base-url <preview-url>\` or \`vibepro verify visual . --id <story-id> --current-dir <dir>\` to produce residual artifacts, then rerun PR preparation: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:network_contract') return `Resolve Network Contract evidence: ${gate.reason ?? gate.status}`;
  if (gate.id === 'gate:pr_freshness') {
    return `Refresh PR branch and regenerate VibePro evidence: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:artifact_consistency') {
    const detailActions = (gate.stale_artifact_details ?? [])
      .slice(0, 5)
      .map((detail) => `${detail.artifact_path ?? detail.artifact_type ?? 'artifact'}: ${formatArtifactRemediationCommands(detail) || detail.stale_reason || 'refresh evidence'}`);
    const suffix = detailActions.length > 0
      ? detailActions.join(' -> ')
      : (gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status;
    return `Regenerate stale VibePro evidence artifacts for the current git state: ${suffix}`;
  }
  if (gate.id === 'gate:failure_mode_coverage') {
    return `Record current failure-mode coverage evidence: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:path_surface_matrix') {
    return `Record current path/surface evidence: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:journey_context') {
    return `Resolve Journey context for UI changes: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:review_inspection_required') {
    return `Record required review inspection evidence: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:definition_of_done') {
    return `Close Definition of Done evidence before PR creation: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:design_diagrams') {
    const downstream = (gate.downstream_diagram_requirements ?? []).map(formatDownstreamDiagramRequirementHint);
    return `Add required design diagram evidence: ${downstream.join(' -> ') || (gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:pr_scope_judgment') {
    return `Reduce or split PR scope before creation: ${(gate.required_actions ?? []).join(' -> ') || gate.reason || gate.status}`;
  }
  if (gate.id === 'gate:agent_review') {
    return (gate.required_actions?.length ?? 0) > 0
      ? gate.required_actions.join(' ')
      : `Run VibePro Agent Review workflow for the current git state: ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:judgment_security_trust_security_regression') {
    return `Record a current-bound passing security regression test, or a waiver decision (\`vibepro decision record --source gate:judgment_security_trust_security_regression --type waiver --reason ...\`): ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:judgment_agent_workflow_evidence_lifecycle') {
    return `Close the agent review evidence lifecycle for the current git state (\`vibepro review prepare\` -> dispatch -> \`vibepro review record ...\`), or record a waiver decision (\`vibepro decision record --source gate:judgment_agent_workflow_evidence_lifecycle --type waiver --reason ...\`): ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:bug_physics_triage') {
    return `Record bug-physics probe evidence before selecting a gate profile: ${gate.reason ?? gate.status}`;
  }
  if (gate.type === 'bug_physics_profile_gate') {
    return `Record verification evidence for selected bug-physics class ${gate.class ?? ''}: ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:bug_physics_contradiction_feedback') {
    return `Loop back to bug-physics triage because selected harness evidence contradicts the classification: ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:safety_secret_surface') {
    return `Record a secret_exposure decision (\`vibepro decision record --type secret_exposure --secret-location <ref> --secret-action redacted|rotated|revoked|false_positive\`) or a waiver against gate:safety_secret_surface: ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:deploy_verification') {
    return `Record current-bound deploy/smoke/health evidence (\`vibepro verify record ...\`) or a waiver against gate:deploy_verification (\`vibepro decision record --source gate:deploy_verification --type waiver --reason ...\`): ${gate.reason ?? gate.status}`;
  }
  if (gate.id === 'gate:architecture_blueprint') {
    return `Address the required architecture blueprint dimensions (${(gate.missing_dimensions ?? []).map((d) => d.label).join(', ')}) in the architecture doc, or record a waiver (\`vibepro decision record --source gate:architecture_blueprint --type waiver --reason ...\`): ${gate.reason ?? gate.status}`;
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
  return `Agent Review Gate requires staged role reviews. Run only the current listed \`vibepro review prepare\` stage, dispatch that stage's Codex/Claude Code subagent reviews in parallel when the coordinator runtime provides subagent capability, close/shutdown each review subagent after receiving its result, record each result with \`vibepro review record --execution-mode parallel_subagent --agent-closed\`, then rerun \`vibepro pr prepare\` to advance to the next stage. If the runtime has no subagent capability, block or record a human waiver decision; do not silently skip the gate.${actionText}`;
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

export async function readWorkspaceState(repoRoot) {
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
  const baseSha = await gitOptional(repoRoot, ['rev-parse', baseRef]);
  const mergeBaseSha = baseSha && headSha ? await gitOptional(repoRoot, ['merge-base', baseRef, headRef]) : '';
  const committedChangedFiles = await hydrateChangedFileContent(repoRoot, await getChangedFiles(repoRoot, baseRef, headRef));
  const diffLineStats = await getDiffLineStats(repoRoot, baseRef, headRef, includesDirtyInChangedFiles);
  const commits = await getCommits(repoRoot, baseRef, headRef);
  const commitMessageHealth = buildCommitMessageHealth(commits, { baseRef, headRef });
  // A projection that still renders byte-for-byte from its canonical source is
  // a VibePro by-product, not an author edit. The evidence and review paths
  // already exclude it from the user fingerprint; PR/Gate must use the same
  // scope or it falsely invalidates those otherwise-current artifacts.
  const generatedProjectionPaths = await collectCurrentGeneratedProjectionPaths(repoRoot, {
    storyId: options.storyId
  });
  const fingerprints = await collectGitStatusFingerprints(repoRoot, {
    userExcludePaths: generatedProjectionPaths
  });
  const originUrl = await gitOptional(repoRoot, ['config', '--get', 'remote.origin.url']);
  const refTopology = await collectRefTopology(repoRoot, {
    baseRef,
    headRef,
    currentBranch,
    baseSha,
    headSha,
    mergeBaseSha,
    baseRefExplicit: Boolean(options.baseRef)
  });
  const dirtyFiles = await hydrateChangedFileContent(repoRoot, parseStatus(fingerprints.user_status_output));
  const rawDirtyFiles = await hydrateChangedFileContent(repoRoot, parseStatus(fingerprints.status_output));
  const changedFiles = includesDirtyInChangedFiles
    ? mergeChangedAndDirtyFiles(committedChangedFiles, dirtyFiles)
    : committedChangedFiles;
  return {
    current_branch: currentBranch || null,
    base_ref: baseRef,
    head_ref: headRef,
    head_sha: headSha || null,
    base_sha: baseSha || null,
    merge_base_sha: mergeBaseSha || null,
    pr_freshness: buildPrFreshnessState({
      baseRef,
      headRef,
      baseSha,
      headSha,
      mergeBaseSha
    }),
    ref_topology: refTopology,
    origin_url: originUrl || null,
    dirty: dirtyFiles.length > 0,
    raw_dirty: rawDirtyFiles.length > 0,
    status_fingerprint_hash: fingerprints.status_fingerprint_hash,
    user_status_fingerprint_hash: fingerprints.user_status_fingerprint_hash,
    fingerprint_scope: fingerprints.fingerprint_scope,
    committed_changed_files: committedChangedFiles,
    changed_files: changedFiles,
    diff_line_stats: diffLineStats,
    dirty_files: dirtyFiles,
    raw_dirty_files: rawDirtyFiles,
    vibepro_internal_dirty_files: rawDirtyFiles.filter((file) => isVibeProInternalPath(file.path)),
    includes_dirty_in_changed_files: includesDirtyInChangedFiles,
    commit_message_health: commitMessageHealth,
    commits
  };
}

async function appendGateOverrideToPrBody(bodyFile, gateOverride) {
  const existing = await readFile(bodyFile, 'utf8');
  if (existing.includes('## VibePro Gate Waiver')) return;
  const unresolved = formatUnresolvedGateList(gateOverride.unresolved_gates);
  const critical = formatUnresolvedGateList(gateOverride.critical_unresolved_gates);
  const block = [
    '',
    '## VibePro Gate Waiver',
    '',
    `- waiver policy: ${gateOverride.waiver_policy}`,
    `- severity: ${gateOverride.severity}`,
    `- reason: ${gateOverride.reason}`,
    `- unresolved gates: ${unresolved}`,
    `- critical unresolved gates: ${critical}`,
    ''
  ].join('\n');
  await writeFile(bodyFile, `${existing.trimEnd()}\n${block}`);
}

function mergeChangedAndDirtyFiles(changedFiles, dirtyFiles) {
  const byPath = new Map(changedFiles.map((file) => [file.path, file]));
  for (const dirty of dirtyFiles) {
    if (!dirty.path) continue;
    const existing = byPath.get(dirty.path);
    if (existing) {
      byPath.set(dirty.path, {
        ...existing,
        content: existing.content ?? dirty.content
      });
      continue;
    }
    byPath.set(dirty.path, {
      ...dirty,
      status: dirty.status || 'M',
      path: dirty.path
    });
  }
  return [...byPath.values()];
}

function buildPrFreshnessState({ baseRef, headRef, baseSha, headSha, mergeBaseSha }) {
  const baseResolved = Boolean(baseSha);
  const headResolved = Boolean(headSha);
  const headContainsBase = baseResolved && headResolved && mergeBaseSha === baseSha;
  const status = !baseResolved || !headResolved
    ? 'needs_evidence'
    : headContainsBase
      ? 'passed'
      : 'needs_rebase';
  const reason = status === 'passed'
    ? `${headRef} contains current ${baseRef}; PR prepare artifacts are based on the latest resolved base ref`
    : status === 'needs_rebase'
      ? `${headRef} does not contain current ${baseRef}; run fetch/rebase, then rerun verification and vibepro pr prepare`
      : `Could not resolve ${!baseResolved ? baseRef : headRef} for PR freshness check`;
  return {
    schema_version: '0.1.0',
    status,
    base_ref: baseRef,
    head_ref: headRef,
    base_sha: baseSha || null,
    head_sha: headSha || null,
    merge_base_sha: mergeBaseSha || null,
    head_contains_base: headContainsBase,
    pr_prepare_regenerated_at_runtime: true,
    reason,
    required_actions: status === 'passed' ? [] : [
      `git fetch origin`,
      `git rebase ${baseRef}`,
      `rerun required verification evidence for the rebased HEAD`,
      `vibepro pr prepare . --story-id <story-id> --base ${baseRef}`
    ]
  };
}

async function resolveBaseRef(repoRoot) {
  const originHead = await gitOptional(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) return originHead.replace(/^origin\//, 'origin/');
  for (const ref of ['origin/develop', 'origin/main', 'develop', 'main', 'master']) {
    if (await gitRefExists(repoRoot, ref)) return ref;
  }
  return 'HEAD~1';
}

async function collectRefTopology(repoRoot, { baseRef, headRef, currentBranch, baseSha, headSha, mergeBaseSha, baseRefExplicit = false } = {}) {
  const remoteNames = (await gitOptional(repoRoot, ['remote']))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const remotes = [];
  for (const name of remoteNames) {
    remotes.push({
      name,
      url: await gitOptional(repoRoot, ['remote', 'get-url', name]) || null
    });
  }
  const refs = parseForEachRefOutput(await gitOptional(repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)\t%(objectname)',
    'refs/heads',
    'refs/remotes'
  ]));
  const branchNames = [...new Set([
    currentBranch,
    stripRemotePrefix(baseRef),
    stripRemotePrefix(headRef),
    ...refs
      .filter((ref) => ref.name.startsWith('origin/'))
      .map((ref) => stripRemotePrefix(ref.name))
  ].filter(Boolean))].sort();
  const refsByName = new Map(refs.map((ref) => [ref.name, ref.sha]));
  const branches = branchNames.map((branch) => {
    const localSha = refsByName.get(branch) ?? null;
    const remoteRefs = Object.fromEntries(remoteNames.map((remote) => {
      const refName = `${remote}/${branch}`;
      return [remote, refsByName.get(refName) ?? null];
    }));
    const remoteShas = Object.values(remoteRefs).filter(Boolean);
    const uniqueRemoteShas = [...new Set(remoteShas)];
    return {
      branch,
      local_sha: localSha,
      remotes: remoteRefs,
      divergence: {
        local_vs_remote: Boolean(localSha && uniqueRemoteShas.length > 0 && !uniqueRemoteShas.includes(localSha)),
        remote_disagreement: uniqueRemoteShas.length > 1
      }
    };
  });
  return {
    schema_version: '0.1.0',
    fetch_performed: false,
    remotes,
    refs: {
      base_ref: baseRef,
      head_ref: headRef,
      current_branch: currentBranch || null,
      base_sha: baseSha || null,
      head_sha: headSha || null,
      merge_base_sha: mergeBaseSha || null
    },
    base_selection: {
      ref: baseRef,
      explicit: baseRefExplicit,
      rule: baseRefExplicit
        ? 'cli_option'
        : 'origin_head_then_origin_develop_origin_main_develop_main_master_then_HEAD~1'
    },
    branches,
    divergence_flags: {
      head_contains_base: Boolean(baseSha && headSha && mergeBaseSha === baseSha),
      branch_divergence_detected: branches.some((branch) => branch.divergence.local_vs_remote || branch.divergence.remote_disagreement)
    }
  };
}

function parseForEachRefOutput(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name, sha] = line.split('\t');
      return { name, sha };
    })
    .filter((ref) => ref.name && ref.sha);
}

function stripRemotePrefix(ref) {
  const value = String(ref ?? '');
  const match = value.match(/^[^/]+\/(.+)$/);
  return match ? match[1] : value === 'HEAD' || value.includes('~') ? null : value;
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

const DIAGRAM_REQUIREMENT_CONTENT_PATH = /\.(json|md|mdx|ts|tsx|js|jsx|sql|prisma|ya?ml|tf|tfvars|toml)$/;
const DIAGRAM_REQUIREMENT_CONTENT_MAX_BYTES = 200_000;

async function hydrateChangedFileContent(repoRoot, files) {
  return Promise.all((files ?? []).map(async (file) => {
    if (!file?.path || file.status === 'D' || !DIAGRAM_REQUIREMENT_CONTENT_PATH.test(file.path)) return file;
    const fullPath = path.join(repoRoot, file.path);
    try {
      const stats = await stat(fullPath);
      if (!stats.isFile() || stats.size > DIAGRAM_REQUIREMENT_CONTENT_MAX_BYTES) return file;
      return {
        ...file,
        content: await readFile(fullPath, 'utf8')
      };
    } catch {
      return file;
    }
  }));
}

async function getDiffLineStats(repoRoot, baseRef, headRef, includeDirty) {
  // Working-tree diff against base covers committed + staged + unstaged tracked
  // changes in one pass; untracked/binary/renamed entries stay unknown, which
  // downstream treats as not eligible for low-risk evidence reuse.
  const output = includeDirty
    ? await gitOptional(repoRoot, ['diff', '--numstat', baseRef])
    : (await gitOptional(repoRoot, ['diff', '--numstat', `${baseRef}...${headRef}`])
      || await gitOptional(repoRoot, ['diff', '--numstat', baseRef, headRef]));
  const stats = {};
  for (const line of output.split('\n')) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match || match[3].includes(' => ')) continue;
    stats[match[3]] = {
      additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2])
    };
  }
  return stats;
}

async function getCommits(repoRoot, baseRef, headRef) {
  const output = await gitOptional(repoRoot, ['log', '--format=%H%x09%P%x09%s', `${baseRef}..${headRef}`]);
  const commits = output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha = '', parents = '', ...messageParts] = line.split('\t');
      const message = messageParts.join('\t');
      return {
        sha: sha.trim(),
        short_sha: sha.slice(0, 12),
        parent_shas: parents.trim().split(/\s+/).filter(Boolean),
        message,
        message_empty: message.trim().length === 0
      };
    });
  return Promise.all(commits.map(async (commit) => {
    const mergeTitle = String(commit.message).match(/^Merge remote-tracking branch ['"]([^'"]+)['"] into ([^\s]+)$/i);
    if (!mergeTitle) return commit;
    const remoteTrackingRef = mergeTitle[1];
    const remoteTrackingSha = (await gitOptional(repoRoot, ['rev-parse', '--verify', `refs/remotes/${remoteTrackingRef}`])).trim();
    return {
      ...commit,
      merge_source_ref: remoteTrackingRef,
      merge_target_ref: mergeTitle[2],
      remote_tracking_sha: remoteTrackingSha || null
    };
  }));
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

function buildUsedForDecisionSummary({
  verificationEvidence = null,
  gateDag = null,
  engineeringJudgment = null,
  gateStatus = null,
  decisionRecords = null
} = {}) {
  const acceptedDecisionCount = (decisionRecords?.decisions ?? []).filter((decision) => decision.status === 'accepted').length;
  if (acceptedDecisionCount > 0) return null;
  const currentPassing = collectCurrentPassingVerificationEvidence(verificationEvidence);
  if (currentPassing.length === 0) return null;
  const activeAxes = (engineeringJudgment?.judgment_axes ?? [])
    .filter((axis) => axis.status !== 'inactive')
    .map((axis) => ({
      axis: axis.axis,
      status: axis.status,
      matched_current_verification: (axis.matched_evidence ?? []).some((item) => item.kind === 'current_verification')
    }));
  const verificationGates = (gateDag?.nodes ?? [])
    .filter((gate) => gate.status === 'passed' && /verification|test|ci|evidence/i.test(`${gate.id ?? ''} ${gate.label ?? ''} ${gate.reason ?? ''}`))
    .map((gate) => ({
      id: gate.id,
      label: gate.label ?? null,
      status: gate.status
    }));
  return {
    schema_version: '0.1.0',
    status: 'advisory',
    emitted_because: 'accepted_decision_count_zero',
    accepted_decision_count: 0,
    readiness: {
      overall_status: gateStatus?.overall_status ?? gateDag?.overall_status ?? null,
      ready_for_pr_create: gateStatus?.ready_for_pr_create ?? null
    },
    verification_evidence: currentPassing.map((command) => ({
      kind: command.kind ?? null,
      status: command.status ?? null,
      command: command.command ?? null,
      artifact: command.artifact ?? verificationEvidence?.artifact ?? null,
      binding_status: command.binding?.status ?? null,
      supports: {
        axes: activeAxes.filter((axis) => axis.matched_current_verification).map((axis) => axis.axis),
        gates: verificationGates.map((gate) => gate.id).filter(Boolean),
        readiness: gateStatus?.overall_status ?? gateDag?.overall_status ?? null
      }
    })),
    axes: activeAxes,
    gates: verificationGates
  };
}

export function buildSessionBoundaryAdvisory({ storyId, env = process.env, git = null } = {}) {
  const sessionId = env?.VIBEPRO_SESSION_ID ?? env?.CODEX_SESSION_ID ?? env?.CLAUDE_SESSION_ID ?? null;
  return {
    schema_version: '0.1.0',
    status: sessionId ? 'observed' : 'not_observed',
    mode: 'advisory',
    blocking: false,
    story_id: storyId,
    session_id: sessionId,
    branch: git?.current_branch ?? null,
    head_sha: git?.head_sha ?? null,
    note: sessionId
      ? 'PR prepare captured the current runtime session id as advisory boundary context; mixed sessions are detected by `vibepro audit session-cost` and do not block PR preparation.'
      : 'No runtime session id was present; run `vibepro audit session-cost --infer-session --story-id <id>` for detailed attribution if boundary evidence is needed.'
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

function isVibeProInternalPath(filePath) {
  return filePath === '.vibepro'
    || filePath.startsWith('.vibepro/')
    || filePath === '.worktrees/vibepro'
    || filePath.startsWith('.worktrees/vibepro/');
}

function groupChangedFiles(files) {
  const groups = {
    story_docs: [],
    architecture_docs: [],
    specifications: [],
    policy_docs: [],
    responsibility_authority_metadata: [],
    contract_metadata: [],
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
    else if (isResponsibilityAuthorityMetadataPath(target)) groups.responsibility_authority_metadata.push(file);
    else if (isContractMetadataPath(target)) groups.contract_metadata.push(file);
    else if (target.startsWith('test/') || target.startsWith('tests/') || target.startsWith('Tests/') || target.startsWith('e2e/') || target.includes('/__tests__/') || /\.(test|spec)\.[jt]sx?$/.test(target) || /(Tests?|Spec)\.swift$/.test(target)) groups.tests.push(file);
    else if (isSourcePath(target)) groups.source.push(file);
    else if (target === '.vibepro/config.json') groups.repo_control.push(file);
    else if (target.startsWith('.vibepro/')) groups.vibepro_artifacts.push(file);
    else if (isRepoControlPath(target)) groups.repo_control.push(file);
    else groups.other.push(file);
  }

  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, {
      count: value.length,
      files: value.map((file) => file.path),
      items: value.map((file) => ({
        status: file.status,
        path: file.path,
        content: typeof file.content === 'string' ? file.content : undefined
      }))
    }])
  );
}

function sanitizeChangedFileItemForOutput(item) {
  if (!item || typeof item !== 'object') return item;
  const { content, ...safeItem } = item;
  return safeItem;
}

function sanitizeGitStateForOutput(gitState) {
  if (!gitState || typeof gitState !== 'object') return gitState;
  return {
    ...gitState,
    committed_changed_files: Array.isArray(gitState.committed_changed_files)
      ? gitState.committed_changed_files.map(sanitizeChangedFileItemForOutput)
      : gitState.committed_changed_files,
    changed_files: Array.isArray(gitState.changed_files)
      ? gitState.changed_files.map(sanitizeChangedFileItemForOutput)
      : gitState.changed_files,
    dirty_files: Array.isArray(gitState.dirty_files)
      ? gitState.dirty_files.map(sanitizeChangedFileItemForOutput)
      : gitState.dirty_files,
    raw_dirty_files: Array.isArray(gitState.raw_dirty_files)
      ? gitState.raw_dirty_files.map(sanitizeChangedFileItemForOutput)
      : gitState.raw_dirty_files,
    vibepro_internal_dirty_files: Array.isArray(gitState.vibepro_internal_dirty_files)
      ? gitState.vibepro_internal_dirty_files.map(sanitizeChangedFileItemForOutput)
      : gitState.vibepro_internal_dirty_files
  };
}

function sanitizeFileGroupsForOutput(fileGroups) {
  if (!fileGroups || typeof fileGroups !== 'object') return fileGroups;
  return Object.fromEntries(Object.entries(fileGroups).map(([key, group]) => [key, {
    ...group,
    items: Array.isArray(group?.items)
      ? group.items.map(sanitizeChangedFileItemForOutput)
      : group?.items
  }]));
}

function isSourcePath(filePath) {
  return isRootSourcePath(stripMonorepoPackagePrefix(filePath));
}

function stripMonorepoPackagePrefix(filePath) {
  if (typeof filePath !== 'string') return '';
  return filePath.replace(/^(?:apps|packages|services)\/[^/]+\//, '');
}

function isRootSourcePath(filePath) {
  return filePath.startsWith('src/')
    || filePath.startsWith('app/')
    || filePath.startsWith('pages/')
    || filePath.startsWith('components/')
    || filePath.startsWith('public/modules/')
    || filePath.startsWith('server/')
    || filePath.startsWith('lib/')
    || filePath.startsWith('api/')
    || filePath.startsWith('mcp/')
    || filePath.startsWith('scripts/')
    || filePath.startsWith('Sources/');
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

function isResponsibilityAuthorityMetadataPath(filePath) {
  return filePath === 'responsibility-authority.json'
    || filePath.startsWith('responsibility-authority/')
    || filePath.startsWith('docs/responsibility-authority/')
    || filePath.startsWith('docs/management/responsibility-authority/')
    || filePath.startsWith('docs/contracts/responsibility-authority/');
}

function isContractMetadataPath(filePath) {
  return filePath === 'contracts.json'
    || filePath.startsWith('contracts/')
    || filePath.startsWith('docs/contracts/')
    || filePath.startsWith('docs/domain-contracts/')
    || filePath.startsWith('docs/management/contracts/');
}

function assessScope({ changedFiles, fileGroups, dirtyFiles, dirtyFilesAffectScope = true, commits, storyId = null, maxReviewableFiles }) {
  const reasons = [];
  const signals = [];
  if (changedFiles.length > maxReviewableFiles) {
    reasons.push(`差分が ${changedFiles.length} files あり、レビュー可能な目安 ${maxReviewableFiles} files を超えている`);
    signals.push({ id: 'reviewable_file_limit_exceeded', unsafe_for_atomic_override: false });
  }
  if (hasMixedRepoControlChanges(fileGroups)) {
    reasons.push('repo制御ファイルやagent設定が差分に含まれている');
    const repoControlFiles = fileGroups.repo_control.files ?? [];
    const hasIndependentRepoControlSurface = repoControlFiles.some((file) => file !== '.vibepro/config.json');
    signals.push({
      id: 'mixed_repo_control_surface',
      unsafe_for_atomic_override: hasIndependentRepoControlSurface,
      repo_control_files: repoControlFiles,
      reason: hasIndependentRepoControlSurface
        ? 'repository execution or agent-control changes remain independently releasable and cannot be absorbed by an atomic Story declaration'
        : '.vibepro/config.json is the Story registration/control-plane half of the same declared release contract and may proceed only through typed atomic review'
    });
  }
  const nonWorkspaceDirty = dirtyFiles.filter((file) => !file.path.startsWith('.vibepro/'));
  if (dirtyFilesAffectScope && nonWorkspaceDirty.length > 0) {
    reasons.push(`未コミット差分が ${nonWorkspaceDirty.length} files 残っている`);
    signals.push({ id: 'dirty_review_surface', unsafe_for_atomic_override: true });
  }
  if (commits.length > 1) {
    const currentStoryId = String(storyId ?? '').trim().toLowerCase();
    const referencedWorkItems = [...new Set(commits.flatMap((commit) => extractCommitWorkItemRefs(commit.message)))];
    const acceptedVersionedLineage = currentStoryId
      ? commits.flatMap((commit) => extractCommitWorkItemRefs(commit.message)
        .filter((reference) => reference !== currentStoryId && isCurrentStoryLineage(reference, currentStoryId, commit))
        .map((reference) => ({
          reference,
          commit_sha: commit.sha,
          parent_count: commit.parent_shas.length,
          source_ref: commit.merge_source_ref,
          target_ref: commit.merge_target_ref,
          remote_tracking_sha: commit.remote_tracking_sha,
          basis: 'merge_topology_canonical_ref_and_title'
        })))
      : [];
    const foreignWorkItems = currentStoryId
      ? [...new Set(commits.flatMap((commit) => extractCommitWorkItemRefs(commit.message)
        .filter((reference) => !isCurrentStoryLineage(reference, currentStoryId, commit))))]
      : referencedWorkItems;
    if (foreignWorkItems.length > 0) {
      reasons.push(`baseからのcommitが ${commits.length} 件あり、別work item ${foreignWorkItems.join(', ')} のlineageが含まれている`);
      signals.push({
        id: 'multiple_commits_foreign_story_lineage',
        unsafe_for_atomic_override: true,
        referenced_work_items: referencedWorkItems,
        foreign_work_items: foreignWorkItems
      });
    } else {
      const acceptedLineageNote = acceptedVersionedLineage.length > 0
        ? `（current Storyのversioned mergeとして ${acceptedVersionedLineage.map((item) => `${item.reference}@${item.commit_sha.slice(0, 12)} parents=${item.parent_count}`).join(', ')} を受理）`
        : '';
      reasons.push(`baseからのcommitが ${commits.length} 件あるため履歴確認が必要だが、別Story lineageは検出されていない${acceptedLineageNote}`);
      signals.push({
        id: 'multiple_commits_scope_contamination_risk',
        unsafe_for_atomic_override: false,
        referenced_work_items: referencedWorkItems,
        foreign_work_items: [],
        ...(acceptedVersionedLineage.length > 0 ? { accepted_current_story_lineage: acceptedVersionedLineage } : {})
      });
    }
  }
  const emptyMessageCommits = commits.filter((commit) => commit.message_empty);
  if (emptyMessageCommits.length > 0) {
    reasons.push(`commit messageが空のcommitが ${emptyMessageCommits.length} 件あり、PR履歴として意味を確認できない`);
    signals.push({ id: 'empty_commit_message', unsafe_for_atomic_override: true });
  }

  const needsCleanBranch = reasons.length > 0;
  return {
    status: needsCleanBranch ? 'needs_clean_branch' : 'reviewable',
    recommended_strategy: needsCleanBranch ? 'clean_branch_or_split_pr' : 'current_branch_pr',
    reasons,
    signals,
    reviewable_file_limit: maxReviewableFiles,
    changed_file_count: changedFiles.length
  };
}

function isCurrentStoryLineage(reference, currentStoryId, commit) {
  if (reference === currentStoryId) return true;
  if (!new RegExp(`^${escapeRegExp(currentStoryId)}-v\\d+$`).test(reference)) return false;
  if ((commit?.parent_shas?.length ?? 0) < 2) return false;
  const expectedSource = `origin/codex/${reference}`;
  const expectedTarget = `codex/${reference}`;
  if (commit?.merge_source_ref !== expectedSource || commit?.merge_target_ref !== expectedTarget) return false;
  return Boolean(commit?.remote_tracking_sha && commit.parent_shas.includes(commit.remote_tracking_sha));
}

function extractCommitWorkItemRefs(message) {
  const text = String(message ?? '').toLowerCase();
  return [...new Set([
    ...(text.match(/\bstory-[a-z0-9][a-z0-9-]*/g) ?? []),
    ...(text.match(/\b(?:str|bfd|bug|inc)-\d+\b/g) ?? [])
  ])];
}

function hasMixedRepoControlChanges(fileGroups) {
  if (fileGroups.repo_control.count === 0) return false;
  const nonRepoGroups = [
    fileGroups.story_docs,
    fileGroups.architecture_docs,
    fileGroups.specifications,
    fileGroups.policy_docs,
    fileGroups.responsibility_authority_metadata,
    fileGroups.contract_metadata,
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
  const renderSlotText = (slot) => linkifyRepoPathsInText(`${slot.text ?? ''}`.trim());
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
    sections.push(`## なぜこの PR か (${summary.id} by ${callerLabel})\n${renderSlotText(summary)}`);
  }
  const focus = grouped.get('review_focus') ?? [];
  if (focus.length > 0) {
    const lines = focus.map((slot) => `- (${slot.id}) ${renderSlotText(slot)}`).join('\n');
    sections.push(`## レビュー焦点 (synthesis)\n${lines}`);
  }
  const risks = grouped.get('risks_synthesis')?.[0];
  if (risks) {
    sections.push(`## リスク合成 (${risks.id})\n${renderSlotText(risks)}`);
  }
  const openQuestions = grouped.get('open_questions') ?? [];
  if (openQuestions.length > 0) {
    const lines = openQuestions.map((slot) => `- (${slot.id}) ${renderSlotText(slot)}`).join('\n');
    sections.push(`## レビュアー判断要\n${lines}`);
  }
  if (sections.length === 0) return '';
  return `${sections.join('\n\n')}\n\n`;
}

function escapeMarkdownLinkLabel(value) {
  return `${value}`.replace(/([\\[\]])/g, '\\$1');
}

function encodeMarkdownRelativePath(value) {
  return `${value}`
    .split('/')
    .map((part) => encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29'))
    .join('/');
}

function formatRepoPathLink(filePath) {
  if (typeof filePath !== 'string') return filePath;
  const trimmed = filePath.trim();
  if (!trimmed || trimmed.includes('\n') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return filePath;
  const trailingSlash = trimmed.endsWith('/');
  const normalized = trailingSlash ? trimmed.slice(0, -1) : trimmed;
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return filePath;
  if (!/^(?:\.vibepro|docs|src|test|tests|e2e|bin|skills|agent-instructions|README(?:\.ja)?\.md|package(?:-lock)?\.json|design-ssot\.json)(?:\/|$)/.test(normalized)) {
    return filePath;
  }
  const displayPath = `${normalized}${trailingSlash ? '/' : ''}`;
  const href = `${encodeMarkdownRelativePath(normalized)}${trailingSlash ? '/' : ''}`;
  return `[${escapeMarkdownLinkLabel(displayPath)}](${href})`;
}

function formatRepoPathList(paths) {
  return paths.map((filePath) => formatRepoPathLink(filePath)).join(', ');
}

function countCharacter(value, character) {
  return [...`${value}`].filter((item) => item === character).length;
}

function splitRepoPathTrailingPunctuation(value) {
  let core = `${value}`;
  let suffix = '';
  while (/[.;:!?！？。、，]/.test(core.at(-1) ?? '')) {
    suffix = `${core.at(-1)}${suffix}`;
    core = core.slice(0, -1);
  }
  while (core.endsWith(')') && countCharacter(core, ')') > countCharacter(core, '(')) {
    suffix = `)${suffix}`;
    core = core.slice(0, -1);
  }
  return { core, suffix };
}

function linkifyRepoPathsInPlainText(value) {
  return `${value}`.replace(
    /(^|[\s（(「『:：])((?:\.vibepro|docs|src|test|tests|e2e|bin|skills|agent-instructions)\/[^\s,，、）]+|README(?:\.ja)?\.md|package(?:-lock)?\.json|design-ssot\.json)(?=$|[\s,，、）])/g,
    (match, prefix, filePath) => {
      const { core, suffix } = splitRepoPathTrailingPunctuation(filePath);
      return `${prefix}${formatRepoPathLink(core)}${suffix}`;
    }
  );
}

function linkifyRepoPathsInText(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .split(/(`[^`]*`|\[[^\]\n]+\]\([^) \n]+\))/g)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`')) return part;
      if (/^\[[^\]\n]+\]\([^) \n]+\)$/.test(part)) return part;
      return linkifyRepoPathsInPlainText(part);
    })
    .join('');
}

function renderPrBody({ story, taskContext, git, fileGroups, latestStoryRun, scope, prContext, splitPlan, narrative = null, artifactBudget = null, language = 'ja' }) {
  const narrativeSection = renderPrNarrative(narrative);
  const managedWorktreeStatus = formatManagedWorktreePrStatus(prContext.managed_worktree_gate);
  const source = prContext.story_source;
  const storyLabel = formatPrStoryLabel(story, source);
  const requirementTitle = source.requirement_title ?? source.title ?? story.title ?? story.story_id;
  const verification = prContext.verification_commands.length === 0
    ? '- [ ] 手動確認または対象テストを追記する'
    : renderConciseVerificationChecklist(prContext.verification_commands, prContext.gate_dag, prContext.verification_evidence);
  const reviewPoints = limitItems(prContext.review_points, 3).map((item) => `- ${linkifyRepoPathsInText(item)}`).join('\n');
  const risks = prContext.risks.length === 0
    ? null
    : limitRisksForPrBody(prContext.risks, 3).map((item) => `- Risk: ${linkifyRepoPathsInText(item)}`).join('\n');
  const unresolved = collectUnresolvedRequiredGates(prContext.gate_dag);
  const warnings = collectReleaseDecisionWarningGates(prContext.gate_dag);
  const gateNote = buildHumanGateNote(unresolved, warnings);
  const scopeNote = buildScopeDecisionNote(scope, splitPlan);
  const acceptedLineage = collectAcceptedCurrentStoryLineage(scope);
  const splitDigest = buildHumanSplitDigest(splitPlan);
  const primaryReviewAreas = buildPrimaryReviewAreas(fileGroups);
  const evidenceDir = `.vibepro/pr/${story.story_id}`;
  const gateStatus = prContext.gate_dag?.overall_status ?? '-';
  const executionStatus = prContext.execution_gate?.status ?? '-';
  const sourceFiles = limitItems(fileGroups?.source?.files ?? [], 3);
  const testFiles = limitItems(fileGroups?.tests?.files ?? [], 3);
  const docFiles = limitItems([
    ...(fileGroups?.story_docs?.files ?? []),
    ...(fileGroups?.architecture_docs?.files ?? []),
    ...(fileGroups?.specifications?.files ?? [])
  ], 3);
  const taskLine = taskContext
    ? `- Task: ${taskContext.task.id} ${taskContext.task.title ?? ''}`.trim()
    : null;
  const sourceLine = sourceFiles.length ? `- 実装: ${formatRepoPathList(sourceFiles)}` : null;
  const testLine = testFiles.length ? `- テスト: ${formatRepoPathList(testFiles)}` : null;
  const docLine = docFiles.length ? `- 設計/Story: ${formatRepoPathList(docFiles)}` : null;
  const requirementLines = [
    `- 要求: ${requirementTitle}`,
    source.requirement_id ? `- 要求ID: ${source.requirement_id}` : null,
    source.requirement_url ? `- 要求URL: ${source.requirement_url}` : null,
    taskLine
  ].filter(Boolean).join('\n');
  const reviewFocus = reviewPoints || '- Story / Spec / Architecture と実装差分が対応しているか';
  const riskLines = risks ? `\n${risks}` : '';
  const storyInterpretation = buildPrBodyStoryInterpretation({ requirementTitle, fileGroups });
  const origin = linkifyRepoPathsInText(source.background ?? 'Story文書から経緯を抽出できませんでした。');
  const rootCause = linkifyRepoPathsInText(source.root_cause
    ?? source.problem
    ?? summarizeFirstAvailable(prContext.risks, 'Story文書から根本原因を抽出できませんでした。'));
  const solution = linkifyRepoPathsInText(source.solution
    ?? source.policy
    ?? summarizeFirstAvailable(prContext.change_summary, '差分要約から解決方針を抽出できませんでした。'));
  const finalE2e = renderFinalE2eConfidence(prContext.gate_dag, prContext.verification_evidence);
  const releaseSummary = solution || 'なし';
  const compatibility = source.compatibility ?? source.compatibility_impact ?? 'なし';
  const userAction = source.user_action ?? source.migration ?? 'なし';
  const decisionIndexHandoff = resolveHandoffArtifact(artifactBudget, 'decision-index.json', evidenceDir);
  const decisionIndexLine = decisionIndexHandoff.is_summary
    ? `- 判断索引: ${formatRepoPathLink(decisionIndexHandoff.path)}（bounded summary / 全文: ${formatRepoPathLink(decisionIndexHandoff.full_path)}）`
    : `- 判断索引: ${formatRepoPathLink(decisionIndexHandoff.full_path)}`;
  const details = [
    `- 証跡: ${formatRepoPathLink(`${evidenceDir}/`)}`,
    `- PR準備: ${formatRepoPathLink(`${evidenceDir}/pr-prepare.json`)}`,
    decisionIndexLine,
    `- Gate: ${gateStatus}`,
    `- 実行状態: ${executionStatus}`,
    `- Scope: ${scope.status} / ${scope.recommended_strategy}`,
    `- Runtime: ${renderRuntimeSummary(prContext, story)}`
  ].join('\n');

  return `## 判断
- このPRで判断すること: ${storyInterpretation}
- Story: ${storyLabel}
- 正本: ${source.path ? formatRepoPathLink(source.path) : 'Story未検出'}
- 変更範囲: ${git.changed_files.length} files / ${primaryReviewAreas}
${[docLine, sourceLine, testLine].filter(Boolean).join('\n')}

## 経緯
${requirementLines}
- 発生経緯: ${origin}
${narrativeSection ? `${narrativeSection.trim()}\n` : ''}

## 原因
- ${rootCause}

## 解決
- ${solution}

## Release Notes

### Change Summary
${releaseSummary}

### Compatibility
${compatibility}

### User Action
${userAction}

## レビュー観点
- Gate: ${gateNote}
- Scope: ${scopeNote}
- Scope lineage evidence: ${acceptedLineage.length > 0 ? `\`${JSON.stringify(acceptedLineage)}\`` : '-'}
- 分割判断: ${splitDigest}
- 管理worktree: ${managedWorktreeStatus}
${reviewFocus}${riskLines}

## 確認
${verification}
- 最終E2E: ${finalE2e}

## 詳細
${details}
`;
}

function buildPrBodyStoryInterpretation({ requirementTitle, fileGroups }) {
  const areas = buildPrimaryReviewAreas(fileGroups);
  return `${requirementTitle} を満たすための ${areas} 変更として、このPRを受け入れてよいか。`;
}

function summarizeFirstAvailable(items = [], fallback) {
  const value = (Array.isArray(items) ? items : []).find((item) => typeof item === 'string' && item.trim());
  return value?.trim() ?? fallback;
}

function renderFinalE2eConfidence(gateDag, verificationEvidence) {
  const e2eGate = (gateDag?.nodes ?? []).find((gate) => gate.id === 'gate:e2e')
    ?? (gateDag?.nodes ?? []).find((gate) => /e2e/i.test(`${gate.label ?? ''} ${gate.type ?? ''}`));
  const e2eEvidence = selectFinalE2eEvidence(verificationEvidence?.commands);
  const status = e2eEvidence?.status ?? e2eGate?.status ?? '未確認';
  const summary = e2eEvidence?.summary ?? e2eGate?.reason ?? e2eGate?.label ?? '最終E2E証跡が見つかりません。';
  const artifact = e2eEvidence?.artifact ?? e2eGate?.evidence?.artifact ?? null;
  return linkifyRepoPathsInText(`${status}: ${summary}${artifact ? `（${artifact}）` : ''}`);
}

function selectFinalE2eEvidence(commands = []) {
  const items = Array.isArray(commands) ? commands : [];
  return items
    .map((item, index) => ({ item, index, score: scoreFinalE2eEvidence(item) }))
    .filter((entry) => entry.score)
    .sort((a, b) => compareFinalE2eEvidenceScore(a, b))[0]?.item;
}

function scoreFinalE2eEvidence(item) {
  const surfaceRank = getFinalE2eSurfaceRank(item);
  if (surfaceRank === null) return null;
  return {
    bindingRank: getFinalE2eBindingRank(item),
    statusRank: isPassingVerificationStatus(item?.status) ? 0 : 1,
    surfaceRank
  };
}

function compareFinalE2eEvidenceScore(a, b) {
  return a.score.bindingRank - b.score.bindingRank
    || a.score.statusRank - b.score.statusRank
    || a.score.surfaceRank - b.score.surfaceRank
    || a.index - b.index;
}

function getFinalE2eSurfaceRank(item) {
  const kind = normalizeEvidenceKind(item?.kind);
  if (kind === 'e2e') return 0;
  if (kind === 'flow') return 1;
  if (hasExplicitE2eEvidenceSurface(item)) return 2;
  return null;
}

function getFinalE2eBindingRank(item) {
  const status = String(item?.binding?.status ?? '').trim().toLowerCase();
  if (status === 'current') return 0;
  if (status === 'stale') return 2;
  return 1;
}

function normalizeEvidenceKind(kind) {
  return String(kind ?? '').trim().toLowerCase().replace(/[_-]+/g, '');
}

function hasExplicitE2eEvidenceSurface(item) {
  const searchable = [
    item?.kind,
    item?.type,
    item?.command,
    item?.artifact
  ].map((value) => String(value ?? '')).join(' ');
  return /\b(e2e|test:e2e|playwright)\b/i.test(searchable)
    || /(^|\/)test\/e2e(\/|$)/i.test(searchable)
    || /flow-verification/i.test(searchable);
}

function limitItems(items = [], max = 3) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (values.length <= max) return values;
  return [...values.slice(0, max), `...and ${values.length - max} more`];
}

function limitRisksForPrBody(items = [], max = 3) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  const priority = values.filter((item) => /Requirement Gate|contradicted|failed|block/i.test(item));
  const rest = values.filter((item) => !priority.includes(item));
  return limitItems([...priority, ...rest], max);
}

function renderConciseVerificationChecklist(commands, gateDag, verificationEvidence) {
  return renderVerificationChecklist(commands, gateDag, verificationEvidence)
    .split('\n')
    .filter((line) => line.trim().startsWith('- [x]'))
    .slice(0, 4)
    .join('\n') || '- [ ] 手動確認または対象テストを追記する';
}

function renderPrDecisionSection({ story, git, fileGroups, scope, prContext, splitPlan }) {
  const executionGate = prContext.execution_gate;
  const unresolved = collectUnresolvedRequiredGates(prContext.gate_dag);
  const warnings = collectReleaseDecisionWarningGates(prContext.gate_dag);
  const decision = buildHumanMergeDecision({ executionGate, unresolved, scope });
  const primaryReviewAreas = buildPrimaryReviewAreas(fileGroups);
  const storyLabel = formatPrStoryLabel(story, prContext.story_source);
  const reviewQuestion = buildHumanReviewQuestion({ source: prContext.story_source, fileGroups });
  const decisionGraph = renderHumanDecisionGraph({
    source: prContext.story_source,
    fileGroups,
    gateDag: prContext.gate_dag,
    splitPlan,
    git
  });
  const engineeringReasoning = renderEngineeringJudgmentReasoning({
    source: prContext.story_source,
    fileGroups,
    gateDag: prContext.gate_dag,
    prContext,
    git
  });
  const gateNote = buildHumanGateNote(unresolved, warnings);
  const scopeNote = buildScopeDecisionNote(scope, splitPlan);
  const managedWorktreeStatus = formatManagedWorktreePrStatus(prContext.managed_worktree_gate);
  return `## このPRで決めたいこと
- このPRで閉じる問い: ${reviewQuestion}
- Story: ${storyLabel}
- Engineering Judgment: ${formatEngineeringJudgmentForHuman(prContext.engineering_judgment)}
- PR Route: ${formatPrRouteForHuman(prContext.pr_route)}
- 判断: ${decision}
- レビュー入口: ${primaryReviewAreas}
- Gate状況: ${gateNote}
- 管理worktree: ${managedWorktreeStatus}
- Scope判断: ${scopeNote}
- 変更規模: ${git.changed_files.length} files

${engineeringReasoning}

### 判断グラフ
${decisionGraph}`;
}

function buildTraceabilityEvidence({ root, bodyPath, gateDagJsonPath, verificationEvidence, currentHeadSha = null }) {
  const verificationEvidencePath = path.join(path.dirname(bodyPath), 'verification-evidence.json');
  const evidence = [
    {
      type: 'pr_artifact',
      ref: toWorkspaceRelative(root, bodyPath),
      summary: 'pr prepare artifact: pr-body.md'
    }
  ];
  if (gateDagJsonPath) {
    evidence.push({
      type: 'pr_artifact',
      ref: toWorkspaceRelative(root, gateDagJsonPath),
      summary: 'pr prepare artifact: gate-dag.json'
    });
  }
  if ((verificationEvidence?.commands ?? []).length > 0) {
    evidence.push({
      type: 'pr_artifact',
      ref: toWorkspaceRelative(root, verificationEvidencePath),
      summary: 'recorded verification evidence'
    });
  }
  for (const command of verificationEvidence?.commands ?? []) {
    const commandHeadSha = command.git_context?.head_sha ?? command.binding?.current_head_sha ?? null;
    const bindingStatus = resolveTraceabilityEvidenceBindingStatus(command, currentHeadSha);
    evidence.push({
      type: 'verification_evidence',
      ref: command.artifact ?? command.command ?? toWorkspaceRelative(root, verificationEvidencePath),
      summary: [
        command.summary,
        command.command,
        ...(command.observation?.scenarios ?? []),
        ...Object.entries(command.observation?.values ?? {}).map(([key, value]) => `${key}=${value}`)
      ].filter(Boolean).join(' | '),
      strength: isPassingVerificationStatus(command.status) ? 'supporting' : 'weak',
      binding_status: bindingStatus,
      current_head_sha: commandHeadSha,
      artifact_quality: command.artifact_check?.status ?? null,
      targets: [
        ...(command.observation?.targets ?? []),
        ...(command.observation?.scenarios ?? [])
      ].filter(Boolean)
    });
  }
  return evidence;
}

function resolveTraceabilityEvidenceBindingStatus(command, currentHeadSha) {
  const commandHeadSha = command.git_context?.head_sha ?? command.binding?.current_head_sha ?? null;
  if (commandHeadSha && currentHeadSha && commandHeadSha !== currentHeadSha) return 'stale';
  if (command.git_context?.dirty === false && commandHeadSha) return 'current';
  return command.binding?.status ?? null;
}

function buildTraceabilityClauseCoverageGate(summary) {
  const weakCount = summary?.weakly_mapped_count ?? 0;
  const unmappedCount = summary?.unmapped_count ?? 0;
  const status = weakCount === 0 && unmappedCount === 0 ? 'passed' : 'needs_evidence';
  return {
    id: 'gate:traceability_clause_coverage',
    type: 'traceability_clause_coverage_gate',
    label: 'Traceability Clause Coverage Gate',
    status,
    required: true,
    reason: status === 'passed'
      ? 'Every extracted AC/scenario clause has clause-specific test, review, or verification evidence'
      : `${weakCount} weakly_mapped and ${unmappedCount} unmapped AC/scenario clause(s) require clause-specific evidence`,
    coverage_summary: summary ?? null,
    required_actions: status === 'passed' ? [] : [
      'Record verification evidence with --target/--scenario/--observed that names the specific AC or scenario, or add a focused test/review finding that binds to the clause.'
    ]
  };
}

function renderPrTraceabilityClauseCoverage(summary, language = 'ja') {
  if (!summary) return '- traceability clause coverage: unavailable';
  const examples = (summary.examples ?? []).length
    ? summary.examples.map((item) => (
      `- ${item.id}: ${item.status}${item.weak_mapping_reason ? ` (${item.weak_mapping_reason})` : ''}`
    )).join('\n')
    : '- none';
  return localizedText(language, {
    ja: [
      `- clause_count: ${summary.clause_count}`,
      `- mapped: ${summary.mapped_count}`,
      `- weakly_mapped: ${summary.weakly_mapped_count}`,
      `- unmapped: ${summary.unmapped_count}`,
      '',
      '### Weak/Unmapped Examples',
      examples
    ].join('\n'),
    en: [
      `- clause_count: ${summary.clause_count}`,
      `- mapped: ${summary.mapped_count}`,
      `- weakly_mapped: ${summary.weakly_mapped_count}`,
      `- unmapped: ${summary.unmapped_count}`,
      '',
      '### Weak/Unmapped Examples',
      examples
    ].join('\n')
  });
}

function isPassingVerificationStatus(status) {
  return ['pass', 'passed', 'success', 'ok'].includes(String(status ?? '').toLowerCase());
}

function buildHumanReviewQuestion({ source = {}, fileGroups }) {
  const title = source.requirement_title ?? source.title ?? source.story_id ?? 'このStory';
  const areas = buildPrimaryReviewAreas(fileGroups);
  return `${title} を満たす変更として、${areas} の差分をこのPRで受け入れてよいか。`;
}

function formatPrRouteForHuman(prRoute) {
  if (!prRoute) return '未分類';
  const confidence = typeof prRoute.confidence === 'number'
    ? `${Math.round(prRoute.confidence * 100)}%`
    : '-';
  const sections = buildRouteBodyRequiredSections(prRoute.route_type).join(', ');
  return `${prRoute.route_type} / body=${prRoute.body_template} / confidence=${confidence} / required=${sections}`;
}

function formatEngineeringJudgmentForHuman(engineeringJudgment) {
  if (!engineeringJudgment) return '未分類';
  const confidence = typeof engineeringJudgment.confidence === 'number'
    ? `${Math.round(engineeringJudgment.confidence * 100)}%`
    : '-';
  const activeAxes = (engineeringJudgment.judgment_axes ?? [])
    .filter((axis) => axis.status !== 'inactive')
    .map((axis) => axis.axis);
  const suppressedAxes = collectSuppressedJudgmentAxes(engineeringJudgment);
  const axisText = activeAxes.length > 0 ? ` / axes=${activeAxes.join(',')}` : '';
  const suppressedText = suppressedAxes.length > 0
    ? ` / suppressed=${suppressedAxes.map((axis) => `${axis.axis}[${axis.precision_status}]`).join(',')}`
    : '';
  return `${engineeringJudgment.route_type} / dag=${engineeringJudgment.route_dag} / confidence=${confidence}${axisText}${suppressedText}`;
}

function renderEngineeringJudgmentReasoning({ source = {}, fileGroups, gateDag, prContext = {}, git = {} }) {
  const judgment = prContext.engineering_judgment;
  if (!judgment) {
    return `### Engineering Judgment の判断過程
- 状態: Engineering Judgmentを分類できませんでした。Story、差分、Gate DAGを確認してください。`;
  }
  const title = source.requirement_title ?? source.title ?? source.story_id ?? 'Story';
  const sourcePath = source.path ?? 'Story未検出';
  const prRoute = prContext.pr_route;
  const routeGates = collectEngineeringJudgmentRouteGates(gateDag, judgment.route_type);
  const routeGateSummary = routeGates.length > 0
    ? routeGates.slice(0, 5).map(formatEngineeringJudgmentGateForHuman).join('\n')
    : '- route-specific judgment gateはありません。';
  const extraRouteGateCount = Math.max(0, routeGates.length - 5);
  const routeGateTail = extraRouteGateCount > 0 ? `\n- ほか${extraRouteGateCount}件はGate DAG監査ログを参照。` : '';
  const commonSpine = buildCommonSpineReasoning(gateDag);
  const axisReasoning = buildJudgmentAxisReasoning(judgment);
  const signals = buildEngineeringSignalDigest(judgment.signals);
  const evidence = buildEngineeringEvidenceReasoningDigest(gateDag);
  const mergeBoundary = buildEngineeringMergeBoundary(gateDag);

  return `### Engineering Judgment の判断過程
このPRは、単なる差分量ではなく「何を壊してはいけない変更か」で読みます。入力と差分シグナルから \`${judgment.route_type}\` として読み、Senior first scanで必要な判断axisを複数active化しました。

#### 判断した入力
- 目的: ${title}
- 正本: ${formatGithubFileLink(sourcePath, git)}
- 差分面: ${buildHumanChangeIntent(fileGroups)}
- PR Route: ${formatPrRouteForHuman(prRoute)}

#### 判断シグナル
${signals}

#### 共通spineの確認
${commonSpine}

#### Senior first scan axes
${axisReasoning}

#### 選んだDAGが要求した確認
${routeGateSummary}${routeGateTail}

#### 証跡とマージ境界
- 要求証跡: ${evidence}
- 判断境界: ${mergeBoundary}`;
}

function collectEngineeringJudgmentRouteGates(gateDag, routeType) {
  const nodes = gateDag?.nodes ?? [];
  return nodes.filter((node) => node.id?.startsWith('gate:judgment_')
    && (!routeType || node.route_type === routeType));
}

function buildJudgmentAxisReasoning(engineeringJudgment) {
  const axes = engineeringJudgment?.judgment_axes ?? [];
  const activeAxes = axes.filter((axis) => axis.status !== 'inactive');
  const suppressedAxes = collectSuppressedJudgmentAxes(engineeringJudgment);
  if (activeAxes.length === 0 && suppressedAxes.length === 0) {
    return '- active axisなし。general engineeringとして既存Gateを確認します。';
  }
  const activeLines = activeAxes
    .map((axis) => {
      const required = axis.required_evidence?.join('|') ?? '-';
      const candidates = axis.activation_candidates?.length > 0
        ? ` / candidates=${axis.activation_candidates.join(', ')}`
        : '';
      const activationSignals = axis.activation_signals?.length > 0
        ? ` / active_signals=${axis.activation_signals.join(', ')}`
        : '';
      const precision = axis.activation_precision?.status
        ? ` / precision=${axis.activation_precision.status}:${axis.activation_precision.reason ?? ''}`
        : '';
      const missing = axis.missing_evidence?.length > 0 ? ` / missing=${axis.missing_evidence.join('|')}` : '';
      const matched = axis.matched_evidence?.length > 0
        ? ` / matched=${axis.matched_evidence.length}${formatEvidenceArtifactSuffix(axis.matched_evidence)}`
        : '';
      const optional = axis.optional_evidence?.length > 0
        ? ` / optional=${axis.optional_evidence.length}${formatEvidenceArtifactSuffix(axis.optional_evidence)}`
        : '';
      const blockers = axis.matched_blockers?.length > 0
        ? ` / blockers=${axis.matched_blockers.map((item) => `${item.id}:${item.criterion}`).join(', ')}`
        : '';
      const waiver = axis.blocker_waiver
        ? (axis.blocker_waiver.decision_id
          ? ` / blocker_waiver=${axis.blocker_waiver.decision_id}`
          : ` / ignored_blocker_waiver_missing=${summarizeBlockerWaiverMissingFields(axis.blocker_waiver).join('|') || 'required_metadata'}`)
        : '';
      return `- ${axis.axis}: ${axis.status} / confidence=${Math.round((axis.confidence ?? 0) * 100)}% / question=${axis.decision_question} / required=${required}${candidates}${activationSignals}${precision}${matched}${optional}${missing}${blockers}${waiver}`;
    })
    .join('\n');
  const suppressedLines = suppressedAxes.length > 0
    ? `\n- suppressed_candidates: ${suppressedAxes.map((axis) => `${axis.axis}[${axis.precision_status}]:${axis.reason}`).join(' ; ')}`
    : '';
  return `${activeLines}${suppressedLines}`;
}

function collectSuppressedJudgmentAxes(engineeringJudgment) {
  return (engineeringJudgment?.judgment_axes ?? [])
    .filter((axis) => axis.status === 'inactive' && (axis.activation_candidates?.length ?? 0) > 0)
    .map((axis) => ({
      axis: axis.axis,
      precision_status: axis.activation_precision?.status ?? 'inactive',
      reason: axis.activation_precision?.reason ?? 'reason missing',
      candidates: axis.activation_candidates ?? []
    }));
}

function buildCommonSpineReasoning(gateDag) {
  const spineGate = gateDag?.nodes?.find((node) => node.id === 'gate:common_judgment_spine');
  if (!spineGate || !Array.isArray(spineGate.subchecks) || spineGate.subchecks.length === 0) {
    return '- 共通spineの監査情報はありません。';
  }
  return spineGate.subchecks
    .map((check) => {
      const evidence = check.evidence ? 'recorded' : 'none';
      const reason = check.reason ?? '理由なし';
      const surface = check.surface ? ` / surface=${check.surface}` : '';
      const required = Array.isArray(check.required_evidence_kind) && check.required_evidence_kind.length > 0
        ? ` / required=${check.required_evidence_kind.join('|')}`
        : '';
      const matched = Array.isArray(check.matched_evidence) && check.matched_evidence.length > 0
        ? ` / matched=${check.matched_evidence.length}${formatEvidenceArtifactSuffix(check.matched_evidence)}`
        : '';
      const missing = Array.isArray(check.missing_evidence) && check.missing_evidence.length > 0
        ? ` / missing=${check.missing_evidence.join('|')}`
        : '';
      return `- ${check.id}: ${check.status}${surface}${required} / evidence=${evidence}${matched}${missing} / ${summarizePrGateReason(reason) ?? reason}`;
    })
    .join('\n');
}

function formatEvidenceArtifactSuffix(items = []) {
  const artifacts = [...new Set(items.map((item) => item.artifact).filter(Boolean))];
  return artifacts.length > 0 ? ` / artifacts=${artifacts.slice(0, 3).join(',')}${artifacts.length > 3 ? `(+${artifacts.length - 3})` : ''}` : '';
}

function formatEvidenceReferenceForHuman(item) {
  const base = `${item.kind}:${item.ref}`;
  const strength = item.strength ? ` / ${item.strength}` : '';
  const reason = item.strength_reason ? ` / ${item.strength_reason}` : '';
  const artifact = item.artifact ? ` / artifact=${item.artifact}` : '';
  return `${base}${strength}${reason}${artifact}`;
}

function formatEngineeringJudgmentGateForHuman(gate) {
  return `- ${gate.label ?? gate.id}: ${describeEngineeringJudgmentGate(gate)}`;
}

function describeEngineeringJudgmentGate(gate) {
  if (gate.id === 'gate:judgment_agent_workflow_evidence_lifecycle') {
    return 'agent/gate/DAG変更では、レビュー証跡が現在の差分に結びつき、missing/stale/timed-out/blockが残っていないことを確認する。';
  }
  if (gate.id === 'gate:judgment_security_trust_security_regression') {
    return 'trust boundaryに触れる変更では、権限・secret・監査の回帰をテストまたは明示waiverで閉じる。';
  }
  return gate.reason ?? 'このDAGで必要なレビュー観点を確認する。';
}

function buildEngineeringSignalDigest(signals = []) {
  if (!Array.isArray(signals) || signals.length === 0) {
    return '- 明示シグナルなし。Story、差分、PR routeからgeneral engineeringとして扱います。';
  }
  return signals.slice(0, 6).map((signal) => `- \`${signal}\`: ${describeEngineeringSignal(signal)}`).join('\n');
}

function describeEngineeringSignal(signal) {
  if (signal === 'route:release_or_mirror') return 'release/mirror経路に触れるため、成果物、CI、rollback、source traceabilityを先に見る。';
  if (signal === 'surface:agent_or_gate_workflow') return 'agent/gate/review/DAGの判断面に触れるため、tool boundaryと証跡ライフサイクルを確認する。';
  if (signal === 'surface:auth_or_security') return '認証・権限・secret・監査境界に触れるため、trust boundaryと回帰証跡を優先する。';
  if (signal === 'surface:data_or_migration') return 'データ正本、migration、retry、rollbackで破壊的影響が出る面を優先する。';
  if (signal === 'domain:business_workflow') return '顧客、契約、承認、請求などの業務状態と例外運用を壊さないかを見る。';
  if (signal === 'surface:ui_ux') return 'ユーザーが依存する導線、状態、視覚回帰、アクセシビリティを優先する。';
  if (signal === 'surface:developer_tool') return 'CLI/API契約、exit code、設定優先順位、短い検証ループを優先する。';
  if (signal === 'surface:api_contract') return 'API route/client/schema/error shapeの互換性を優先する。';
  if (signal === 'surface:repo_control') return 'CI、repo設定、実行環境のblast radiusとrollbackを優先する。';
  if (signal === 'surface:docs_only') return '読者が判断・実行できる状態と現行仕様との整合を優先する。';
  if (String(signal).startsWith('risk_profile:')) return `risk profileは ${String(signal).slice('risk_profile:'.length)}。証跡量とAgent Review要求の強さを決める入力にする。`;
  return 'Story、差分、分類器が検出した判断入力。';
}

function buildEngineeringEvidenceReasoningDigest(gateDag) {
  const nodes = gateDag?.nodes ?? [];
  const importantIds = [
    'gate:engineering_judgment_route',
    'gate:common_judgment_spine',
    'gate:managed_worktree',
    'gate:requirement',
    'gate:unit',
    'gate:integration',
    'gate:e2e',
    'gate:agent_review',
    'gate:network_contract',
    'gate:dag_connectivity'
  ];
  const evidenceNodes = importantIds
    .map((id) => nodes.find((node) => node.id === id))
    .filter(Boolean);
  const enforcedJudgmentNodes = nodes.filter((node) => node.required === true
    && node.id?.startsWith('gate:judgment_')
    && !['route_specific_judgment_gate'].includes(node.type));
  const axisNodes = nodes.filter((node) => node.type === 'judgment_axis_gate');
  const rows = [...evidenceNodes, ...enforcedJudgmentNodes]
    .concat(axisNodes)
    .filter((node, index, list) => list.findIndex((item) => item.id === node.id) === index)
    .map((node) => {
      if (node.id === 'gate:common_judgment_spine' && Array.isArray(node.subchecks)) {
        const missing = node.subchecks
          .filter((check) => isUnresolvedGateStatus(check.status))
          .map((check) => `${check.id}:${check.status}`);
        const suffix = missing.length > 0 ? ` (${missing.join(', ')})` : '';
        return `${node.label ?? node.id}=${node.status}${suffix}`;
      }
      return `${node.label ?? node.id}=${node.status}`;
    });
  return rows.length > 0 ? rows.join(' / ') : 'Gate DAG証跡なし';
}

function buildEngineeringMergeBoundary(gateDag) {
  const unresolved = collectUnresolvedRequiredGates(gateDag);
  const warnings = collectReleaseDecisionWarningGates(gateDag);
  if (unresolved.length === 0 && warnings.length === 0) {
    return '必須Gateは閉じています。レビューでは、選ばれたDAGの前提と実差分が一致しているかを最終確認します。';
  }
  if (unresolved.length === 0) {
    return `必須Gateは閉じています。ただしリリース判断Warningがあります（${formatHumanGateSummary(warnings)}）。Gate DAG / Gate Enforcementで理由と対応を確認します。`;
  }
  const warningNote = warnings.length > 0
    ? ` Warning: ${formatHumanGateSummary(warnings)}。`
    : '';
  return `未解決Gateがあります（${formatHumanGateSummary(unresolved)}）。マージ判断は、証跡追加または理由付きwaiver後に行います。${warningNote}`;
}

function renderHumanDecisionGraph({ source = {}, fileGroups, gateDag, splitPlan, git = {} }) {
  const title = source.requirement_title ?? source.title ?? source.story_id ?? 'Story';
  const sourcePath = source.path ?? 'Story未検出';
  const changeIntent = buildHumanChangeIntent(fileGroups);
  const changeLinks = buildHumanDecisionFileLinks(fileGroups, git);
  const evidence = buildHumanEvidenceDigest(gateDag);
  const split = buildHumanSplitDigest(splitPlan);
  const route = gateDag?.summary?.pr_route
    ? `${gateDag.summary.pr_route} / body=${gateDag.summary.pr_body_template ?? '-'}`
    : '未分類';
  const engineering = gateDag?.summary?.engineering_judgment_route
    ? `${gateDag.summary.engineering_judgment_route} / dag=${gateDag.summary.engineering_judgment_dag ?? '-'}`
    : '未分類';
  const suppressedAxes = Array.isArray(gateDag?.summary?.suppressed_judgment_axes)
    ? gateDag.summary.suppressed_judgment_axes
    : [];
  return [
    `- 目的: ${title}`,
    `- Engineering Judgment: ${engineering}`,
    suppressedAxes.length > 0
      ? `- Suppressed Axis Candidates: ${suppressedAxes.map((axis) => `${axis.axis}[${axis.precision_status}]`).join(', ')}`
      : null,
    `- PR Route: ${route}`,
    `- 正本: ${formatGithubFileLink(sourcePath, git)}`,
    `- 差分: ${changeIntent}${changeLinks ? `（${changeLinks}）` : ''}`,
    `- 証跡: ${evidence}`,
    `- 分割判断: ${split}`
  ].join('\n');
}

function buildHumanDecisionFileLinks(fileGroups, git) {
  const rows = [
    ['Runtime', fileGroups.source?.files ?? []],
    ['Contract Docs', collectContractDocFiles(fileGroups)],
    ['Capability Map', collectCapabilityFiles(fileGroups)],
    ['Tests', fileGroups.tests?.files ?? []],
    ['Repo Control', fileGroups.repo_control?.files ?? []]
  ];
  const links = rows
    .filter(([, files]) => files.length > 0)
    .map(([label, files]) => `${label}: ${files.slice(0, 3).map((file) => formatGithubFileLink(file, git)).join(', ')}${files.length > 3 ? ` ほか${files.length - 3}件` : ''}`);
  return links.join(' / ');
}

function formatGithubFileLink(filePath, git = {}) {
  if (!filePath || filePath === 'Story未検出') return filePath || 'unknown';
  const baseUrl = githubRepositoryUrl(git.origin_url);
  const ref = git.current_branch || git.head_sha || git.head_ref || 'HEAD';
  if (!baseUrl) return filePath;
  return `[${filePath}](${baseUrl}/blob/${ref}/${encodePathForGithub(filePath)})`;
}

function githubRepositoryUrl(originUrl) {
  if (!originUrl) return null;
  const trimmed = String(originUrl).trim().replace(/\.git$/, '');
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+)$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  return null;
}

function encodePathForGithub(filePath) {
  return String(filePath)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function buildHumanChangeIntent(fileGroups) {
  const parts = [];
  if (fileGroups.source?.count > 0) parts.push(`runtime ${fileGroups.source.count}件`);
  const contractDocs = collectContractDocFiles(fileGroups);
  if (contractDocs.length > 0) parts.push(`contract docs ${contractDocs.length}件`);
  const capabilityFiles = collectCapabilityFiles(fileGroups);
  if (capabilityFiles.length > 0) parts.push(`capability map ${capabilityFiles.length}件`);
  if (fileGroups.tests?.count > 0) parts.push(`tests ${fileGroups.tests.count}件`);
  if (fileGroups.repo_control?.count > 0) parts.push(`repo control ${fileGroups.repo_control.count}件`);
  if (parts.length === 0) return '差分なし';
  return `${parts.join(' / ')}を変更`;
}

function buildHumanEvidenceDigest(gateDag) {
  const nodes = gateDag?.nodes ?? [];
  const labels = [
    ['gate:engineering_judgment_route', 'Engineering Judgment'],
    ['gate:story_source_integrity', 'Story Source'],
    ['gate:common_judgment_spine', 'Judgment Spine'],
    ['gate:pr_route_classification', 'PR Route'],
    ['gate:pr_body_contract', 'PR Body'],
    ['gate:managed_worktree', 'Managed Worktree'],
    ['gate:mirror_source_traceability', 'Source Trace'],
    ['gate:ci_status_or_waiver', 'CI/Waiver'],
    ['gate:vibepro_artifact_policy', 'Artifact Policy'],
    ['gate:split_resolution', 'Split'],
    ['gate:requirement', 'Requirement'],
    ['gate:unit', 'Unit'],
    ['gate:integration', 'Integration'],
    ['gate:e2e', 'E2E'],
    ['gate:agent_review', 'Agent Review'],
    ['gate:network_contract', 'Network Contract'],
    ['gate:dag_connectivity', 'DAG Connectivity']
  ].map(([id, label]) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return null;
    if (['passed', 'pass'].includes(node.status)) return `${label} passed`;
    if (node.status === 'not_required') return `${label} not required`;
    return `${label} ${node.status}`;
  }).filter(Boolean);
  return labels.length > 0 ? labels.join(' / ') : 'Gate証跡なし';
}

function buildHumanSplitDigest(splitPlan) {
  if (!splitPlan) return '分割計画なし';
  const atomicScope = splitPlan.atomic_scope;
  const automatic = splitPlan.automatic_recommendation;
  const laneIds = (splitPlan.lanes ?? []).map((lane) => lane.id).filter(Boolean);
  const laneDigest = laneIds.length > 0 ? laneIds.join(', ') : 'laneなし';
  const automaticDigest = automatic
    ? `${automatic.status} / ${automatic.recommended_strategy ?? 'strategy未設定'}`
    : '未評価';
  if (atomicScope?.status === 'accepted') {
    return `atomic accepted: ${atomicScope.reason ?? 'reason未設定'} / 自動勧告: ${automaticDigest} / lanes: ${laneDigest} / 採用: ${splitPlan.recommended_strategy ?? 'strategy未設定'}`;
  }
  if (atomicScope?.status === 'rejected') {
    const rejection = (atomicScope.rejection_reasons ?? []).join('; ') || 'rejection reason未設定';
    const ownerRepair = (atomicScope.next_actions ?? [])
      .find((action) => action.type === 'record_current_head_review_owners');
    const repairDigest = ownerRepair
      ? ` / owner repair roles: ${(ownerRepair.roles_requiring_surface_coverage ?? []).join(', ') || '未特定'} / uncovered paths: ${(ownerRepair.uncovered_paths ?? []).join(', ') || 'なし'} / commands: ${(ownerRepair.prepare_commands ?? [ownerRepair.command]).filter(Boolean).join(' ; ')} / follow-up: ${ownerRepair.follow_up_command ?? ownerRepair.follow_up ?? '未設定'}`
      : '';
    return `atomic rejected: ${rejection}${repairDigest} / 自動勧告: ${automaticDigest} / lanes: ${laneDigest} / 採用: ${splitPlan.recommended_strategy ?? 'strategy未設定'}`;
  }
  if (splitPlan.status === 'split_recommended') {
    return `分割推奨 / 自動勧告: ${automaticDigest} / lanes: ${laneDigest} / 採用: ${splitPlan.recommended_strategy ?? 'strategy未設定'}`;
  }
  return `${splitPlan.status}${splitPlan.recommended_strategy ? ` / ${splitPlan.recommended_strategy}` : ''} / 自動勧告: ${automaticDigest} / lanes: ${laneDigest}`;
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
  if (scope.status === 'reviewable' && splitPlan?.status === 'split_recommended') {
    return `同一PRでレビュー可能。分割案はVibePro証跡に残す（${split}）`;
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

function buildHumanGateNote(unresolved, warnings) {
  const warningText = warnings.length > 0
    ? ` リリース判断Warning: ${formatHumanGateSummary(warnings)}。`
    : '';
  if (unresolved.length === 0) {
    return warnings.length === 0
      ? '未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。'
      : `未解決の必須Gateはありません。ただし${warningText.trim()} 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。`;
  }
  return `未解決Gateがあります（対象: ${formatHumanGateSummary(unresolved)}）。詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認し、blocking か waiver 可能かを判断してください。${warningText}`;
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
    '- Gate / Agent Review の詳細証跡はVibePro artifactとして残すが、GitHub本文のレビュー範囲を広げるものではない'
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

function renderVerificationChecklist(commands, gateDag, verificationEvidence = null) {
  const seenCommands = new Set(commands.map((item) => item.command).filter(Boolean));
  const commandItems = commands.map((item) => {
    const gate = findGateForVerificationCommand(item, gateDag);
    const passed = gate && ['passed', 'pass'].includes(gate.status);
    const recordedEvidence = findVerificationEvidenceForCommand(item, verificationEvidence);
    const recordedEvidencePassed = recordedEvidence
      && ['passed', 'pass', 'success', 'ok'].includes(recordedEvidence.status)
      && recordedEvidence.binding?.status === 'current';
    const commandMatchesEvidence = recordedEvidencePassed || !gate?.command || gate.command === item.command;
    const checked = recordedEvidencePassed || (passed && commandMatchesEvidence) ? 'x' : ' ';
    const status = gate?.status
      ? ` / gate: ${gate.status}`
      : '';
    const evidenceArtifact = recordedEvidence?.artifact
      ?? (gate?.command && gate.command === item.command ? gate.evidence?.artifact : null);
    const evidence = evidenceArtifact ? ` / evidence: ${evidenceArtifact}` : '';
    return linkifyRepoPathsInText(`- [${checked}] ${formatVerificationChecklistLabel(item, gate)} - ${item.reason}${status}${evidence}`);
  });
  const evidenceOnlyItems = (gateDag?.nodes ?? [])
    .filter((gate) => gate.type === 'verification_gate')
    .filter((gate) => gate.command && gate.evidence && !seenCommands.has(gate.command))
    .map((gate) => {
      const checked = ['passed', 'pass'].includes(gate.status) ? 'x' : ' ';
      const evidence = gate.evidence?.artifact ? ` / evidence: ${gate.evidence.artifact}` : '';
      const label = gate.label ?? gate.id;
      return linkifyRepoPathsInText(`- [${checked}] ${label} - ${summarizePrGateReason(gate.reason) ?? gate.label}${gate.status ? ` / gate: ${gate.status}` : ''}${evidence}`);
    });
  return [...commandItems, ...evidenceOnlyItems].join('\n');
}

function formatVerificationChecklistLabel(item, gate = null) {
  const kind = item.kind ?? item.type ?? 'verification';
  if (kind === 'typecheck') return 'verification:typecheck';
  if (kind === 'build') return 'verification:build';
  if (['unit', 'test', 'integration', 'e2e'].includes(kind) && gate?.label) return gate.label;
  return `verification:${kind}`;
}

function findVerificationEvidenceForCommand(command, verificationEvidence) {
  const items = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return items.find((item) => item.command === command.command) ?? null;
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
- pr_create_allowed: false
- required_action_count: 0
- required_action_detail: see review-cockpit.html and gate-dag.json`;
  }
  const requiredActionCount = executionGate.required_actions?.length ?? 0;
  return `## Execution Gate
- status: ${executionGate.status}
- pr_create_allowed: ${executionGate.pr_create_allowed}
- blocking_gate_count: ${executionGate.blocking_gate_count}
- required_action_count: ${requiredActionCount}
- required_action_detail: see review-cockpit.html and gate-dag.json`;
}

function renderPrAgentHandoff({ prContext, splitPlan, language = 'ja' }) {
  const unresolved = collectUnresolvedRequiredGates(prContext.gate_dag);
  const warnings = collectReleaseDecisionWarningGates(prContext.gate_dag);
  return localizedText(language, {
    ja: `## VibePro Artifact Index
- PR本文の役割: レビュー用サマリー
- 詳細artifact: review-cockpit.html, gate-dag.html, split-plan.html
- 未解決Gate: ${formatUnresolvedGateList(unresolved)}
- リリース判断Warning: ${formatUnresolvedGateList(warnings)}
- PR分割方針: ${splitPlan?.recommended_strategy ?? '-'}`,
    en: `## VibePro Artifact Index
- PR body role: review summary
- Detail artifacts: review-cockpit.html, gate-dag.html, split-plan.html
- Unresolved gates: ${formatUnresolvedGateList(unresolved)}
- Release decision warnings: ${formatUnresolvedGateList(warnings)}
- PR split strategy: ${splitPlan?.recommended_strategy ?? '-'}`
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
- status: not_recorded
- evidence: no flow verification artifact recorded`;
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
    `- status: ${describeScanStatus(networkContracts.status)}`,
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
- 未検出: \`vibepro verify visual . --id <story-id> --base-url <preview-url>\` または \`vibepro verify visual . --id <story-id> --current-dir <dir>\` で \`.vibepro/qa/<qa-id>/visual-residual.json\` と \`residual-analysis.md\` を生成してください`;
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
      run.latest_residual?.binding?.status && run.latest_residual.binding.status !== 'current'
        ? `binding: ${run.latest_residual.binding.status}`
        : null,
      run.residual_analysis ? `analysis: ${run.residual_analysis}` : null,
      run.latest_residual?.path ? `residual: ${run.latest_residual.path}` : null
    ].filter(Boolean).join(' / ');
  });
  return `## Visual QA Evidence
- status: ${visualQa.status}
- threshold: ${formatVisualQaThreshold(visualQa)}
${rows.join('\n') || '- なし'}`;
}

function renderPrCompletionQuality(completionQuality) {
  if (!completionQuality) {
    return `## Completion Quality
- status: not_measured
- required evidence: Gate DAGを生成してから確認する`;
  }
  const metrics = completionQuality.metrics ?? {};
  const requiredEvidenceCount = completionQuality.required_evidence?.length ?? 0;
  return `## Completion Quality
- status: ${completionQuality.status}
- e2e_experience_reach_rate: ${formatNullableRate(metrics.e2e_experience_reach_rate)}
- final_20_auto_closure_rate: ${formatNullableRate(metrics.final_20_auto_closure_rate)}
- visual_qa_pass_rate: ${formatNullableRate(metrics.visual_qa_pass_rate)}
- human_usable_quality_rate: ${formatNullableRate(metrics.human_usable_quality_rate)}
- required_evidence_count: ${requiredEvidenceCount}
- required_evidence_detail: see review-cockpit.html and gate-dag.json`;
}

function formatNullableRate(value) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'not_measured';
}

function buildVisualQaGateReason(visualQa) {
  if (visualQa.source === 'verification_evidence') {
    const refs = visualQa.runs.map((run) => run.command ?? run.qa_id).filter(Boolean);
    return `Visual QA evidence is covered by current-head verification: ${refs.join('; ')}`;
  }
  const needsReview = visualQa.runs.filter((run) => run.status === 'needs_review');
  if (needsReview.length === 0) {
    return `Visual QA evidence is within ${formatVisualQaThreshold(visualQa)} residual threshold`;
  }
  const summaries = needsReview.map((run) => {
    const residual = run.latest_residual?.meanAbsResidualPct;
    const semantic = run.semantic_layout_residual_pct;
    const parts = [run.qa_id];
    if (run.latest_residual?.status) parts.push(`status ${run.latest_residual.status}`);
    for (const probeStatus of run.latest_residual?.probe_statuses ?? []) {
      if (probeStatus && probeStatus !== run.latest_residual?.status) parts.push(`probe ${probeStatus}`);
    }
    if (run.latest_residual?.binding?.status && run.latest_residual.binding.status !== 'current') {
      parts.push(`binding ${run.latest_residual.binding.status}`);
      if (run.latest_residual.binding.reason) parts.push(run.latest_residual.binding.reason);
    }
    if (residual != null) parts.push(`MAE ${residual}%`);
    if (semantic != null) parts.push(`semantic/layout ${semantic}%`);
    if (run.threshold_pct != null) parts.push(`threshold ${run.threshold_pct}%`);
    return parts.join(' ');
  });
  return `Visual QA needs review: ${summaries.join('; ')}`;
}

function formatVisualQaThreshold(visualQa) {
  if (visualQa.threshold_pct != null) return `${visualQa.threshold_pct}%`;
  const thresholds = [...new Set((visualQa.runs ?? [])
    .map((run) => run.threshold_pct)
    .filter((value) => value != null))];
  if (thresholds.length === 0) return `${DEFAULT_VISUAL_QA_THRESHOLD_PCT}%`;
  return thresholds.map((value) => `${value}%`).join(', ');
}

function buildStorySourceIntegrityGate(integrity = null) {
  const status = integrity?.status ?? 'passed';
  return {
    id: 'gate:story_source_integrity',
    type: 'story_source_integrity_gate',
    label: 'Story Source Integrity Gate',
    status,
    required: true,
    selected_story_id: integrity?.selected_story_id ?? null,
    source: integrity?.source ?? null,
    changed_story_docs: integrity?.changed_story_docs ?? [],
    mismatched_changed_story_docs: integrity?.mismatched_changed_story_docs ?? [],
    required_actions: integrity?.required_actions ?? [],
    reason: integrity?.reason ?? 'Story source integrity was not evaluated'
  };
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
  const graphContext = prContext.graph_context
    ?? await buildGraphImpactContext(repoRoot, git.changed_files, story.story_id);
  const lanes = buildSplitLanes({
    fileGroups,
    scope,
    prContext,
    suggestedBranch,
    graphContext
  });
  const automaticSplitRequired = scope.status !== 'reviewable' || lanes.some((lane) => lane.recommendation === 'separate_pr');
  const atomicScope = evaluateAtomicScopeDeclaration({
    storySource: prContext.story_source,
    scope,
    lanes,
    automaticSplitRequired,
    agentReviews: prContext.agent_reviews
  });
  const splitRequired = automaticSplitRequired && atomicScope.status !== 'accepted';
  const mergeOrder = lanes
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((lane) => lane.id);
  const stackedGatePlan = buildStackedGatePlan({ lanes, mergeOrder, prContext, atomicScope });
  return {
    schema_version: '0.1.0',
    model: 'story-pr-split-plan-v1',
    story_id: story.story_id,
    status: splitRequired ? 'split_recommended' : 'single_pr_ok',
    recommended_strategy: splitRequired
      ? 'split_by_lane_then_prepare'
      : (atomicScope.status === 'accepted' ? 'keep_current_pr_atomic_scope' : 'keep_current_pr'),
    automatic_recommendation: {
      status: automaticSplitRequired ? 'split_recommended' : 'single_pr_ok',
      recommended_strategy: automaticSplitRequired ? 'split_by_lane_then_prepare' : 'keep_current_pr'
    },
    accepted_current_story_lineage: collectAcceptedCurrentStoryLineage(scope),
    atomic_scope: atomicScope,
    rationale: buildSplitRationale({ scope, lanes, graphContext, atomicScope }),
    graph_context: graphContext,
    lanes,
    merge_order: mergeOrder,
    stacked_gate_plan: stackedGatePlan,
    next_actions: buildSplitNextActions({ lanes, splitRequired })
  };
}

function collectAcceptedCurrentStoryLineage(scope) {
  return (scope?.signals ?? [])
    .flatMap((signal) => Array.isArray(signal.accepted_current_story_lineage)
      ? signal.accepted_current_story_lineage
      : [])
    .map((item) => ({
      reference: item.reference,
      commit_sha: item.commit_sha,
      parent_count: item.parent_count,
      source_ref: item.source_ref,
      target_ref: item.target_ref,
      remote_tracking_sha: item.remote_tracking_sha,
      basis: item.basis
    }));
}

function evaluateAtomicScopeDeclaration({ storySource, scope, lanes, automaticSplitRequired, agentReviews = null }) {
  const strategy = storySource?.pr_scope_strategy ?? null;
  const reason = storySource?.pr_scope_reason ?? null;
  const reviewFacets = storySource?.pr_scope_review_facets ?? [];
  const dependencyBoundaryDeclarations = storySource?.pr_scope_dependency_boundaries ?? [];
  const laneIds = lanes.map((lane) => lane.id);
  if (strategy !== 'atomic_single_pr') {
    return {
      status: 'not_requested',
      strategy,
      reason,
      review_facets: reviewFacets,
      dependency_boundaries: [],
      missing_review_facets: [],
      missing_dependency_facets: [],
      invalid_dependency_boundaries: [],
      unsafe_scope_signals: [],
      unsafe_scope_reasons: [],
      source_ref: storySource?.path ?? null
    };
  }

  const missingReviewFacets = laneIds.filter((laneId) => !reviewFacets.includes(laneId));
  const dependencyBoundaryResult = validateAtomicScopeDependencyBoundaries(dependencyBoundaryDeclarations, laneIds);
  const missingReasonFacets = dependencyBoundaryResult.missing_facets;
  const unsafeScopeSignals = (scope.signals ?? []).filter((signal) => signal.unsafe_for_atomic_override === true);
  const unsafeSignalIds = new Set(unsafeScopeSignals.map((signal) => signal.id));
  const unsafeScopeReasons = (scope.reasons ?? []).filter((_, index) => {
    const signal = scope.signals?.[index];
    return signal && unsafeSignalIds.has(signal.id);
  });
  const reviewOwnerMap = buildAgentReviewOwnerMapEvidence(agentReviews, lanes);
  const reviewOwnerMapVerified = reviewOwnerMap.verified;
  const rejectionReasons = [];
  if (!reason || reason.trim().length < 80) rejectionReasons.push('pr_scope_reason must explain the atomic release boundary in at least 80 characters');
  if (dependencyBoundaryDeclarations.length === 0 && laneIds.length > 1) rejectionReasons.push('pr_scope_dependency_boundaries must declare typed lane dependencies');
  if (dependencyBoundaryResult.invalid.length > 0) rejectionReasons.push(`invalid typed dependency boundaries: ${dependencyBoundaryResult.invalid.join(', ')}`);
  if (missingReasonFacets.length > 0) rejectionReasons.push(`typed dependency boundaries must connect every generated facet: ${missingReasonFacets.join(', ')}`);
  if (reviewFacets.length === 0) rejectionReasons.push('pr_scope_review_facets must enumerate every generated lane');
  if (missingReviewFacets.length > 0) rejectionReasons.push(`missing generated review facets: ${missingReviewFacets.join(', ')}`);
  if (unsafeScopeSignals.length > 0) rejectionReasons.push('unsafe scope signals cannot be overridden by Story metadata');
  if (!reviewOwnerMapVerified) {
    rejectionReasons.push('atomic scope requires a current-head reviewer owner map with every configured role passing');
  }
  const nextActions = buildAtomicScopeNextActions({
    storyId: storySource?.story_id ?? null,
    rejectionReasons,
    reviewOwnerMap,
    unsafeScopeSignals
  });

  return {
    status: rejectionReasons.length === 0 ? 'accepted' : 'rejected',
    strategy,
    reason,
    review_facets: reviewFacets,
    dependency_boundaries: dependencyBoundaryResult.boundaries,
    generated_lane_ids: laneIds,
    missing_review_facets: missingReviewFacets,
    missing_reason_facets: missingReasonFacets,
    missing_dependency_facets: dependencyBoundaryResult.missing_facets,
    invalid_dependency_boundaries: dependencyBoundaryResult.invalid,
    unsafe_scope_signals: unsafeScopeSignals,
    unsafe_scope_reasons: unsafeScopeReasons,
    review_owner_map_verified: reviewOwnerMapVerified,
    next_actions: nextActions,
    review_owner_map: reviewOwnerMap.facets,
    unowned_review_facets: reviewOwnerMap.unowned_facets,
    automatic_split_required: automaticSplitRequired,
    rejection_reasons: rejectionReasons,
    source_ref: storySource?.path ?? null
  };
}

function buildAtomicScopeNextActions({ storyId, rejectionReasons = [], reviewOwnerMap, unsafeScopeSignals = [] }) {
  const quotedStoryId = shellQuote(storyId ?? '<story-id>');
  if (rejectionReasons.length === 0) {
    return [{ type: 'continue_atomic_pr', command: `vibepro pr prepare . --story-id ${quotedStoryId}` }];
  }
  const actions = [];
  if (rejectionReasons.some((reason) => reason.includes('reviewer owner map'))) {
    const missing = reviewOwnerMap?.missing_required_role_keys ?? [];
    const required = reviewOwnerMap?.required_role_keys ?? [];
    const rolesRequiringSurfaceCoverage = missing.length > 0 ? missing : required;
    const unownedReviewFacets = reviewOwnerMap?.facets
      ?.filter((facet) => !facet.owned)
      .map((facet) => facet.facet) ?? [];
    const uncoveredPaths = [...new Set(
      reviewOwnerMap?.facets?.flatMap((facet) => facet.uncovered_paths ?? []) ?? []
    )];
    const prepareCommands = rolesRequiringSurfaceCoverage.map((roleKey) => {
      const separator = roleKey.indexOf(':');
      const stage = separator >= 0 ? roleKey.slice(0, separator) : roleKey;
      const role = separator >= 0 ? roleKey.slice(separator + 1) : roleKey;
      return `vibepro review prepare . --id ${quotedStoryId} --stage ${shellQuote(stage)} --role ${shellQuote(role)}`;
    });
    actions.push({
      type: 'record_current_head_review_owners',
      missing_required_roles: missing,
      roles_requiring_surface_coverage: rolesRequiringSurfaceCoverage,
      unowned_review_facets: unownedReviewFacets,
      uncovered_paths: uncoveredPaths,
      prepare_commands: prepareCommands,
      follow_up_command: `vibepro review status . --id ${quotedStoryId}`,
      command: prepareCommands[0] ?? `vibepro review status . --id ${quotedStoryId}`,
      follow_up: `vibepro review status . --id ${quotedStoryId}`
    });
  }
  if (rejectionReasons.some((reason) => /pr_scope_|typed dependency|generated review facets/.test(reason))) {
    actions.push({
      type: 'complete_atomic_scope_declaration',
      target: 'Story frontmatter',
      required_fields: ['pr_scope_reason', 'pr_scope_review_facets', 'pr_scope_dependency_boundaries']
    });
  }
  if (unsafeScopeSignals.length > 0) {
    actions.push({
      type: 'split_unsafe_scope_surface',
      unsafe_signal_ids: unsafeScopeSignals.map((signal) => signal.id),
      reason: 'Unsafe repo-control or foreign-lineage surfaces cannot be repaired by atomic metadata.'
    });
  }
  actions.push({
    type: 'rerun_atomic_scope_decision',
    command: `vibepro pr prepare . --story-id ${quotedStoryId}`
  });
  return actions;
}

function validateAtomicScopeDependencyBoundaries(declarations, laneIds) {
  const laneSet = new Set(laneIds);
  const boundaries = [];
  const invalid = [];
  for (const declaration of declarations) {
    const match = String(declaration).trim().match(/^([A-Za-z0-9_-]+)\s*->\s*([A-Za-z0-9_-]+)$/);
    if (!match || !laneSet.has(match?.[1]) || !laneSet.has(match?.[2]) || match?.[1] === match?.[2]) {
      invalid.push(String(declaration));
      continue;
    }
    boundaries.push({ from: match[1], to: match[2] });
  }
  if (laneIds.length <= 1) return { boundaries, invalid, missing_facets: [] };
  const adjacency = new Map(laneIds.map((laneId) => [laneId, new Set()]));
  for (const boundary of boundaries) {
    adjacency.get(boundary.from).add(boundary.to);
    adjacency.get(boundary.to).add(boundary.from);
  }
  const visited = new Set();
  const pending = boundaries.length > 0 ? [boundaries[0].from] : [];
  while (pending.length > 0) {
    const laneId = pending.pop();
    if (visited.has(laneId)) continue;
    visited.add(laneId);
    for (const neighbor of adjacency.get(laneId) ?? []) pending.push(neighbor);
  }
  return {
    boundaries,
    invalid,
    missing_facets: laneIds.filter((laneId) => !visited.has(laneId))
  };
}

function reconcileAtomicScopeGateDag(gateDag, atomicScope) {
  if (!gateDag || atomicScope?.status !== 'accepted') return gateDag;
  const replaceGate = (id, transform) => {
    const index = (gateDag.nodes ?? []).findIndex((node) => node.id === id);
    if (index >= 0) gateDag.nodes[index] = transform(gateDag.nodes[index]);
  };
  replaceGate('gate:pr_scope_judgment', (gate) => ({
    ...gate,
    status: 'passed',
    classification: 'atomic_scope_accepted',
    atomic_scope: atomicScope,
    required_actions: [],
    reason: `Typed atomic scope accepted with current-head reviewer ownership: ${atomicScope.reason}`
  }));
  if (atomicScope.automatic_split_required === true
    && !(gateDag.nodes ?? []).some((node) => node.id === 'gate:split_resolution')) {
    gateDag.nodes ??= [];
    gateDag.nodes.push({
      id: 'gate:split_resolution',
      type: 'split_resolution_gate',
      label: 'Split Resolution Gate',
      status: 'passed',
      required: true,
      atomic_scope: atomicScope,
      decision_id: null,
      reason: 'Typed atomic scope resolves the automatic split recommendation for this current HEAD'
    });
    gateDag.edges ??= [];
    if (!gateDag.edges.some((edge) => edge.from === 'gate:pr_route_classification' && edge.to === 'gate:split_resolution')) {
      gateDag.edges.push({ from: 'gate:pr_route_classification', to: 'gate:split_resolution' });
    }
    if (!gateDag.edges.some((edge) => edge.from === 'gate:split_resolution' && edge.to === 'gate:pr_body_contract')) {
      gateDag.edges.push({ from: 'gate:split_resolution', to: 'gate:pr_body_contract' });
    }
  }
  replaceGate('gate:split_resolution', (gate) => ({
    ...gate,
    status: 'passed',
    atomic_scope: atomicScope,
    decision_id: null,
    reason: 'Typed atomic scope resolves the automatic split recommendation for this current HEAD'
  }));
  if (gateDag.summary) {
    gateDag.summary.pr_scope_judgment_status = 'passed';
    gateDag.summary.atomic_scope_status = 'accepted';
    gateDag.summary.needs_evidence_count = collectUnresolvedRequiredGates(gateDag).length;
  }
  gateDag.overall_status = collectUnresolvedRequiredGates(gateDag).length > 0
    ? 'needs_verification'
    : 'ready_for_review';
  return gateDag;
}

function reconcileGateDagOutcomeSummary(gateDag) {
  const unresolvedCount = collectUnresolvedRequiredGates(gateDag).length;
  gateDag.summary ??= {};
  gateDag.summary.needs_evidence_count = unresolvedCount;
  gateDag.overall_status = unresolvedCount > 0
    ? 'needs_verification'
    : 'ready_for_review';
  return gateDag;
}

async function buildGraphImpactContext(repoRoot, changedFiles, storyId = 'story-default') {
  return buildSplitGraphContext(
    repoRoot,
    changedFiles
      .map((file) => typeof file === 'string' ? file : file.path)
      .filter((file) => file && !isWorkspaceArtifactPath(file)),
    storyId
  );
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
  const e2eFiles = fileGroups.tests.files.filter(isE2eTestPath);
  const unitTestFiles = fileGroups.tests.files.filter((file) => !isE2eTestPath(file));
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

function buildSplitRationale({ scope, lanes, graphContext, atomicScope = null }) {
  const items = [];
  if (scope.reasons.length > 0) items.push(...scope.reasons);
  if (lanes.length > 1) items.push(`${lanes.length} lanes に分けると、要求正本・実装・検証基盤・repo制御を別々にレビューできる`);
  if (graphContext.available) {
    items.push(`Graphifyで ${graphContext.matched_file_count} changed files が一致し、${graphContext.related_file_count} related files を影響調査候補にした`);
  } else {
    items.push(`Graphify未利用: ${graphContext.reason}`);
  }
  if (atomicScope?.status === 'accepted') {
    items.push(`型付きatomic scopeを採用: ${atomicScope.reason}`);
  } else if (atomicScope?.status === 'rejected') {
    items.push(`型付きatomic scopeを不採用: ${atomicScope.rejection_reasons.join('; ')}`);
  }
  return items;
}

function buildStackedGatePlan({ lanes, mergeOrder, prContext, atomicScope = null }) {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]));
  const orderedLanes = mergeOrder.map((id) => byId.get(id)).filter(Boolean);
  const runtimeLane = byId.get('runtime-behavior') ?? null;
  const e2eLane = byId.get('e2e-gate') ?? null;
  const hasRuntimeChanges = Boolean(runtimeLane?.files?.some((file) => file.startsWith('src/')));
  const requiresCumulativeE2e = Boolean(e2eLane && hasRuntimeChanges);
  const requiresAtomicHeadValidation = atomicScope?.status === 'accepted';
  const requiredCommands = extractGateCommands(prContext);

  const lanePlans = orderedLanes.map((lane, index) => {
    const previousLaneIds = orderedLanes.slice(0, index).map((item) => item.id);
    const gateMode = requiresAtomicHeadValidation
      ? 'cumulative_atomic_head'
      : lane.id === 'e2e-gate' && requiresCumulativeE2e
        ? 'cumulative_after_dependencies'
        : 'isolated_pr';
    const dependsOn = gateMode === 'cumulative_after_dependencies' || gateMode === 'cumulative_atomic_head'
      ? previousLaneIds
      : [];
    return {
      lane_id: lane.id,
      gate_mode: gateMode,
      depends_on: dependsOn,
      isolated_checks: requiresAtomicHeadValidation ? [] : buildIsolatedLaneChecks(lane, requiredCommands),
      cumulative_checks: buildCumulativeLaneChecks({
        lane,
        commands: requiredCommands,
        requiresCumulativeE2e,
        requiresAtomicHeadValidation
      }),
      review_note: buildStackedGateReviewNote({
        lane,
        gateMode,
        dependsOn,
        requiresCumulativeE2e,
        requiresAtomicHeadValidation
      })
    };
  });

  return {
    schema_version: '0.1.0',
    model: 'stacked-pr-gate-plan-v1',
    summary: {
      lane_count: lanePlans.length,
      cumulative_gate_count: lanePlans.filter((lane) => lane.gate_mode !== 'isolated_pr').length,
      requires_cumulative_e2e: requiresCumulativeE2e,
      requires_atomic_head_validation: requiresAtomicHeadValidation
    },
    lane_plans: lanePlans,
    final_validation: buildFinalValidationPlan({
      requiredCommands,
      requiresCumulativeE2e,
      requiresAtomicHeadValidation
    })
  };
}

function extractGateCommands(prContext) {
  const gates = prContext.gate_dag?.nodes?.filter((node) => node.type === 'verification_gate') ?? [];
  const commandByLabel = new Map(gates.map((gate) => [gate.label, gate.command]).filter(([, command]) => command));
  const e2eGate = gates.find((gate) => gate.label === 'E2E Gate') ?? null;
  const unitCommand = commandByLabel.get('Unit Gate') ?? prContext.verification_commands?.find((item) => item.kind === 'unit')?.command ?? 'npm test';
  const integrationCommand = commandByLabel.get('Integration Gate') ?? prContext.verification_commands?.find((item) => item.kind === 'typecheck')?.command ?? 'npm run typecheck';
  const e2eCommand = commandByLabel.get('E2E Gate') ?? 'npx playwright test';
  const all = [...new Set([
    unitCommand,
    integrationCommand,
    ...(e2eGate?.required ? [e2eCommand] : []),
    ...(prContext.verification_commands ?? []).map((item) => item.command)
  ].filter(Boolean))];
  return {
    unit: unitCommand,
    integration: integrationCommand,
    e2e: e2eCommand,
    all
  };
}

function buildIsolatedLaneChecks(lane, commands) {
  if (lane.id === 'requirements-ssot') return ['Requirement Gate / document consistency review'];
  if (lane.id === 'runtime-behavior') return [commands.unit, commands.integration];
  if (lane.id === 'e2e-gate') return [commands.integration, 'Playwright harness smoke if runtime dependencies are already merged'];
  if (lane.id === 'repo-control') return ['git diff --check', commands.integration];
  return ['manual review'];
}

function buildCumulativeLaneChecks({ lane, commands, requiresCumulativeE2e, requiresAtomicHeadValidation = false }) {
  if (requiresAtomicHeadValidation) {
    return commands.all;
  }
  if (lane.id === 'e2e-gate' && requiresCumulativeE2e) {
    return [commands.unit, commands.integration, commands.e2e];
  }
  return [];
}

function buildStackedGateReviewNote({ lane, gateMode, dependsOn, requiresCumulativeE2e, requiresAtomicHeadValidation = false }) {
  if (requiresAtomicHeadValidation) {
    return `${lane.id} は独立PRではなく同一atomic HEADのreview facetとして確認し、全facetを含む累積状態で最終Gateを再実行する。`;
  }
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

function buildFinalValidationPlan({ requiredCommands, requiresCumulativeE2e, requiresAtomicHeadValidation = false }) {
  const commands = requiresAtomicHeadValidation
    ? requiredCommands.all
    : [requiredCommands.unit, requiredCommands.integration];
  if (!requiresAtomicHeadValidation && requiresCumulativeE2e) commands.push(requiredCommands.e2e);
  return {
    required: requiresCumulativeE2e || requiresAtomicHeadValidation,
    trigger: requiresAtomicHeadValidation
      ? 'typed atomic scopeで宣言した全review facetを同一HEADに含める'
      : requiresCumulativeE2e
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
    command: `git switch -c ${lane.suggested_branch} "<base>" && git add ${lane.files.map(shellQuote).join(' ')}`
  }));
}

function getAllGroupFiles(fileGroups) {
  return Object.entries(fileGroups)
    .filter(([key]) => key !== 'vibepro_artifacts')
    .flatMap(([, group]) => group.files ?? []);
}

function isWorkspaceArtifactPath(filePath) {
  const normalized = String(filePath ?? '');
  if (normalized === '.vibepro/config.json') return false;
  return normalized.startsWith('.vibepro/');
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

async function buildSplitGraphContext(repoRoot, changedFiles, storyId) {
  const graphPath = await resolveGraphifyArtifactFile(repoRoot, storyId);
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

async function buildPrContext(repoRoot, { story, taskContext, git, fileGroups, scope = null, latestStoryRun, designInputStoryRun = null, preImplementationStoryRun = null, verificationEvidence = null, decisionRecords = null, managedWorktreeGate = null, env = process.env }) {
  const storyDocs = await readStoryDocs(repoRoot, fileGroups.story_docs.files);
  const authoritativeStoryDocs = storyDocs.filter((doc) => !isCanonicalAuditSnapshotPath(doc?.path));
  let primaryStory = pickPrimaryStory(authoritativeStoryDocs, story);
  if (!storyDocMatchesStory(primaryStory, story)) {
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
  if (!storyDocMatchesStory(primaryStory, story)) {
    primaryStory = buildUnresolvedStorySource(story);
  }
  const storySourceIntegrity = buildStorySourceIntegrity(story, primaryStory, storyDocs);
  const architectureDecision = resolveArchitectureDecision(primaryStory, fileGroups);
  const typecheckCommand = await detectTypecheckCommand(repoRoot);
  const testRunner = await detectTestRunner(repoRoot);
  const verificationCommands = buildVerificationCommands(fileGroups, { typecheckCommand, testRunner });
  const e2eCommand = await detectPlaywrightCommand(repoRoot, fileGroups);
  const latestEvidence = await readRunEvidenceIfExists(repoRoot, latestStoryRun);
  const designInputEvidence = designInputStoryRun?.run_id === latestStoryRun?.run_id
    ? latestEvidence
    : await readRunEvidenceIfExists(repoRoot, designInputStoryRun);
  const preImplementationEvidence = preImplementationStoryRun?.run_id === latestStoryRun?.run_id
    ? latestEvidence
    : await readRunEvidenceIfExists(repoRoot, preImplementationStoryRun);
  const latestFlowVerification = await readLatestFlowVerification(repoRoot, story.story_id, git);
  const boundVerificationEvidence = await bindVerificationEvidenceToGit(repoRoot, verificationEvidence, git);
  const artifactVisualQaEvidence = await readVisualQaEvidence(repoRoot, git);
  const visualQaEvidence = artifactVisualQaEvidence ?? buildVisualQaEvidenceFromVerification(repoRoot, boundVerificationEvidence);
  const designQualityEvidence = await readDesignQualityEvidence(repoRoot, story.story_id);
  const performanceEvidence = await summarizeStoryPerformanceEvidence(repoRoot, story.story_id);
  const networkContracts = await scanNetworkContracts(repoRoot, {
    changedFiles: git.changed_files,
    baseRef: git.base_ref,
    headRef: git.head_ref === 'HEAD' && git.includes_dirty_in_changed_files ? null : git.head_ref
  });
  const inferredSpec = await readInferredSpec(repoRoot, story.story_id);
  const designDiagramSpec = await readDesignDiagramSpec(repoRoot, {
    storyId: story.story_id,
    storySource: primaryStory,
    inferredSpec
  });
  const e2eCoverage = await buildStoryE2eCoverage(repoRoot, story, primaryStory, {
    inferredSpec,
    verificationEvidence: boundVerificationEvidence
  });
  const specDrift = await readDrift(repoRoot, story.story_id);
  const regressionRisk = await scanRegressionRisk(repoRoot, { top: Infinity, storyId: story.story_id });
  const changeClassification = classifyChangeRisk({
    fileGroups,
    storySource: primaryStory,
    networkContracts,
    regressionRisk,
    diffStats: git.diff_line_stats ?? null
  });
  const persistedValidationSequence = await readValidationSequence(repoRoot, story.story_id);
  const validationSequence = reconcileValidationSequenceState(persistedValidationSequence, {
    storyId: story.story_id,
    riskProfile: changeClassification.profile,
    riskSurfaces: changeClassification.risk_surfaces,
    headSha: git.head_sha
  });
  if (validationSequence.plan.required && validationSequence !== persistedValidationSequence) {
    await writeValidationSequence(repoRoot, validationSequence);
  }
  const validationSequenceEvaluation = evaluateValidationSequence(validationSequence, { currentHeadSha: git.head_sha });
  const prRoute = buildPrRouteClassification({
    git,
    fileGroups,
    scope,
    changeClassification
  });
  const graphContext = await buildGraphImpactContext(repoRoot, git.changed_files, story.story_id);
  const codeTopologyContext = await buildCodeTopologyContext(repoRoot, {
    changedFiles: git.changed_files,
    headSha: git.head_sha,
    env
  });
  const designSsotReconciliation = await reconcileDesignSsot(repoRoot, {
    git,
    base: git.base_ref,
    writeArtifacts: false
  });
  const responsibilityAuthority = await resolveResponsibilityAuthority(repoRoot, {
    storySource: primaryStory,
    fileGroups,
    git,
    inferredSpec,
    changeClassification,
    verificationEvidence: boundVerificationEvidence
  });
  const requirementConsistency = await buildRequirementConsistency(repoRoot, {
    story,
    storySource: primaryStory,
    fileGroups,
    inferredSpec,
    responsibilityAuthority
  });
  const architectureSources = await readTextSources(repoRoot, fileGroups.architecture_docs.files);
  const managedWorktreeContext = await evaluateManagedWorktreeCommandContext(repoRoot, {
    storyId: story.story_id,
    commandName: 'pr prepare',
    expectedHeadSha: git.head_sha
  });
  const bugPhysicsTriage = buildBugPhysicsTriage({
    storySource: primaryStory,
    inferredSpec,
    verificationEvidence: boundVerificationEvidence
  });
  const decisionRecordSummary = summarizeDecisionRecords(decisionRecords);
  const architectureBlueprint = await buildArchitectureBlueprintCoverage(repoRoot, {
    storySource: primaryStory,
    fileGroups
  });
  const environmentGraph = await readEnvironmentGraphIfExists(repoRoot);
  const agentReviews = await summarizeAgentReviewsForPr(repoRoot, {
    storyId: story.story_id,
    story,
    fileGroups,
    networkContracts,
    performanceEvidence,
    changeClassification,
    validationSequence,
    git
  });
  if (agentReviews) {
    agentReviews.delivery_efficiency = await buildDeliveryEfficiencyContext(repoRoot, story.story_id, agentReviews);
  }
  const engineeringJudgment = buildEngineeringJudgmentClassification({
    fileGroups,
    storySource: primaryStory,
    changeClassification,
    prRoute,
    networkContracts,
    scope,
    graphContext,
    codeTopologyContext,
    verificationEvidence: boundVerificationEvidence,
    decisionRecords,
    inferredSpec,
    agentReviews
  });
  const judgmentAxisNoisePrecedents = await recordAndAttachJudgmentAxisNoisePrecedents(repoRoot, {
    storyId: story.story_id,
    engineeringJudgment,
    decisionRecords
  });
  const designInputJudgment = buildDesignInputJudgmentContext({
    latestStoryRun: designInputStoryRun ?? latestStoryRun,
    latestEvidence: designInputEvidence ?? latestEvidence,
    engineeringJudgment,
    changeClassification,
    fileGroups
  });
  const preImplementationJudgment = buildPreImplementationJudgmentContext({
    latestStoryRun: preImplementationStoryRun,
    latestEvidence: preImplementationEvidence,
    engineeringJudgment
  });
  const exploreEvidence = await summarizeExploreEvidenceForPr(repoRoot, {
    storyId: story.story_id
  });
  const latestJourney = await readLatestJourneyMap(repoRoot);
  const curatedJourney = latestJourney ? await readCuratedJourneyMap(repoRoot, latestJourney.journey_id) : null;
  const journeyMap = summarizeJourneyForPr(latestJourney, story.story_id, { curatedJourney });
  const uiuxIaFlowMap = await readUiuxIaFlowMapForPr(repoRoot, story.story_id);
  const uiuxResponsiveA11yMatrix = await readResponsiveA11yMatrixForPr(repoRoot, story.story_id);
  const context = {
    story_source: primaryStory,
    story_source_integrity: storySourceIntegrity,
    architecture_decision: architectureDecision,
    architecture_sources: architectureSources,
    requirement_consistency: requirementConsistency,
    design_ssot_reconciliation: designSsotReconciliation.result,
    responsibility_authority: responsibilityAuthority,
    pr_route: prRoute,
    engineering_judgment: engineeringJudgment,
    judgment_axis_noise_precedents: judgmentAxisNoisePrecedents,
    design_input_judgment: designInputJudgment,
    pre_implementation_judgment: preImplementationJudgment,
    graph_context: graphContext,
    code_topology_context: codeTopologyContext,
    bug_physics_triage: bugPhysicsTriage,
    change_classification: changeClassification,
    validation_sequencing: {
      state: validationSequence,
      evaluation: validationSequenceEvaluation,
      artifact: `.vibepro/validation-sequencing/${story.story_id}/state.json`
    },
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
    journey_map: journeyMap,
    uiux_ia_flow_map: uiuxIaFlowMap,
    uiux_responsive_a11y_matrix: uiuxResponsiveA11yMatrix,
    agent_reviews: agentReviews,
    explore_evidence: exploreEvidence,
    managed_worktree: managedWorktreeContext,
    managed_worktree_gate: managedWorktreeGate,
    verification_evidence: boundVerificationEvidence,
    decision_records: decisionRecords ? {
      ...decisionRecords,
      summary: decisionRecordSummary
    } : {
      schema_version: '0.1.0',
      model: 'vibepro-decision-records-v1',
      story_id: story.story_id,
      artifact: toWorkspaceRelative(repoRoot, path.join(getWorkspaceDir(repoRoot), 'pr', story.story_id, 'decision-records.json')),
      summary: decisionRecordSummary,
      decisions: []
    },
    risks: []
  };
  const scopeBoundary = await readScopeBoundaryIfExists(repoRoot, story.story_id);
  context.gate_dag = buildGateDag({
    repoRoot,
    story,
    storySource: primaryStory,
    storySourceIntegrity,
    architectureDecision,
    requirementConsistency,
    responsibilityAuthority,
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
    decisionRecords: context.decision_records,
    inferredSpec,
    designDiagramSpec,
    specDrift,
    changeClassification,
    engineeringJudgment,
    designInputJudgment,
    architectureSources,
    bugPhysicsTriage,
    architectureBlueprint,
    environmentGraph,
    git,
    scope,
    scopeBoundary,
    prRoute,
    graphContext,
    codeTopologyContext,
    designSsotReconciliation: context.design_ssot_reconciliation,
    journeyMap,
    managedWorktreeContext,
    managedWorktreeGate,
    validationSequenceEvaluation
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
    execution_gate: context.execution_gate,
    decision_record_summary: decisionRecordSummary
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

function buildMissingLifecycleArtifactSummary({ storyId, currentHeadSha, checkedAt }) {
  return {
    schema_version: '0.1.0',
    model: 'vibepro-pr-lifecycle-artifact-freshness-v1',
    story_id: storyId,
    status: 'not_started',
    current_head_sha: currentHeadSha ?? null,
    checked_at: checkedAt,
    artifacts: [
      buildMissingLifecycleArtifact('pr_create'),
      buildMissingLifecycleArtifact('pr_merge')
    ]
  };
}

function buildMissingLifecycleArtifact(kind) {
  const fileName = kind === 'pr_merge' ? 'pr-merge.json' : 'pr-create.json';
  return {
    kind,
    status: 'not_created',
    exists: false,
    artifact: null,
    report: null,
    artifact_head_sha: null,
    current_head_sha: null,
    reason: `${fileName} has not been created yet`
  };
}

async function inspectPrLifecycleArtifacts(repoRoot, storyId, { currentHeadSha, checkedAt }) {
  const prDir = path.join(getWorkspaceDir(repoRoot), 'pr', storyId);
  const artifacts = [];
  for (const spec of PR_LIFECYCLE_ARTIFACT_SPECS) {
    const jsonPath = path.join(prDir, spec.fileName);
    const reportPath = path.join(prDir, spec.reportName);
    const artifact = await readJsonIfExists(jsonPath);
    if (!artifact) {
      artifacts.push({
        ...buildMissingLifecycleArtifact(spec.kind),
        artifact: toWorkspaceRelative(repoRoot, jsonPath),
        report: toWorkspaceRelative(repoRoot, reportPath),
        current_head_sha: currentHeadSha ?? null,
        checked_at: checkedAt
      });
      continue;
    }
    const artifactHeadSha = extractPrLifecycleArtifactHead(artifact);
    artifacts.push({
      kind: spec.kind,
      status: resolvePrLifecycleArtifactFreshnessStatus({ artifactHeadSha, currentHeadSha }),
      exists: true,
      artifact: toWorkspaceRelative(repoRoot, jsonPath),
      report: toWorkspaceRelative(repoRoot, reportPath),
      artifact_head_sha: artifactHeadSha,
      current_head_sha: currentHeadSha ?? null,
      checked_at: checkedAt,
      reason: buildPrLifecycleArtifactFreshnessReason(spec.kind, { artifactHeadSha, currentHeadSha })
    });
  }
  return {
    schema_version: '0.1.0',
    model: 'vibepro-pr-lifecycle-artifact-freshness-v1',
    story_id: storyId,
    status: summarizePrLifecycleArtifactFreshness(artifacts),
    current_head_sha: currentHeadSha ?? null,
    checked_at: checkedAt,
    artifacts
  };
}

async function annotatePrLifecycleArtifacts(repoRoot, storyId, lifecycleArtifacts, options = {}) {
  const prDir = path.join(getWorkspaceDir(repoRoot), 'pr', storyId);
  for (const spec of PR_LIFECYCLE_ARTIFACT_SPECS) {
    const freshness = lifecycleArtifacts?.artifacts?.find((item) => item.kind === spec.kind);
    if (!freshness?.exists) continue;
    const jsonPath = path.join(prDir, spec.fileName);
    const artifact = await readJsonIfExists(jsonPath);
    if (!artifact) continue;
    const annotated = annotatePrLifecycleArtifact(artifact, freshness);
    const reportHtml = spec.kind === 'pr_merge'
      ? renderPrMergeHtml(annotated, { language: annotated.output?.language ?? 'ja' })
      : renderPrCreateHtml(annotated, { language: annotated.output?.language ?? 'ja' });
    await writeFile(jsonPath, `${JSON.stringify(annotated, null, 2)}\n`, { signal: options.signal });
    await writeFile(path.join(prDir, spec.reportName), reportHtml, { signal: options.signal });
  }
}

function annotatePrLifecycleArtifact(artifact, freshness) {
  return {
    ...artifact,
    artifact_freshness: freshness,
    warnings: buildPrLifecycleArtifactWarnings(artifact.warnings, freshness)
  };
}

function buildPrLifecycleArtifactWarnings(warnings = [], freshness) {
  const preserved = (Array.isArray(warnings) ? warnings : [])
    .filter((warning) => !String(warning).startsWith(PR_LIFECYCLE_FRESHNESS_WARNING_PREFIX));
  if (!freshness || freshness.status === 'current') return preserved;
  return [
    ...preserved,
    `${PR_LIFECYCLE_FRESHNESS_WARNING_PREFIX} ${freshness.reason}. Open the latest pr-prepare artifact before trusting this lifecycle artifact.`
  ];
}

function summarizePrLifecycleArtifactFreshness(artifacts) {
  const existing = artifacts.filter((item) => item.exists);
  if (existing.length === 0) return 'not_started';
  if (existing.some((item) => item.status === 'stale' || item.status === 'unbound')) return 'stale';
  if (existing.every((item) => item.status === 'current')) return 'current';
  return 'partial';
}

function resolvePrLifecycleArtifactFreshnessStatus({ artifactHeadSha, currentHeadSha }) {
  if (!artifactHeadSha) return 'unbound';
  if (!currentHeadSha) return 'unknown';
  return artifactHeadSha === currentHeadSha ? 'current' : 'stale';
}

function buildPrLifecycleArtifactFreshnessReason(kind, { artifactHeadSha, currentHeadSha }) {
  const label = kind === 'pr_merge' ? 'pr-merge' : 'pr-create';
  if (!artifactHeadSha) return `${label} artifact is not bound to a git HEAD`;
  if (!currentHeadSha) return `${label} artifact freshness could not be checked because current HEAD is unknown`;
  if (artifactHeadSha === currentHeadSha) return `${label} artifact is bound to the current HEAD ${shortSha(currentHeadSha)}`;
  return `${label} artifact was recorded for ${shortSha(artifactHeadSha)}, current HEAD is ${shortSha(currentHeadSha)}`;
}

function extractPrLifecycleArtifactHead(artifact) {
  return [
    artifact?.current_head_sha,
    artifact?.head_sha,
    artifact?.git?.head_sha,
    artifact?.toolchain?.source_git?.commit,
    artifact?.toolchain?.git?.commit,
    artifact?.gate_dag?.git_context?.head_sha,
    artifact?.gate_dag?.head_sha,
    artifact?.artifact_freshness?.artifact_head_sha,
    artifact?.pr?.head_ref_oid
  ].find((value) => typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value)) ?? null;
}

function buildCurrentPrLifecycleArtifactFreshness(kind, headSha, checkedAt) {
  return {
    kind,
    status: headSha ? 'current' : 'unknown',
    exists: true,
    artifact: null,
    report: null,
    artifact_head_sha: headSha ?? null,
    current_head_sha: headSha ?? null,
    checked_at: checkedAt,
    reason: headSha
      ? buildPrLifecycleArtifactFreshnessReason(kind, { artifactHeadSha: headSha, currentHeadSha: headSha })
      : buildPrLifecycleArtifactFreshnessReason(kind, { artifactHeadSha: null, currentHeadSha: null })
  };
}

function shortSha(value) {
  return typeof value === 'string' ? value.slice(0, 12) : '-';
}

const PR_LIFECYCLE_FRESHNESS_WARNING_PREFIX = 'VibePro lifecycle artifact freshness:';
const PR_LIFECYCLE_ARTIFACT_SPECS = [
  { kind: 'pr_create', fileName: 'pr-create.json', reportName: 'pr-create.html' },
  { kind: 'pr_merge', fileName: 'pr-merge.json', reportName: 'pr-merge.html' }
];

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

async function bindVerificationEvidenceToGit(repoRoot, verificationEvidence, git) {
  if (!verificationEvidence) return null;
  const commands = Array.isArray(verificationEvidence.commands)
    ? await Promise.all(verificationEvidence.commands.map((command) => bindVerificationCommandToGit(repoRoot, command, git)))
    : [];
  return {
    ...verificationEvidence,
    commands,
    binding: {
      current_head_sha: git.head_sha ?? null,
      current_dirty: git.dirty === true,
      current_status_fingerprint_hash: fingerprintHashForContext(git),
      current_user_status_fingerprint_hash: git.user_status_fingerprint_hash ?? null,
      stale_command_count: commands.filter((command) => command.binding?.status !== 'current').length
    }
  };
}

async function bindVerificationCommandToGit(repoRoot, command, git) {
  const context = command?.git_context ?? null;
  const binding = await resolveVerificationBinding(repoRoot, context, git, command?.content_binding);
  return {
    ...command,
    binding,
    stale: binding.status !== 'current'
  };
}

async function resolveVerificationBinding(repoRoot, context, git, contentBinding = null) {
  if (!context?.head_sha) {
    return {
      status: 'legacy',
      reason: 'legacy verification evidence is not bound to a git head'
    };
  }
  const contentFreshness = await evaluateContentBinding(repoRoot, contentBinding, git);
  if (contentFreshness?.status === 'current') {
    return contentFreshness;
  }
  if (contentFreshness?.status === 'stale') {
    return contentFreshness;
  }
  if (git.head_sha && context.head_sha !== git.head_sha) {
    return {
      status: 'stale',
      reason: `verification evidence was recorded for ${context.head_sha.slice(0, 12)}, current head is ${git.head_sha.slice(0, 12)}`
    };
  }
  const comparison = compareFingerprintContexts(context, git);
  if (!comparison.matches) {
    return {
      status: 'stale',
      reason: comparison.usingUserFingerprint
        ? 'verification evidence was recorded with a different user dirty worktree fingerprint'
        : 'verification evidence was recorded with a different dirty worktree fingerprint'
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
  if (!artifact) return bindFlowVerificationToGit(repoRoot, matching, git);
  try {
    const verification = JSON.parse(await readFile(path.resolve(repoRoot, artifact), 'utf8'));
    const storyMismatch = verification?.story_id && verification.story_id !== storyId;
    return bindFlowVerificationToGit(repoRoot, {
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

async function bindFlowVerificationToGit(repoRoot, flowVerification, git) {
  if (!flowVerification || !git) return flowVerification;
  const context = flowVerification.verification?.git_context ?? flowVerification.git_context ?? null;
  const binding = await resolveVerificationBinding(repoRoot, context, git);
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

async function readVisualQaEvidence(repoRoot, git = null) {
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
    const run = await readVisualQaRun(repoRoot, qaDir, entry.name, git);
    if (run) runs.push(run);
  }
  if (runs.length === 0) return null;
  for (const run of runs) {
    run.threshold_pct = run.latest_residual?.thresholdPct ?? DEFAULT_VISUAL_QA_THRESHOLD_PCT;
    run.status = resolveVisualQaStatus(run, run.threshold_pct);
  }
  const sortedRuns = runs
    .sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0))
    .slice(0, 5);
  const thresholds = [...new Set(sortedRuns.map((run) => run.threshold_pct).filter((value) => value != null))];
  return {
    schema_version: '0.1.0',
    status: sortedRuns.some((run) => run.status === 'needs_review') ? 'needs_review' : 'ready_for_review',
    threshold_pct: thresholds.length === 1 ? thresholds[0] : null,
    runs: sortedRuns,
    artifacts: sortedRuns.flatMap((run) => [
      run.residual_analysis,
      run.latest_residual?.path
    ].filter(Boolean))
  };
}

function buildVisualQaEvidenceFromVerification(repoRoot, verificationEvidence) {
  const currentPassing = Array.isArray(verificationEvidence?.commands)
    ? verificationEvidence.commands.filter((command) => command.status === 'pass' && command.binding?.status === 'current')
    : [];
  const runs = [];
  for (const command of currentPassing) {
    const matches = classifyVerificationEvidenceItem(command);
    const kinds = new Set(matches.map((match) => match.kind));
    if (!kinds.has('visual_qa') || !kinds.has('screenshot')) continue;
    const targets = Array.isArray(command.observation?.targets) ? command.observation.targets : [];
    const artifacts = [
      command.artifact,
      ...targets
    ].filter(Boolean);
    const visualArtifacts = artifacts.filter((artifact) => isVisualQaArtifactRef(artifact));
    if (visualArtifacts.length === 0) continue;
    const missingVisualArtifacts = visualArtifacts
      .filter((artifact) => !existsSync(path.resolve(repoRoot, artifact)));
    if (missingVisualArtifacts.length > 0) continue;
    runs.push({
      qa_id: `verification:${command.kind ?? 'unknown'}`,
      source: 'verification_evidence',
      status: 'ready_for_review',
      command: command.command ?? null,
      summary: command.summary ?? null,
      artifact_refs: [...new Set(artifacts)],
      matched_kinds: [...kinds].filter((kind) => ['visual_qa', 'screenshot', 'accessibility_evidence'].includes(kind)),
      updated_at_ms: Date.parse(command.recorded_at ?? '') || 0,
      residual_analysis: null,
      semantic_layout_residual_pct: null,
      latest_residual: null
    });
  }
  if (runs.length === 0) return null;
  const sortedRuns = runs
    .sort((a, b) => (b.updated_at_ms ?? 0) - (a.updated_at_ms ?? 0))
    .slice(0, 5);
  return {
    schema_version: '0.1.0',
    status: 'ready_for_review',
    source: 'verification_evidence',
    required_evidence: ['visual_qa', 'screenshot'],
    optional_evidence: ['accessibility_evidence'],
    threshold_pct: null,
    runs: sortedRuns,
    artifacts: sortedRuns.flatMap((run) => run.artifact_refs ?? [])
  };
}

function isVisualQaArtifactRef(artifact) {
  const ref = String(artifact ?? '').trim();
  return /(^|\/)[^/]+\.(png|jpe?g|webp)$/i.test(ref)
    || /(^|\/)\.vibepro\/qa\/[^/]+\/(visual-residual\.json|residual-analysis\.md)$/i.test(ref);
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
  const hasCaptureEvidence = ['pass', 'needs_setup'].includes(captureStatus);
  const status = hasExplicitGate && hasDesignDag && hasCaptureEvidence
    ? 'ready_for_review'
    : 'needs_evidence';
  const missing = [];
  if (!hasExplicitGate) missing.push('explicit spec_gate');
  if (!hasDesignDag) missing.push('design_quality_dag');
  if (!hasCaptureEvidence) missing.push(`screen capture (${captureStatus})`);
  const evidence_status = captureStatus === 'needs_setup'
    ? 'needs_setup_recorded'
    : captureStatus === 'pass'
      ? 'captured'
      : 'missing';
  return {
    schema_version: '0.1.0',
    status,
    story_id: storyId,
    model: plan?.design_quality_dag?.model ?? null,
    screen_count: Array.isArray(plan?.screens) ? plan.screens.length : 0,
    capture_status: captureStatus,
    evidence_status,
    missing,
    artifacts: [
      toWorkspaceRelative(repoRoot, planPath),
      capture ? toWorkspaceRelative(repoRoot, capturePath) : null
    ].filter(Boolean)
  };
}

function buildDesignQualityGateReadyReason(designQualityEvidence) {
  if (designQualityEvidence?.capture_status === 'needs_setup') {
    return 'VibePro Design Quality DAG evidence is present and screen capture needs_setup record was captured';
  }
  return 'VibePro Design Quality DAG evidence is present and screen capture passed';
}

async function buildStoryE2eCoverage(repoRoot, story, storySource, options = {}) {
  const acceptanceCriteria = storySource?.acceptance_criteria ?? [];
  const scenarioClauses = extractScenarioCoverageClauses(options.inferredSpec);
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
  const verificationAcceptanceCoverage = buildVerificationE2eAcceptanceCoverage({
    verificationEvidence: options.verificationEvidence,
    acceptanceCriteria,
    candidates
  });
  const covered = acceptanceCriteria.map((criterion, index) => {
    const id = `ac:${index + 1}`;
    const analyses = candidates.map((candidate) => analyzeE2eAcceptanceCandidate(candidate, story.story_id, criterion, index));
    const files = new Set(analyses
      .filter((analysis) => analysis.covered)
      .map((analysis) => analysis.path));
    const evidenceCoverage = verificationAcceptanceCoverage.byId.get(id);
    if (evidenceCoverage) {
      for (const file of evidenceCoverage.files) {
        files.add(file);
      }
    }
    const fileList = [...files];
    return {
      id,
      criterion,
      covered: fileList.length > 0,
      files: fileList,
      verification_evidence_refs: evidenceCoverage?.refs ?? [],
      candidate_diagnostics: fileList.length > 0 ? [] : analyses.map(summarizeE2eCandidateDiagnostic)
    };
  });
  const missing = covered.filter((item) => !item.covered);
  const scenarioCovered = scenarioClauses.map((clause, index) => {
    const files = candidates
      .filter((candidate) => candidate.executable && e2eCandidateCoversScenario(candidate, story.story_id, clause, index))
      .map((candidate) => candidate.path);
    return {
      id: clause.id,
      statement: clause.statement,
      covered: files.length > 0,
      files
    };
  });
  const missingScenarios = scenarioCovered.filter((item) => !item.covered);
  const required = acceptanceCriteria.length > 0 || scenarioClauses.length > 0;
  const status = !required
    ? 'not_applicable'
    : missing.length === 0 && missingScenarios.length === 0
      ? 'passed'
      : 'needs_evidence';
  return {
    schema_version: '0.1.0',
    story_id: story.story_id,
    required,
    status,
    expected_file_patterns: expectedFilePatterns,
    matched_files: candidates.map((candidate) => candidate.path),
    executable_matched_files: candidates.filter((candidate) => candidate.executable).map((candidate) => candidate.path),
    verification_evidence_coverage: verificationAcceptanceCoverage.summary,
    acceptance_criteria_count: acceptanceCriteria.length,
    covered_acceptance_criteria_count: covered.length - missing.length,
    covered_acceptance_criteria: covered.filter((item) => item.covered),
    missing_acceptance_criteria: missing,
    scenario_clause_count: scenarioClauses.length,
    covered_scenario_clause_count: scenarioCovered.length - missingScenarios.length,
    covered_scenario_clauses: scenarioCovered.filter((item) => item.covered),
    missing_scenario_clauses: missingScenarios,
    coverage_diagnostics: {
      missing_acceptance_criteria: missing.map((item) => ({
        id: item.id,
        criterion: item.criterion,
        candidate_diagnostics: item.candidate_diagnostics ?? [],
        guidance: 'Use an explicit AC marker near an executable assertion, or a local static string/array binding referenced by that assertion. Avoid marker-only comments without an assertion.'
      })),
      missing_scenario_clauses: missingScenarios.map((item) => ({
        id: item.id,
        statement: item.statement,
        guidance: 'Use an explicit scenario marker near an executable assertion that checks the scenario outcome.'
      }))
    },
    scenario_e2e_coverage: {
      required: scenarioClauses.length > 0,
      status: scenarioClauses.length === 0
        ? 'not_applicable'
        : missingScenarios.length === 0
          ? 'passed'
          : 'needs_evidence',
      scenario_clause_count: scenarioClauses.length,
      covered_scenario_clause_count: scenarioCovered.length - missingScenarios.length,
      covered_scenario_clauses: scenarioCovered.filter((item) => item.covered),
      missing_scenario_clauses: missingScenarios
    }
  };
}

function buildVerificationE2eAcceptanceCoverage({ verificationEvidence, acceptanceCriteria, candidates }) {
  const byId = new Map();
  const summary = {
    status: 'not_applicable',
    covered_acceptance_criteria: [],
    evidence_refs: []
  };
  if (!acceptanceCriteria.length) return { byId, summary };
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  const e2eCommands = commands.filter((item) => {
    const kind = item.kind === 'flow' ? 'e2e' : item.kind;
    return kind === 'e2e'
      && item.binding?.status === 'current'
      && ['pass', 'passed', 'success', 'ok'].includes(item.status)
      && item.observation_check?.status !== 'missing';
  });
  if (e2eCommands.length === 0) return { byId, summary: { ...summary, status: 'missing_current_e2e_evidence' } };

  const candidateFiles = candidates.map((candidate) => candidate.path);
  for (const item of e2eCommands) {
    const scenarios = Array.isArray(item.observation?.scenarios) ? item.observation.scenarios : [];
    const values = item.observation?.values && typeof item.observation.values === 'object'
      ? Object.entries(item.observation.values).map(([key, value]) => `${key}=${value}`)
      : [];
    const text = [
      item.summary,
      item.command,
      item.artifact,
      ...scenarios,
      ...values
    ].filter(Boolean).join('\n');
    if (!/\bscenario_clause_e2e\b/i.test(text)) continue;
    const targets = Array.isArray(item.observation?.targets)
      ? item.observation.targets.filter(Boolean)
      : [];
    const files = targets.length > 0 ? targets : candidateFiles;
    const refs = [
      item.artifact,
      ...files
    ].filter(Boolean);
    for (let index = 0; index < acceptanceCriteria.length; index += 1) {
      const id = `ac:${index + 1}`;
      if (!e2eObservationMentionsAcceptanceId(text, index + 1)) continue;
      const existing = byId.get(id) ?? { files: new Set(), refs: new Set() };
      for (const file of files) existing.files.add(file);
      for (const ref of refs) existing.refs.add(ref);
      byId.set(id, existing);
    }
  }

  const normalized = new Map([...byId.entries()].map(([id, value]) => [
    id,
    {
      files: [...value.files],
      refs: [...value.refs]
    }
  ]));
  return {
    byId: normalized,
    summary: {
      status: normalized.size === acceptanceCriteria.length ? 'covered' : 'partial',
      covered_acceptance_criteria: [...normalized.keys()],
      evidence_refs: [...new Set([...normalized.values()].flatMap((value) => value.refs))].slice(0, 12)
    }
  };
}

function e2eObservationMentionsAcceptanceId(text, index) {
  const escaped = String(index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bAC[-_:\\s]?${escaped}\\b`, 'i').test(text)
    || new RegExp(`\\bac[-_:\\s]?${escaped}\\b`, 'i').test(text)
    || new RegExp(`\\bacceptance[-_:\\s]?${escaped}\\b`, 'i').test(text);
}

function extractScenarioCoverageClauses(inferredSpec) {
  return (Array.isArray(inferredSpec?.clauses) ? inferredSpec.clauses : [])
    .filter((clause) => clause?.type === 'scenario' && typeof clause.statement === 'string' && clause.statement.trim())
    .map((clause) => ({
      id: clause.id,
      statement: clause.statement
    }));
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
  return analyzeE2eAcceptanceCandidate(candidate, storyId, criterion, index).covered;
}

function analyzeE2eAcceptanceCandidate(candidate, storyId, criterion, index) {
  const storyBoundMarkers = [
    `${storyId} ac:${index + 1}`,
    `${storyId} ac-${index + 1}`,
    `${storyId} acceptance:${index + 1}`
  ].map(normalizeCoverageText);
  const assertionMessageMarkers = [
    `ac:${index + 1}`,
    `ac-${index + 1}`,
    `acceptance:${index + 1}`
  ].map(normalizeCoverageText);
  const criterionMarker = normalizeCoverageText(criterion);
  const blocks = getExecutableE2eBlockDetails(candidate.content);
  if (blocks.length === 0) {
    return {
      path: candidate.path,
      executable: false,
      covered: false,
      blocks: [],
      reasons: ['matched file contains no executable assertion blocks']
    };
  }
  const blockDiagnostics = blocks.map((block, blockIndex) => {
    const content = normalizeCoverageText(block.text);
    const storyMarkerMatched = storyBoundMarkers.some((marker) => marker.length > 0 && content.includes(marker));
    const assertionMarkerMatched = blockHasAssertionMessageMarker(block.text, assertionMessageMarkers);
    const markerMatched = storyMarkerMatched || assertionMarkerMatched;
    const criterionAssertionMatched = criterionMarker.length > 0 && blockHasCriterionAssertion(block.text, criterion);
    const fullCriterionTextMatched = criterionMarker.length > 0 && content.includes(criterionMarker);
    const covered = markerMatched && criterionAssertionMatched;
    const reasons = [];
    if (!markerMatched) reasons.push(`missing AC marker (${assertionMessageMarkers.join(' or ')}) in executable assertion message or nearby story-bound block marker`);
    if (!criterionAssertionMatched) reasons.push('executable assertions do not reference acceptance-criterion text, token, or local static binding');
    return {
      block_index: blockIndex + 1,
      line_start: block.line_start,
      line_end: block.line_end,
      test_name: block.test_name,
      covered,
      story_marker_matched: storyMarkerMatched,
      assertion_marker_matched: assertionMarkerMatched,
      full_criterion_text_matched: fullCriterionTextMatched,
      criterion_assertion_matched: criterionAssertionMatched,
      assertion_text_samples: extractAssertionCoverageTexts(block.text).map((text) => compactDiagnosticText(text)).slice(0, 5),
      reasons
    };
  });
  return {
    path: candidate.path,
    executable: true,
    covered: blockDiagnostics.some((block) => block.covered),
    blocks: blockDiagnostics
  };
}

function summarizeE2eCandidateDiagnostic(analysis) {
  return {
    path: analysis.path,
    executable: analysis.executable,
    reasons: analysis.reasons ?? [],
    blocks: (analysis.blocks ?? [])
      .filter((block) => block.covered || block.reasons.length > 0)
      .slice(0, 8)
  };
}

function e2eCandidateCoversScenario(candidate, storyId, clause, index) {
  const markers = scenarioCoverageMarkers(storyId, clause?.id, index);
  const statementMarker = normalizeCoverageText(clause?.statement);
  return getExecutableE2eBlocks(candidate.content).some((block) => {
    const content = normalizeCoverageText(block);
    return statementMarker.length > 0
      && (content.includes(statementMarker) || blockHasCriterionAssertion(block, clause.statement))
      && markers.some((marker) => marker.length > 0 && content.includes(marker))
      && blockHasCriterionAssertion(block, clause.statement);
  });
}

function scenarioCoverageMarkers(storyId, clauseId, index) {
  const normalizedClauseId = String(clauseId ?? '').trim();
  const withoutLeadingZeros = normalizedClauseId.replace(/^([A-Za-z]+)-0+(\d+)$/, '$1-$2');
  return [
    `${storyId} ${normalizedClauseId}`,
    `${storyId} ${withoutLeadingZeros}`,
    `${storyId} scenario:${index + 1}`,
    `${storyId} scenario-${index + 1}`,
    `${storyId} s:${index + 1}`,
    `${storyId} s-${index + 1}`,
    normalizedClauseId,
    withoutLeadingZeros,
    `scenario:${index + 1}`,
    `scenario-${index + 1}`,
    `s:${index + 1}`,
    `s-${index + 1}`
  ].map(normalizeCoverageText);
}

function blockHasCriterionAssertion(block, criterion) {
  const tokens = coverageAssertionTokens(criterion);
  if (tokens.length === 0) return hasExecutableE2eAssertionsInText(block);
  return extractAssertionCoverageTexts(block).some((text) => {
    const normalized = normalizeCoverageText(text);
    return tokens.some((token) => normalized.includes(token));
  });
}

function blockHasAssertionMessageMarker(block, markers) {
  return extractAssertionCoverageTexts(block).some((text) => {
    const normalized = normalizeCoverageText(text);
    return markers.some((marker) => marker.length > 0 && normalized.includes(marker));
  });
}

function coverageAssertionTokens(text) {
  const raw = String(text ?? '').toLowerCase();
  const ascii = raw.match(/[a-z0-9_:-]{4,}/g) ?? [];
  const japanese = raw.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}ー]{2,}/gu) ?? [];
  return [...new Set([...ascii, ...japanese])]
    .map(normalizeCoverageText)
    .filter((token) => token.length >= 2 && !['with', 'when', 'case', 'true', 'false', 'status', 'given', 'then', 'user', '場合'].includes(token))
    .slice(0, 12);
}

function extractAssertionCoverageTexts(block) {
  const statements = extractExecutableAssertionStatements(block);
  const bindings = extractLocalStringBindings(block);
  const texts = [];
  for (const statement of statements) {
    texts.push(statement);
    texts.push(...extractStringLiterals(statement));
    for (const [name, values] of bindings.entries()) {
      if (referencesBinding(statement, name)) texts.push(...values);
    }
  }
  return [...new Set(texts.map((text) => String(text ?? '').trim()).filter(Boolean))];
}

function extractExecutableAssertionStatements(block) {
  const original = String(block ?? '');
  const masked = maskJavaScriptStringsAndComments(original);
  const statements = [];
  const assertionPattern = /\b(?:expect\s*\(|assert\s*[.(])/g;
  for (const match of masked.matchAll(assertionPattern)) {
    let parenBalance = 0;
    let end = original.length;
    for (let index = match.index; index < masked.length; index += 1) {
      const char = masked[index];
      if (char === '(') parenBalance += 1;
      if (char === ')') parenBalance -= 1;
      if (parenBalance <= 0 && (char === ';' || char === '\n')) {
        end = char === ';' ? index + 1 : index;
        break;
      }
    }
    statements.push(original.slice(match.index, end).trim());
  }
  return [...new Set(statements.filter(Boolean))];
}

function extractLocalStringBindings(block) {
  const text = String(block ?? '');
  const masked = maskJavaScriptStringsAndComments(text);
  const bindings = new Map();
  const setBinding = (name, values) => {
    const cleanValues = values.map((value) => String(value ?? '').trim()).filter(Boolean);
    if (cleanValues.length === 0) return;
    bindings.set(name, [...new Set([...(bindings.get(name) ?? []), ...cleanValues])]);
  };
  const arrayPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\[([\s\S]*?)\]\s*;?/g;
  for (const match of masked.matchAll(arrayPattern)) {
    const arrayStart = masked.indexOf('[', match.index);
    const arrayEnd = match.index + match[0].lastIndexOf(']');
    setBinding(match[1], extractStringLiterals(text.slice(arrayStart + 1, arrayEnd)));
  }
  const stringPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2\s*;?/g;
  for (const match of masked.matchAll(stringPattern)) {
    const originalDeclaration = text.slice(match.index, match.index + match[0].length);
    setBinding(match[1], extractStringLiterals(originalDeclaration));
  }
  const aliasPattern = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)(?:\[(\d+)])?\s*;?/g;
  for (let pass = 0; pass < 2; pass += 1) {
    for (const match of masked.matchAll(aliasPattern)) {
      const sourceValues = bindings.get(match[2]);
      if (!sourceValues) continue;
      const index = match[3] === undefined ? null : Number(match[3]);
      setBinding(match[1], Number.isInteger(index) ? [sourceValues[index]].filter(Boolean) : sourceValues);
    }
  }
  return bindings;
}

function extractStringLiterals(text) {
  return [...String(text ?? '').matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)]
    .map((match) => match[2])
    .filter((value) => !value.includes('${'));
}

function referencesBinding(text, name) {
  return new RegExp(`\\b${escapeRegExp(name)}\\b`).test(String(text ?? ''));
}

function compactDiagnosticText(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function getExecutableE2eBlocks(content) {
  return getExecutableE2eBlockDetails(content).map((block) => block.text);
}

function getExecutableE2eBlockDetails(content) {
  const original = String(content ?? '');
  const masked = maskJavaScriptStringsAndComments(original);
  const blocks = [];
  const lineStarts = [0];
  for (let index = 0; index < original.length; index += 1) {
    if (original[index] === '\n') lineStarts.push(index + 1);
  }
  const lineForIndex = (charIndex) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineStarts[mid] <= charIndex) low = mid + 1;
      else high = mid - 1;
    }
    return high + 1;
  };
  const testPattern = /^\s*(?:test|it)(?:\.only)?\s*\(/gm;
  let consumedUntil = -1;
  for (const match of masked.matchAll(testPattern)) {
    const start = match.index;
    if (start < consumedUntil) continue;
    const openParen = masked.indexOf('(', start);
    if (openParen === -1) continue;
    let parenBalance = 0;
    let end = -1;
    for (let index = openParen; index < masked.length; index += 1) {
      const char = masked[index];
      if (char === '(') parenBalance += 1;
      if (char === ')') parenBalance -= 1;
      if (parenBalance === 0) {
        end = index + 1;
        break;
      }
    }
    if (end === -1) continue;
    consumedUntil = end;
    const text = original.slice(start, end);
    if (hasExecutableE2eAssertionsInText(maskJavaScriptStringsAndComments(text))) {
      blocks.push({
        text,
        line_start: lineForIndex(start),
        line_end: lineForIndex(Math.max(start, end - 1)),
        test_name: extractTestBlockName(text)
      });
    }
  }
  return blocks;
}

function maskJavaScriptStringsAndComments(value) {
  const text = String(value ?? '');
  let output = '';
  let state = 'code';
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] ?? '';
    if (state === 'line_comment') {
      if (char === '\n') {
        state = 'code';
        output += '\n';
      } else {
        output += ' ';
      }
      continue;
    }
    if (state === 'block_comment') {
      if (char === '*' && next === '/') {
        output += '  ';
        index += 1;
        state = 'code';
      } else {
        output += char === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      const quote = state === 'single' ? '\'' : state === 'double' ? '"' : '`';
      if (char === '\n') {
        output += '\n';
        escaped = false;
        continue;
      }
      output += char === quote && !escaped ? quote : ' ';
      if (char === quote && !escaped) {
        state = 'code';
      }
      escaped = char === '\\' && !escaped;
      if (char !== '\\') escaped = false;
      continue;
    }
    if (char === '/' && next === '/') {
      output += '  ';
      index += 1;
      state = 'line_comment';
      continue;
    }
    if (char === '/' && next === '*') {
      output += '  ';
      index += 1;
      state = 'block_comment';
      continue;
    }
    if (char === '\'') {
      output += char;
      state = 'single';
      escaped = false;
      continue;
    }
    if (char === '"') {
      output += char;
      state = 'double';
      escaped = false;
      continue;
    }
    if (char === '`') {
      output += char;
      state = 'template';
      escaped = false;
      continue;
    }
    output += char;
  }
  return output;
}

function extractTestBlockName(block) {
  const match = String(block ?? '').match(/^\s*(?:test|it)(?:\.only)?\s*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/);
  return match ? compactDiagnosticText(match[2]) : null;
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

function resolveStoryDocReferences(repoRoot, storySource, refs) {
  return refs
    .map((ref) => resolveStoryDocReference(repoRoot, storySource, ref))
    .filter(Boolean);
}

function resolveStoryDocReference(repoRoot, storySource, ref) {
  const raw = String(ref ?? '').trim();
  if (!raw) return null;
  const normalizedRaw = normalizeRepoPath(raw);
  const candidates = [];
  if (path.isAbsolute(raw)) {
    candidates.push(path.resolve(raw));
  } else {
    candidates.push(path.resolve(repoRoot, normalizedRaw));
    if (storySource?.path) {
      candidates.push(path.resolve(repoRoot, path.dirname(storySource.path), normalizedRaw));
    }
  }
  const insideCandidates = candidates.filter((candidate) => isPathInsideRepo(repoRoot, candidate));
  const existing = insideCandidates.find((candidate) => existsSync(candidate));
  const selected = existing ?? insideCandidates.at(-1);
  return {
    raw: normalizedRaw,
    path: selected ? normalizeRepoPath(path.relative(repoRoot, selected)) : normalizedRaw,
    exists: Boolean(existing)
  };
}

function isPathInsideRepo(repoRoot, candidate) {
  const relative = path.relative(repoRoot, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function readVisualQaRun(repoRoot, qaDir, qaId, git = null) {
  const files = await walkFiles(qaDir);
  const residualAnalysis = files.find((file) => path.basename(file) === 'residual-analysis.md') ?? null;
  const residualJsonFiles = files.filter((file) => /residual.*\.json$/i.test(path.basename(file)));
  if (!residualAnalysis && residualJsonFiles.length === 0) return null;
  const residuals = [];
  for (const file of residualJsonFiles) {
    try {
      const data = JSON.parse(await readFile(file, 'utf8'));
      const fileStat = await stat(file);
      const binding = git ? await resolveVerificationBinding(repoRoot, data.git_context ?? null, git) : null;
      residuals.push({
        path: toWorkspaceRelative(repoRoot, file),
        updated_at_ms: fileStat.mtimeMs,
        status: normalizeVisualResidualStatus(data.status),
        binding,
        git_context: data.git_context ?? null,
        thresholdPct: normalizeNumber(data.thresholdPct),
        probe_statuses: Array.isArray(data.probes)
          ? [...new Set(data.probes.map((probe) => normalizeVisualResidualStatus(probe?.status)).filter(Boolean))]
          : [],
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
  const residualStatus = run.latest_residual?.status;
  const probeStatuses = run.latest_residual?.probe_statuses ?? [];
  if (thresholdPct > DEFAULT_VISUAL_QA_THRESHOLD_PCT) return 'needs_review';
  if (residualStatus === 'baseline_updated' || probeStatuses.includes('baseline_updated')) return 'needs_review';
  if (residualStatus === 'baseline_missing' || probeStatuses.includes('baseline_missing')) return 'needs_review';
  if (residualStatus === 'current_missing' || residualStatus === 'needs_evidence' || probeStatuses.includes('current_missing')) return 'needs_review';
  if (residualStatus === 'needs_review' || probeStatuses.includes('needs_review')) return 'needs_review';
  if (run.latest_residual?.binding && run.latest_residual.binding.status !== 'current') return 'needs_review';
  const residual = run.latest_residual?.meanAbsResidualPct;
  const semantic = run.semantic_layout_residual_pct;
  if (residual != null && residual > thresholdPct) return 'needs_review';
  if (semantic != null && semantic > thresholdPct) return 'needs_review';
  return 'ready_for_review';
}

function normalizeVisualResidualStatus(value) {
  const status = String(value ?? '').trim();
  return status || null;
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

async function readTextSources(repoRoot, files = []) {
  const sources = [];
  for (const file of files) {
    try {
      sources.push({
        path: file,
        content: await readFile(path.join(repoRoot, file), 'utf8')
      });
    } catch {
      sources.push({ path: file, content: '' });
    }
  }
  return sources;
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
    problem: extractSectionText(content, ['問題', 'Problem', 'Pain']),
    root_cause: extractSectionText(content, ['根本原因', '原因', 'Root Cause', 'Cause']),
    solution: extractSectionText(content, ['解決', '解決策', 'Solution', 'Resolution']),
    policy: extractSectionText(content, ['方針', '実装方針', '実装戦略']),
    compatibility: extractSectionText(content, ['互換性', 'Compatibility', 'Compatibility Impact']),
    user_action: extractSectionText(content, ['利用者に必要な操作', '利用者操作', 'User Action', 'Migration']),
    impact_scope: extractImpactScopeStatement(content),
    acceptance_criteria: extractAcceptanceCriteria(content),
    related_stories: normalizeFrontmatterList(
      frontmatter.related_stories
        ?? frontmatter.related_story
        ?? frontmatter.related_story_ids
    ),
    architecture_docs: normalizeFrontmatterList(frontmatter.architecture_docs),
    spec_docs: normalizeFrontmatterList(frontmatter.spec_docs),
    pr_scope_strategy: frontmatter.pr_scope_strategy ?? null,
    pr_scope_reason: frontmatter.pr_scope_reason ?? null,
    pr_scope_review_facets: normalizeFrontmatterList(frontmatter.pr_scope_review_facets),
    pr_scope_dependency_boundaries: normalizeFrontmatterList(frontmatter.pr_scope_dependency_boundaries),
    architecture_reason: frontmatter.reason
      ?? extractFrontmatterBlockReason(content, 'architecture_docs')
      ?? extractArchitectureDecisionReason(content)
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
      result[currentBlock] = [];
      continue;
    }
    const listItem = currentBlock
      ? line.match(/^\s*-\s*(.+?)\s*$/)
      : null;
    if (listItem && currentBlock !== 'source') {
      result[currentBlock].push(listItem[1].replace(/^['"]|['"]$/g, ''));
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

function normalizeFrontmatterList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function compactStorySourceText(text, maxLength = 640) {
  const compacted = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!compacted || compacted.length <= maxLength) return compacted;
  const protectedTokenEnd = findProtectedStoryTokenEnd(compacted, maxLength);
  if (protectedTokenEnd) {
    return `${compacted.slice(0, protectedTokenEnd).trimEnd()}...`;
  }
  const boundary = compacted.lastIndexOf(' ', maxLength);
  const minimumBoundary = Math.floor(maxLength * 0.75);
  const cutAt = boundary >= minimumBoundary ? boundary : maxLength;
  return `${compacted.slice(0, cutAt).trimEnd()}...`;
}

function findProtectedStoryTokenEnd(text, maxLength) {
  const nearCutoffStart = Math.max(0, maxLength - 80);
  const tokenPattern = /\b(?:gate|story|DIJ|AC):[A-Za-z0-9_-]+/g;
  let match;
  while ((match = tokenPattern.exec(text))) {
    let end = match.index + match[0].length;
    if (text[end] === '`') end += 1;
    if (match.index >= nearCutoffStart && match.index < maxLength && end > maxLength) {
      return end;
    }
  }
  return null;
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
      .replace(/\s+/g, ' ');
    const summary = compactStorySourceText(paragraph);
    if (summary) return summary;
  }
  return null;
}

function extractImpactScopeStatement(content) {
  const source = String(content ?? '');
  const tokenMatch = source.match(/impact_scope_explained\s*[:：]\s*(.+?)(?:\n\s*\n|\n#|$)/is);
  if (tokenMatch) {
    const statement = compactStorySourceText(tokenMatch[1].replace(/\s+/g, ' '));
    if (statement) return statement;
  }
  return extractSectionText(source, ['影響範囲', 'Impact Scope', 'Impact範囲', 'Scope of Impact']);
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
    .replace(/\s+/g, ' ');
  return compactStorySourceText(paragraph) || null;
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
    .filter(Boolean);
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

function extractArchitectureDecisionReason(content) {
  const section = extractRawSection(content, ['Architecture Decision', 'Architecture', 'ADR', 'アーキテクチャ判断']);
  const text = section ?? content;
  const match = text.match(/\b(?:ADR[-_ ]?unnecessary|ADR不要)\s*:?\s*([^\n]+)/i);
  if (!match) return null;
  return match[1].trim().replace(/^[-:]\s*/, '').slice(0, 500) || 'Story declares ADR-unnecessary';
}

function pickPrimaryStory(storyDocs, story) {
  return storyDocs.find((doc) => doc.story_id === story.story_id)
    ?? storyDocs.find((doc) => doc.vibepro_story_id === story.story_id)
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
  const storySlug = canonicalStoryBindingSlug(story.story_id);
  const relatedStorySlugs = normalizeFrontmatterList(doc.related_stories)
    .map(canonicalStoryBindingSlug)
    .filter(Boolean);
  if (storySlug && relatedStorySlugs.includes(storySlug)) return true;
  if (normalizeFrontmatterList(doc.related_stories).includes(story.story_id)) return true;
  const docSlugs = [
    doc.story_id,
    doc.vibepro_story_id,
    doc.path?.split('/').pop()?.replace(/\.[^.]+$/, '')
  ].map(canonicalStoryBindingSlug).filter(Boolean);
  if (storySlug && docSlugs.includes(storySlug)) return true;
  if (doc.title && doc.title === story.title) return true;
  if (doc.requirement_title && doc.requirement_title === story.title) return true;
  return false;
}

function canonicalStoryBindingSlug(value) {
  const slug = slugifyStoryId(value ?? '');
  return slug
    .replace(/^story-/, '')
    .replace(/^str-\d+-/, '')
    .replace(/^us-\d+-/, '')
    .replace(/^bug-\d+-/, '');
}

function buildStorySourceIntegrity(story, storySource, changedStoryDocs = []) {
  const changedDocs = changedStoryDocs
    .filter((doc) => doc?.path && !isCanonicalAuditSnapshotPath(doc.path))
    .map((doc) => ({
      path: doc.path,
      story_id: doc.story_id ?? null,
      vibepro_story_id: doc.vibepro_story_id ?? null,
      title: doc.title ?? doc.requirement_title ?? null,
      related_stories: normalizeFrontmatterList(doc.related_stories),
      matches_selected_story: storyDocMatchesStory(doc, story)
    }));
  const mismatchedChangedDocs = changedDocs.filter((doc) => !doc.matches_selected_story);
  const sourceMatches = storyDocMatchesStory(storySource, story);
  const sourceMismatch = Boolean(storySource?.path) && !sourceMatches;
  const changedDocMismatch = mismatchedChangedDocs.length > 0;
  const status = sourceMismatch || changedDocMismatch ? 'story_source_mismatch' : 'passed';
  const reasons = [];
  if (sourceMismatch) {
    reasons.push(`resolved Story source ${storySource.path} does not match selected Story ${story.story_id}`);
  }
  if (changedDocMismatch) {
    reasons.push(`changed Story doc(s) do not match selected Story ${story.story_id}: ${mismatchedChangedDocs.map((doc) => doc.path).join(', ')}`);
  }
  return {
    schema_version: '0.1.0',
    status,
    selected_story_id: story.story_id,
    selected_story_title: story.title ?? null,
    source: storySource?.path ? {
      path: storySource.path,
      story_id: storySource.story_id ?? null,
      vibepro_story_id: storySource.vibepro_story_id ?? null,
      title: storySource.title ?? storySource.requirement_title ?? null,
      matches_selected_story: sourceMatches
    } : null,
    changed_story_docs: changedDocs,
    mismatched_changed_story_docs: mismatchedChangedDocs,
    required_actions: status === 'passed' ? [] : [
      'Select the Story that matches the changed Story document, or move the unrelated Story document to a separate PR.',
      'Add story_id/vibepro_story_id frontmatter or rename the Story document so it clearly binds to the selected Story.',
      'Rerun `vibepro pr prepare` before using the PR body as review evidence.'
    ],
    reason: status === 'passed'
      ? 'Resolved and changed Story documents match the selected Story, or no changed Story document needs binding.'
      : reasons.join('; ')
  };
}

function isCanonicalAuditSnapshotPath(filePath) {
  return normalizeGraphPath(filePath ?? '').startsWith('docs/management/audit-artifacts/');
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

function buildArchitectureAxisQuality({ engineeringJudgment = null, architectureDecision = '', architectureSources = [], decisionRecords = null } = {}) {
  const activeAxes = (engineeringJudgment?.judgment_axes ?? []).filter((axis) => axis.status !== 'inactive');
  const architectureText = [
    architectureDecision,
    ...architectureSources.map((source) => source.content ?? '')
  ].join('\n').toLowerCase();
  const sourceRefs = architectureSources.map((source) => source.path);
  const acceptedFollowups = (decisionRecords?.decisions ?? [])
    .filter((decision) => decision.status === 'accepted')
    .filter((decision) => /follow|waiver|architecture|rollback|compat|boundary|scope/i.test(`${decision.type ?? ''} ${decision.source ?? ''} ${decision.summary ?? ''} ${decision.reason ?? ''}`));
  const fieldMatchers = {
    alternatives_considered: /\b(alternative|alternatives|option|trade[- ]?off|rejected|considered)\b|代替|比較|選択肢/,
    compatibility_impact: /\b(compat|compatibility|api|cli|schema|contract|default|migration|version skew|backward)\b|互換|契約|移行/,
    rollback_plan: /\b(rollback|roll back|revert|downgrade|feature gate|rollout|disabled behavior)\b|ロールバック|戻す/,
    boundary: /\b(boundary|trust|blast radius|scope|owner|graphify|impact|side effect)\b|境界|影響範囲|責務/,
    accepted_followups: /\b(follow[- ]?ups?|accepted followups?|waiver|defer|tracked|non[- ]?blocking)\b|後続|保留|許容/
  };
  const evaluations = activeAxes.map((axis) => {
    const requiredFields = requiredArchitectureFieldsForAxis(axis.axis);
    const missingFields = requiredFields.filter((field) => {
      if (field === 'accepted_followups' && acceptedFollowups.length > 0) return false;
      return !fieldMatchers[field]?.test(architectureText);
    });
    return {
      axis: axis.axis,
      status: missingFields.length === 0 ? 'covered' : 'needs_review',
      required_fields: requiredFields,
      missing_fields: missingFields,
      sources: sourceRefs,
      reason: missingFields.length === 0
        ? `${axis.axis} architecture quality fields are represented in architecture decision sources`
        : `${axis.axis} architecture decision is missing: ${missingFields.join(', ')}`
    };
  });
  const missingFieldCount = evaluations.reduce((count, item) => count + item.missing_fields.length, 0);
  return {
    status: missingFieldCount === 0 ? 'covered' : 'needs_review',
    active_axis_count: activeAxes.length,
    missing_field_count: missingFieldCount,
    evaluations,
    reason: missingFieldCount === 0
      ? 'Active judgment axes have architecture decision quality coverage'
      : 'Active judgment axes have missing architecture decision quality fields'
  };
}

function requiredArchitectureFieldsForAxis(axis) {
  if (axis === 'scope_reviewability') return ['boundary', 'accepted_followups'];
  if (axis === 'release_ops') return ['compatibility_impact', 'rollback_plan', 'accepted_followups'];
  if (axis === 'security_boundary') return ['boundary', 'alternatives_considered', 'accepted_followups'];
  if (axis === 'ux_surface') return ['compatibility_impact', 'boundary', 'accepted_followups'];
  return ['alternatives_considered', 'compatibility_impact', 'rollback_plan', 'boundary', 'accepted_followups'];
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

const FLOW_AC_KEYWORDS = ['checkout', 'onboarding', 'wizard', 'multi-step', 'flow', 'purchase', 'signup'];

function extractFlowKeywords(acceptanceCriteria) {
  if (!Array.isArray(acceptanceCriteria)) return [];
  const hits = new Set();
  for (const criterion of acceptanceCriteria) {
    const text = String(criterion ?? '').toLowerCase();
    for (const keyword of FLOW_AC_KEYWORDS) {
      if (text.includes(keyword)) hits.add(keyword);
    }
  }
  return [...hits];
}

function collectChangedFileItems(fileGroups) {
  if (!fileGroups || typeof fileGroups !== 'object') return [];
  const buckets = [
    'source',
    'tests',
    'architecture_docs',
    'specifications',
    'policy_docs',
    'responsibility_authority_metadata',
    'contract_metadata',
    'repo_control',
    'other'
  ];
  const items = [];
  const seen = new Set();
  for (const bucket of buckets) {
    const groupItems = Array.isArray(fileGroups[bucket]?.items)
      ? fileGroups[bucket].items
      : (fileGroups[bucket]?.files ?? []).map((path) => ({ path }));
    for (const item of groupItems) {
      if (!item?.path || seen.has(item.path)) continue;
      seen.add(item.path);
      items.push({
        path: item.path,
        status: item.status,
        content: item.content
      });
    }
  }
  return items;
}

function extractPathFromDiagramReason(signal) {
  const text = String(signal ?? '');
  const match = text.match(/(?:^|:\s+| in )((?:docs|src|test|tests|packages|services|infra|prisma|db|migrations|contracts|\.github)\/\S+)/);
  return match?.[1] ?? null;
}

function minimalDiagramShape(kind) {
  if (kind === 'threat_model') {
    return {
      kind,
      mermaid: [
        'flowchart LR',
        '  Actor[Actor] --> Surface[Changed authority or contract surface]',
        '  Surface --> Asset[Protected asset]',
        '  Threat[Threat] --> Surface',
        '  Surface --> Control[Control or mitigation]'
      ].join('\n')
    };
  }
  return {
    kind,
    mermaid: 'flowchart LR\n  ChangedSurface[Changed surface] --> RequiredDiagram[Required diagram evidence]'
  };
}

function buildDownstreamDiagramRequirementHints({ gate, storyId }) {
  const missing = new Set(gate?.missing_diagrams ?? []);
  if (missing.size === 0) return [];
  return (gate?.detection_reasons ?? [])
    .filter((reason) => missing.has(reason.kind))
    .map((reason) => {
      const triggerPath = extractPathFromDiagramReason(reason.signal);
      return {
        kind: reason.kind,
        trigger_path: triggerPath,
        trigger_signal: reason.signal,
        insertion_target: storyId
          ? `.vibepro/spec/${storyId}/spec.json diagrams[]`
          : '.vibepro/spec/<story-id>/spec.json diagrams[]',
        tracked_spec_guidance: storyId
          ? `docs/specs/${storyId}.md diagrams section`
          : 'tracked spec doc diagrams section',
        minimal_diagram: minimalDiagramShape(reason.kind)
      };
    });
}

function formatDownstreamDiagramRequirementHint(hint) {
  const trigger = hint.trigger_path ?? hint.trigger_signal ?? 'changed file';
  const firstLine = String(hint.minimal_diagram?.mermaid ?? '').split('\n')[0] || '<mermaid>';
  return `${hint.kind} triggered by ${trigger}; insert at ${hint.insertion_target} or ${hint.tracked_spec_guidance}; minimal diagram starts with \`${firstLine}\``;
}

async function readDesignDiagramSpec(repoRoot, { storyId, storySource = null, inferredSpec = null } = {}) {
  const specs = [];
  if (inferredSpec) specs.push(inferredSpec);
  for (const ref of resolveDesignDiagramSpecRefs(storyId, storySource)) {
    const spec = await readTrackedDesignDiagramSpec(repoRoot, ref);
    if (spec) specs.push(spec);
  }
  const diagrams = [];
  const seen = new Set();
  for (const spec of specs) {
    for (const diagram of Array.isArray(spec?.diagrams) ? spec.diagrams : []) {
      if (!diagram?.kind || seen.has(diagram.kind)) continue;
      seen.add(diagram.kind);
      diagrams.push(diagram);
    }
  }
  if (diagrams.length === 0) return inferredSpec;
  return {
    ...(inferredSpec ?? { schema_version: '0.1.0', story_id: storyId }),
    diagrams
  };
}

function resolveDesignDiagramSpecRefs(storyId, storySource = null) {
  const refs = new Set();
  for (const ref of storySource?.spec_docs ?? []) refs.add(normalizeRepoRelativePath(ref));
  if (storyId) {
    refs.add(`docs/specs/${storyId}.spec.json`);
    refs.add(`docs/specs/${storyId}.json`);
    refs.add(`docs/specs/${storyId}.md`);
  }
  return [...refs].filter(Boolean);
}

function normalizeRepoRelativePath(ref) {
  if (!ref) return null;
  return String(ref).replace(/\\/g, '/').replace(/^\.\//, '');
}

async function readTrackedDesignDiagramSpec(repoRoot, ref) {
  const normalized = normalizeRepoRelativePath(ref);
  if (!normalized || normalized.includes('..')) return null;
  const fullPath = path.join(repoRoot, normalized);
  try {
    const content = await readFile(fullPath, 'utf8');
    if (normalized.endsWith('.json')) return JSON.parse(content);
    if (normalized.endsWith('.md') || normalized.endsWith('.markdown')) {
      const diagrams = extractMarkdownSpecDiagrams(content);
      return diagrams.length > 0 ? { diagrams } : null;
    }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  return null;
}

function extractMarkdownSpecDiagrams(content) {
  const diagrams = [];
  const pattern = /^###\s+([A-Za-z0-9_-]+)[^\n]*\n+```mermaid\n([\s\S]*?)```/gm;
  for (const match of content.matchAll(pattern)) {
    diagrams.push({
      kind: match[1],
      mermaid: match[2].trim()
    });
  }
  return diagrams;
}

function buildDesignDiagramsGate({ storySource, fileGroups, inferredSpec }) {
  const acceptanceCriteria = Array.isArray(storySource?.acceptance_criteria) ? storySource.acceptance_criteria : [];
  const story = {
    ac_count: acceptanceCriteria.length,
    ac_keywords: extractFlowKeywords(acceptanceCriteria)
  };
  const code_diff = {
    files: collectChangedFileItems(fileGroups),
    deps_added: []
  };
  const requirement = resolveRequiredDiagrams({ story, code_diff });
  const verdict = evaluateDesignDiagramsGate({
    required_diagrams: requirement.required_diagrams,
    reasons: requirement.reasons,
    spec: inferredSpec ?? null
  });
  const downstreamRequirements = buildDownstreamDiagramRequirementHints({
    gate: {
      missing_diagrams: verdict.missing,
      detection_reasons: verdict.reasons
    },
    storyId: storySource?.story_id
  });
  let gateStatus;
  let reasonText;
  if (verdict.status === 'blocked') {
    gateStatus = 'needs_evidence';
    reasonText = `必須設計図が不足: ${verdict.missing.join(', ')} (spec.diagrams[] に該当 kind を追加してください)`;
  } else if (verdict.status === 'pass') {
    gateStatus = 'satisfied';
    reasonText = `必須設計図が全て揃っている (${verdict.provided.join(', ')})`;
  } else {
    gateStatus = 'not_required';
    reasonText = '該当する設計図トリガーなし';
  }
  return {
    id: 'gate:design_diagrams',
    type: 'design_diagrams_gate',
    label: 'Design Diagrams (MUST-HAVE)',
    status: gateStatus,
    required: verdict.status !== 'not_applicable',
    blocking: true,
    reason: reasonText,
    required_diagrams: verdict.required,
    provided_diagrams: verdict.provided,
    missing_diagrams: verdict.missing,
    detection_reasons: verdict.reasons,
    downstream_diagram_requirements: downstreamRequirements,
    required_actions: downstreamRequirements.length > 0
      ? downstreamRequirements.map(formatDownstreamDiagramRequirementHint)
      : []
  };
}

function buildSpecGateNode({ repoRoot, fileGroups, inferredSpec, specDrift, storySource }) {
  const driftHighCount = Array.isArray(specDrift?.items)
    ? specDrift.items.filter((item) => item.severity === 'high').length
    : 0;
  const storySpecDocRefs = resolveStoryDocReferences(repoRoot, storySource, storySource?.spec_docs ?? []);
  const missingStorySpecDocs = storySpecDocRefs.filter((ref) => !ref.exists);
  const explicitSpecDocs = [...new Set([
    ...storySpecDocRefs.filter((ref) => ref.exists).map((ref) => ref.path),
    ...(fileGroups.specifications?.files ?? [])
  ].filter(Boolean))];
  if (missingStorySpecDocs.length > 0) {
    return {
      id: 'spec',
      type: 'spec_gate',
      label: 'Spec Gate',
      status: 'needs_evidence',
      reason: `explicit Spec docs are missing or unresolved (${formatFileList(missingStorySpecDocs.map((ref) => ref.raw))})`,
      spec_docs: explicitSpecDocs,
      missing_spec_docs: missingStorySpecDocs.map((ref) => ({
        raw: ref.raw,
        resolved_path: ref.path
      })),
      inferred_spec: inferredSpec ? {
        story_id: inferredSpec.story_id,
        clauses: Array.isArray(inferredSpec.clauses) ? inferredSpec.clauses.length : 0,
        generated_at: inferredSpec.generated_at ?? null
      } : null,
      drift: specDrift?.summary ?? null
    };
  }
  if (explicitSpecDocs.length > 0) {
    const status = driftHighCount > 0 ? 'needs_review' : 'present';
    const reason = driftHighCount > 0
      ? `explicit Spec docs are present (${formatFileList(explicitSpecDocs)}) but severity=high drift exists (${driftHighCount})`
      : `explicit Spec docs are present (${formatFileList(explicitSpecDocs)})`;
    return {
      id: 'spec',
      type: 'spec_gate',
      label: 'Spec Gate',
      status,
      reason,
      spec_docs: explicitSpecDocs,
      inferred_spec: inferredSpec ? {
        story_id: inferredSpec.story_id,
        clauses: Array.isArray(inferredSpec.clauses) ? inferredSpec.clauses.length : 0,
        generated_at: inferredSpec.generated_at ?? null
      } : null,
      drift: specDrift?.summary ?? null
    };
  }
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

function buildPrRouteClassification({ git = {}, fileGroups = {}, scope = null, changeClassification = null }) {
  const files = Object.values(fileGroups).flatMap((group) => group?.files ?? []);
  const commitText = (git.commits ?? [])
    .map((commit) => commit.subject ?? commit.message ?? commit.body ?? '')
    .join('\n')
    .toLowerCase();
  const fileText = files.join('\n').toLowerCase();
  const signals = [];
  const route = {
    route_type: 'general_change',
    label: 'General Change',
    confidence: 0.55,
    body_template: 'standard_story_review',
    required_gates: ['story', 'architecture', 'spec', 'pr_body_contract'],
    signals
  };

  const setRoute = (routeType, label, confidence, bodyTemplate, requiredGates, routeSignals) => {
    route.route_type = routeType;
    route.label = label;
    route.confidence = confidence;
    route.body_template = bodyTemplate;
    route.required_gates = requiredGates;
    signals.push(...routeSignals);
  };

  if (/\b(release|deploy)\b.*\b(merge|promote|rollout)\b/.test(commitText)) {
    setRoute(
      'release_merge',
      'Release Merge',
      0.8,
      'release_traceability_review',
      ['source_pr_or_commit', 'ci_status_or_waiver', 'split_resolution', 'pr_body_contract'],
      ['commit_message:release_merge']
    );
  } else if (/^\s*(sync|mirror)(\(.+\))?:/m.test(commitText) || /\b(sync|mirror)\b.*\b(upstream|release|deploy|main|production)\b/.test(commitText)) {
    setRoute(
      'mirror_sync',
      'Mirror Sync',
      0.78,
      'mirror_traceability_review',
      ['source_pr_or_commit', 'ci_status_or_waiver', 'artifact_policy', 'pr_body_contract'],
      ['commit_or_path:sync_or_mirror']
    );
  } else if ((fileGroups.repo_control?.count ?? 0) > 0) {
    setRoute(
      'config_or_agent_policy',
      'Config / Agent Policy',
      0.74,
      'policy_boundary_review',
      ['repo_control_boundary', 'split_resolution', 'pr_body_contract'],
      ['file_group:repo_control']
    );
  } else if ((fileGroups.source?.count ?? 0) > 0 && hasUiExperienceSourceChange(fileGroups)) {
    setRoute(
      'design_or_ui_change',
      'Design / UI Change',
      changeClassification?.profile === 'workflow_heavy' ? 0.82 : 0.72,
      'ui_experience_review',
      ['visual_qa', 'design_quality', 'story', 'pr_body_contract'],
      ['file_group:ui_source']
    );
  } else if ((fileGroups.source?.count ?? 0) > 0) {
    setRoute(
      'runtime_change',
      'Runtime Change',
      changeClassification?.profile === 'workflow_heavy' ? 0.84 : 0.7,
      'runtime_contract_review',
      ['story', 'spec', 'verification', 'pr_body_contract'],
      ['file_group:source']
    );
  } else if ((fileGroups.tests?.count ?? 0) > 0) {
    setRoute(
      'test_only',
      'Test Only',
      0.68,
      'test_evidence_review',
      ['test_intent', 'pr_body_contract'],
      ['file_group:tests']
    );
  } else if (files.length > 0 && files.every((file) => isDocumentationPath(file))) {
    setRoute(
      'docs_only',
      'Docs Only',
      0.76,
      'documentation_decision_review',
      ['story_or_doc_intent', 'pr_body_contract'],
      ['file_group:docs_only']
    );
  }

  if ((fileGroups.vibepro_artifacts?.count ?? 0) > 0) {
    route.required_gates = [...new Set([...route.required_gates, 'artifact_policy'])];
    signals.push('file_group:vibepro_artifacts');
  }
  if (scope?.status === 'needs_clean_branch') {
    route.required_gates = [...new Set([...route.required_gates, 'split_resolution'])];
    signals.push('scope:needs_clean_branch');
  }
  if (changeClassification?.profile === 'workflow_heavy') {
    route.required_gates = [...new Set([...route.required_gates, 'workflow_heavy'])];
    signals.push('risk_profile:workflow_heavy');
  }

  return route;
}

function isDocumentationPath(filePath) {
  return /^docs\//.test(filePath)
    || /^README(\.[a-z]+)?\.md$/i.test(filePath)
    || /^CHANGELOG(\.[a-z]+)?\.md$/i.test(filePath)
    || /^NOTICE(\.[a-z]+)?$/i.test(filePath)
    || /\.mdx?$/i.test(filePath);
}

function buildPrRouteGate(prRoute) {
  return {
    id: 'gate:pr_route_classification',
    type: 'pr_route_gate',
    label: 'PR Route Classification Gate',
    status: prRoute?.route_type ? 'passed' : 'needs_review',
    required: true,
    route_type: prRoute?.route_type ?? 'unknown',
    body_template: prRoute?.body_template ?? null,
    confidence: prRoute?.confidence ?? null,
    required_gates: prRoute?.required_gates ?? [],
    signals: prRoute?.signals ?? [],
    reason: prRoute?.route_type
      ? `PR route selected: ${prRoute.route_type}; body template: ${prRoute.body_template}`
      : 'PR route could not be classified'
  };
}

function buildEngineeringJudgmentClassification({
  fileGroups = {},
  storySource = {},
  changeClassification = null,
  prRoute = null,
  networkContracts = null,
  scope = null,
  graphContext = null,
  codeTopologyContext = null,
  verificationEvidence = null,
  decisionRecords = null,
  inferredSpec = null,
  agentReviews = null
} = {}) {
  const files = Object.values(fileGroups).flatMap((group) => group?.files ?? []);
  const text = [
    storySource?.title,
    storySource?.requirement_title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? []),
    ...files
  ].filter(Boolean).join('\n').toLowerCase();
  const readOnlyUsageReportingChange = isReadOnlyUsageReportingChange(fileGroups);
  const route = {
    route_type: 'general_engineering',
    label: 'General Engineering',
    confidence: 0.5,
    route_dag: 'general_engineering_dag',
    signals: []
  };
  const setRoute = (routeType, label, confidence, routeDag, signals) => {
    route.route_type = routeType;
    route.label = label;
    route.confidence = confidence;
    route.route_dag = routeDag;
    route.signals.push(...signals);
  };

  const releaseSignal = /\b(release|deploy|publish|appcast|notariz|rollout|rollback)\b|リリース|デプロイ/.test(text)
    || ['release_merge', 'mirror_sync'].includes(prRoute?.route_type);
  const agentWorkflowSignal = !readOnlyUsageReportingChange && (
    /\b(agent|subagent|review|gate|dag|skill|mcp|codex|claude|graphify)\b|エージェント/.test(text)
    || changeClassification?.risk_surfaces?.includes('gate_orchestration')
    || changeClassification?.risk_surfaces?.includes('review_lifecycle')
  );
  if (readOnlyUsageReportingChange) {
    setRoute('developer_tool', 'Developer Tool', 0.74, 'developer_tool_dag', ['surface:read_only_audit_reporting']);
  } else if (['release_merge', 'mirror_sync'].includes(prRoute?.route_type) || (releaseSignal && !agentWorkflowSignal)) {
    setRoute('release_engineering', 'Release Engineering', 0.84, 'release_engineering_dag', ['route:release_or_mirror']);
  } else if (agentWorkflowSignal) {
    setRoute('agent_workflow', 'AI Agent Workflow', 0.82, 'agent_workflow_dag', ['surface:agent_or_gate_workflow']);
  } else if (/\b(auth|permission|security|secret|oauth|saml|rbac|acl|middleware)\b|権限|認証|監査/.test(text)
    || changeClassification?.risk_surfaces?.includes('auth_boundary')) {
    setRoute('security_trust', 'Security / Trust', 0.82, 'security_trust_dag', ['surface:auth_or_security']);
  } else if (/\b(migration|schema|database|db|prisma|repository|backfill|etl|pipeline)\b|移行|データ|集計/.test(text)
    || changeClassification?.risk_surfaces?.includes('database_state')) {
    setRoute('data_pipeline', 'Data / Migration', 0.8, 'data_migration_dag', ['surface:data_or_migration']);
  } else if (/\b(customer|invoice|billing|contract|approval|order|inventory|reservation|tenant|workflow)\b|業務|顧客|請求|契約|承認|在庫|予約/.test(text)) {
    setRoute('business_system', 'Business System', 0.78, 'business_system_dag', ['domain:business_workflow']);
  } else if (prRoute?.route_type === 'design_or_ui_change' || hasUiExperienceSourceChange(fileGroups)) {
    setRoute('ui_ux_modernization', 'UI / UX Modernization', 0.76, 'ui_ux_modernization_dag', ['surface:ui_ux']);
  } else if (/\b(cli|daemon|doctor|config|install|cache|local|tool|developer)\b/.test(text)) {
    setRoute('developer_tool', 'Developer Tool', 0.74, 'developer_tool_dag', ['surface:developer_tool']);
  } else if ((networkContracts?.introduced_api_client_call_count ?? 0) > 0 || changeClassification?.risk_surfaces?.includes('server_api')) {
    setRoute('api_platform', 'API Platform', 0.72, 'api_platform_dag', ['surface:api_contract']);
  } else if ((fileGroups.repo_control?.count ?? 0) > 0) {
    setRoute('infra_ops', 'Infra / Ops', 0.7, 'infra_ops_dag', ['surface:repo_control']);
  } else if (prRoute?.route_type === 'docs_only') {
    setRoute('knowledge_docs', 'Knowledge / Docs', 0.68, 'knowledge_docs_dag', ['surface:docs_only']);
  }

  if (changeClassification?.profile) route.signals.push(`risk_profile:${changeClassification.profile}`);
  const judgmentAxes = buildSeniorJudgmentAxes({
    route,
    fileGroups,
    storySource,
    changeClassification,
    prRoute,
    networkContracts,
    scope,
    graphContext,
    codeTopologyContext,
    verificationEvidence,
    decisionRecords,
    inferredSpec,
    agentReviews
  });
  const activeAxes = judgmentAxes.filter((axis) => axis.status !== 'inactive');
  return {
    schema_version: '0.1.0',
    ...route,
    judgment_axes: judgmentAxes,
    active_axis_count: activeAxes.length,
    active_axes: activeAxes.map((axis) => axis.axis),
    common_spine: [
      'intent',
      'current_reality',
      'invariants',
      'domain_or_system_model',
      'boundary',
      'risk_classification',
      'route_dag_selection',
      'evidence_requirements',
      'implementation_plan',
      'verification',
      'human_decision_contract',
      'release_or_operation'
    ]
  };
}

async function recordAndAttachJudgmentAxisNoisePrecedents(repoRoot, {
  storyId,
  engineeringJudgment,
  decisionRecords = null
} = {}) {
  const workspaceDir = getWorkspaceDir(repoRoot);
  const ledgerPath = path.join(workspaceDir, 'judgment-axis-noise-precedents.json');
  const existing = await readJsonIfExists(ledgerPath) ?? {
    schema_version: '0.1.0',
    model: 'vibepro-judgment-axis-noise-precedent-ledger-v1',
    entries: []
  };
  const entries = Array.isArray(existing.entries) ? existing.entries : [];
  const byFingerprint = new Map(entries.map((entry) => [entry.fingerprint, entry]));
  const axes = engineeringJudgment?.judgment_axes ?? [];
  for (const axis of axes) {
    const fingerprint = buildJudgmentAxisNoiseFingerprint(axis);
    axis.activation_precision.prior_noise_precedents = byFingerprint.has(fingerprint)
      ? [summarizeJudgmentAxisNoisePrecedent(byFingerprint.get(fingerprint))]
      : [];
  }
  const acceptedDecisions = (decisionRecords?.decisions ?? [])
    .filter((decision) => decision.status === 'accepted' && /^gate:judgment_axis_/.test(decision.source ?? ''));
  let changed = false;
  for (const decision of acceptedDecisions) {
    const axisName = String(decision.source).replace(/^gate:judgment_axis_/, '');
    const axis = axes.find((item) => item.axis === axisName);
    if (!axis) continue;
    const fingerprint = buildJudgmentAxisNoiseFingerprint(axis);
    if (byFingerprint.has(fingerprint)) continue;
    const entry = {
      fingerprint,
      axis: axis.axis,
      story_id: storyId,
      decision_id: decision.decision_id ?? null,
      source: decision.source,
      reason: decision.reason ?? decision.summary ?? null,
      artifact: decision.artifact ?? null,
      activation_candidates: axis.activation_candidates ?? [],
      activation_precision_status: axis.activation_precision?.status ?? null,
      recorded_at: new Date().toISOString(),
      note: 'Advisory precedent only; matching this fingerprint never auto-closes future gates.'
    };
    entries.push(entry);
    byFingerprint.set(fingerprint, entry);
    axis.activation_precision.prior_noise_precedents = [summarizeJudgmentAxisNoisePrecedent(entry)];
    changed = true;
  }
  if (changed) {
    await mkdir(path.dirname(ledgerPath), { recursive: true });
    await writeFile(ledgerPath, `${JSON.stringify({
      schema_version: '0.1.0',
      model: 'vibepro-judgment-axis-noise-precedent-ledger-v1',
      entries
    }, null, 2)}\n`);
  }
  return {
    schema_version: '0.1.0',
    status: 'advisory',
    artifact: toWorkspaceRelative(repoRoot, ledgerPath),
    entry_count: entries.length,
    matched_count: axes.reduce((sum, axis) => sum + (axis.activation_precision?.prior_noise_precedents?.length ?? 0), 0),
    auto_close: false
  };
}

function buildJudgmentAxisNoiseFingerprint(axis) {
  return [
    axis.axis,
    ...(axis.activation_candidates ?? []).map((signal) => String(signal)).sort()
  ].join('|');
}

function summarizeJudgmentAxisNoisePrecedent(entry) {
  return {
    fingerprint: entry.fingerprint,
    story_id: entry.story_id ?? null,
    decision_id: entry.decision_id ?? null,
    source: entry.source ?? null,
    reason: entry.reason ?? null,
    artifact: entry.artifact ?? null,
    recorded_at: entry.recorded_at ?? null,
    auto_close: false
  };
}

function buildDesignInputJudgmentContext({
  latestStoryRun = null,
  latestEvidence = null,
  engineeringJudgment = null,
  changeClassification = null,
  fileGroups = {}
} = {}) {
  const evidenceJudgment = latestEvidence?.design_input_judgment ?? null;
  const evidencePhase = latestEvidence?.diagnosis_phase?.phase ?? null;
  const runJudgment = latestStoryRun?.design_input_judgment ?? null;
  const runPhase = latestStoryRun?.phase ?? null;
  const hasDesignInputRun = runPhase === 'design_input';
  const hasDesignInputEvidenceArtifact = evidencePhase === 'design_input' && Boolean(evidenceJudgment);
  const present = hasDesignInputRun && hasDesignInputEvidenceArtifact;
  const runRecordedWithoutEvidence = hasDesignInputRun && !hasDesignInputEvidenceArtifact;
  return {
    schema_version: '0.1.0',
    phase: 'design_input',
    status: present ? 'present' : 'missing',
    source: present ? 'story_diagnosis' : runRecordedWithoutEvidence ? 'story_diagnosis_artifact_missing' : 'not_recorded',
    run_id: hasDesignInputRun ? latestStoryRun?.run_id ?? latestEvidence?.run_id ?? null : null,
    artifact_status: hasDesignInputEvidenceArtifact ? 'present' : hasDesignInputRun ? 'missing' : 'not_recorded',
    gate_status: present
      ? evidenceJudgment?.gate_status ?? runJudgment?.gate_status ?? latestStoryRun?.gate_status ?? null
      : null,
    finding_count: present
      ? evidenceJudgment?.finding_count ?? latestEvidence?.findings?.length ?? runJudgment?.finding_count ?? null
      : null,
    route_type: engineeringJudgment?.route_type ?? null,
    route_dag: engineeringJudgment?.route_dag ?? null,
    active_axes: engineeringJudgment?.active_axes ?? [],
    expected_before: ['architecture', 'spec'],
    applies_to: {
      workflow_heavy: changeClassification?.profile === 'workflow_heavy',
      architecture_or_spec_changed: ((fileGroups.architecture_docs?.count ?? 0) + (fileGroups.specifications?.count ?? 0)) > 0,
      cross_surface: isCrossSurfaceDesignStory(fileGroups)
    },
    required_actions: present ? [] : [
      runRecordedWithoutEvidence
        ? 'Regenerate the missing design-input diagnosis evidence artifact with `vibepro story diagnose . --id <story-id> --pre-architecture --run-graphify` before finalizing Architecture or Spec.'
        : 'Run `vibepro story diagnose . --id <story-id> --pre-architecture --run-graphify` before finalizing Architecture or Spec.'
    ]
  };
}

function buildPreImplementationJudgmentContext({
  latestStoryRun = null,
  latestEvidence = null,
  engineeringJudgment = null
} = {}) {
  const evidenceJudgment = latestEvidence?.pre_implementation_judgment ?? null;
  const evidencePhase = latestEvidence?.diagnosis_phase?.phase ?? null;
  const runJudgment = latestStoryRun?.pre_implementation_judgment ?? null;
  const runPhase = latestStoryRun?.phase ?? null;
  const hasPreImplementationRun = runPhase === 'pre_implementation';
  const hasPreImplementationEvidenceArtifact = evidencePhase === 'pre_implementation' && Boolean(evidenceJudgment);
  const present = hasPreImplementationRun && hasPreImplementationEvidenceArtifact;
  const runRecordedWithoutEvidence = hasPreImplementationRun && !hasPreImplementationEvidenceArtifact;
  return {
    schema_version: '0.1.0',
    phase: 'pre_implementation',
    status: present ? 'present' : 'missing',
    source: present ? 'story_diagnosis_artifact' : runRecordedWithoutEvidence ? 'story_diagnosis_artifact_missing' : 'not_recorded',
    run_id: hasPreImplementationRun ? latestStoryRun?.run_id ?? latestEvidence?.run_id ?? null : null,
    artifact_status: hasPreImplementationEvidenceArtifact ? 'present' : hasPreImplementationRun ? 'missing' : 'not_recorded',
    gate_status: present
      ? evidenceJudgment?.gate_status ?? runJudgment?.gate_status ?? latestStoryRun?.gate_status ?? null
      : null,
    finding_count: present
      ? evidenceJudgment?.finding_count ?? latestEvidence?.findings?.length ?? runJudgment?.finding_count ?? null
      : null,
    route_type: engineeringJudgment?.route_type ?? null,
    route_dag: engineeringJudgment?.route_dag ?? null,
    active_axes: engineeringJudgment?.active_axes ?? [],
    feeds: present ? evidenceJudgment?.feeds ?? runJudgment?.feeds ?? [] : [],
    required_actions: present ? [] : [
      runRecordedWithoutEvidence
        ? 'Regenerate the missing pre-implementation diagnosis evidence artifact with `vibepro story diagnose . --id <story-id> --run-graphify` before treating PR readiness as reviewed.'
        : 'Run `vibepro story diagnose . --id <story-id> --run-graphify` before treating PR readiness as reviewed.'
    ]
  };
}

function isCrossSurfaceDesignStory(fileGroups = {}) {
  const contractDocs = (fileGroups.story_docs?.count ?? 0)
    + (fileGroups.architecture_docs?.count ?? 0)
    + (fileGroups.specifications?.count ?? 0)
    + (fileGroups.policy_docs?.count ?? 0);
  const implementationSurfaces = (fileGroups.source?.count ?? 0)
    + (fileGroups.tests?.count ?? 0)
    + (fileGroups.repo_control?.count ?? 0);
  return contractDocs > 0 && implementationSurfaces > 0;
}

function isReadOnlyUsageReportingChange(fileGroups = {}) {
  const sourceFiles = fileGroups.source?.files ?? [];
  if (sourceFiles.length === 0) return false;
  const readOnlyReportSources = new Set([
    'src/evidence-reuse.js',
    'src/senior-gap-judgment.js',
    'src/usage-report.js'
  ]);
  return sourceFiles.every((file) => readOnlyReportSources.has(file));
}

function buildSeniorJudgmentAxes({
  route,
  fileGroups = {},
  storySource = {},
  changeClassification = null,
  prRoute = null,
  networkContracts = null,
  scope = null,
  graphContext = null,
  codeTopologyContext = null,
  verificationEvidence = null,
  decisionRecords = null,
  inferredSpec = null,
  agentReviews = null
} = {}) {
  const files = Object.values(fileGroups).flatMap((group) => group?.files ?? []);
  const text = [
    storySource?.title,
    storySource?.requirement_title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? []),
    ...(inferredSpec?.clauses ?? []).map((clause) => clause.text ?? clause.statement ?? ''),
    ...files
  ].filter(Boolean).join('\n').toLowerCase();
  const riskSurfaces = new Set(changeClassification?.risk_surfaces ?? []);
  const signalsByAxis = new Map(JUDGMENT_AXIS_DEFINITIONS.map((axis) => [axis.axis, []]));
  const addSignal = (axis, signal) => signalsByAxis.get(axis)?.push(signal);
  const fileText = files.join('\n').toLowerCase();
  const sourceCount = fileGroups.source?.count ?? 0;
  const testCount = fileGroups.tests?.count ?? 0;
  const architectureDocCount = fileGroups.architecture_docs?.count ?? 0;
  const specDocCount = fileGroups.specifications?.count ?? 0;
  const contractDocCount = (fileGroups.story_docs?.count ?? 0) + architectureDocCount + specDocCount + (fileGroups.policy_docs?.count ?? 0);
  const changedFileCount = scope?.changed_file_count ?? files.length;

  if ((networkContracts?.introduced_api_client_call_count ?? 0) > 0) addSignal('public_contract', 'network_contract:introduced_api_client_call');
  if (codeTopologyContext?.signals?.includes('code_topology:routes')) addSignal('public_contract', 'code_topology:routes');
  if (['runtime_change', 'design_or_ui_change', 'docs_only', 'config_or_agent_policy', 'test_only'].includes(prRoute?.route_type)) addSignal('public_contract', `pr_route:${prRoute.route_type}`);
  if (contractDocCount > 0) addSignal('public_contract', 'file_group:contract_docs');
  if (/\b(api|cli|config|schema|output|format|contract|compat|default|docs?|readme|pr body|public)\b|互換|契約|仕様|出力/.test(text)) addSignal('public_contract', 'text:public_contract');

  if (['release_merge', 'mirror_sync'].includes(prRoute?.route_type)) addSignal('rollback_sensitive', `pr_route:${prRoute.route_type}`);
  if (/\b(feature[-_ ]?gate|feature[-_ ]?flag|rollout|rollback|downgrade|migration|schema|release|deploy)\b/.test(fileText)
    || riskSurfaces.has('database_state')
    || riskSurfaces.has('deploy')) addSignal('rollback_sensitive', 'changed_surface:rollback_or_rollout');

  if (route?.route_type === 'security_trust' || riskSurfaces.has('auth_boundary') || riskSurfaces.has('security') || riskSurfaces.has('auth')) addSignal('security_boundary', 'surface:security_or_auth');
  if (codeTopologyContext?.signals?.includes('code_topology:security')) addSignal('security_boundary', 'code_topology:security');
  if (/\b(auth|permission|security|secret|token|sandbox|namespace|rbac|acl|middleware)\b/.test(fileText)) addSignal('security_boundary', 'changed_path:security_boundary');

  if (route?.route_type === 'data_pipeline' || riskSurfaces.has('database_state') || riskSurfaces.has('persistence')) addSignal('data_state', 'surface:data_state');
  if (codeTopologyContext?.signals?.includes('code_topology:data_state')) addSignal('data_state', 'code_topology:data_state');
  if (/\b(database|db|migration|schema|cache|idempot|replay|query|orm|backfill|model|repository)\b/.test(fileText)) addSignal('data_state', 'changed_path:data_state');

  if (route?.route_type === 'agent_workflow' || riskSurfaces.has('gate_orchestration') || riskSurfaces.has('review_lifecycle') || riskSurfaces.has('core_workflow_state') || riskSurfaces.has('queue_worker')) addSignal('execution_topology', 'surface:workflow_or_agent');
  if (codeTopologyContext?.signals?.includes('code_topology:call_paths')) addSignal('execution_topology', 'code_topology:call_paths');
  if (/\b(workflow|agent|review|gate|queue|worker|retry)\b/.test((fileGroups.source?.files ?? []).join('\n').toLowerCase())) addSignal('execution_topology', 'changed_path:execution_topology');
  if (/\b(process|thread|worker|queue|agent|subagent|retry|deadlock|artifact lifecycle|orchestration|workflow|gate|dag|graphify)\b|エージェント|ワーカー|再試行|証跡/.test(text)) addSignal('execution_topology', 'text:execution_topology');

  if (prRoute?.route_type === 'design_or_ui_change' || hasUiExperienceSourceChange(fileGroups)) addSignal('ux_surface', 'surface:ui_source');
  if (/\b(ui|ux|layout|screen|screenshot|a11y|accessibility|navigation|breakpoint|page|component)\b/.test(fileText)) addSignal('ux_surface', 'changed_path:ux_surface');

  if (/\b(performance|latency|memory|benchmark|optimization|compiler|perf)\b/.test(fileText)
    || /\b(performance|latency|memory|benchmark|optimization)\b/.test(storySource?.title?.toLowerCase?.() ?? '')) addSignal('performance_semantic', 'changed_surface:performance_semantic');

  if (scope?.status && scope.status !== 'reviewable') addSignal('scope_reviewability', `scope:${scope.status}`);
  if (changedFileCount > Math.max(12, Math.ceil((scope?.reviewable_file_limit ?? DEFAULT_MAX_REVIEWABLE_FILES) / 2))) addSignal('scope_reviewability', `changed_files:${changedFileCount}`);
  if ((fileGroups.repo_control?.count ?? 0) > 0 && sourceCount + contractDocCount + testCount > 0) addSignal('scope_reviewability', 'mixed_surface:repo_control_with_product_change');
  if (graphContext?.available && (graphContext.related_file_count ?? 0) > 0) addSignal('scope_reviewability', 'graphify:related_files');
  if (codeTopologyContext?.signals?.includes('code_topology:related_files')) addSignal('scope_reviewability', 'code_topology:related_files');

  if (route?.route_type === 'release_engineering' || ['release_merge', 'mirror_sync'].includes(prRoute?.route_type)) addSignal('release_ops', 'route:release_engineering');
  if (/\b(release|deploy|rollout|rollback|observability|operator|runbook|alert|ci|workflow)\b/.test(fileText)) addSignal('release_ops', 'changed_path:release_ops');

  return JUDGMENT_AXIS_DEFINITIONS.map((definition) => {
    const activationCandidates = [...new Set(signalsByAxis.get(definition.axis) ?? [])];
    const precision = classifyAxisActivationPrecision(definition.axis, activationCandidates, {
      fileGroups,
      prRoute,
      changeClassification,
      codeTopologyContext,
      scope
    });
    const activationSignals = precision.active_signals;
    const active = precision.status === 'active';
    const evidence = classifySeniorAxisEvidence({
      axis: definition.axis,
      fileGroups,
      verificationEvidence,
      decisionRecords,
      graphContext,
      codeTopologyContext,
      scope,
      agentReviews
    });
    const matchedBlockers = active
      ? evaluateSeniorAxisBlockers(definition, {
        signals: activationSignals,
        evidence,
        fileGroups,
        prRoute,
        route,
        graphContext,
        codeTopologyContext,
        scope,
        storySource,
        verificationEvidence,
        decisionRecords,
        networkContracts
      })
      : [];
    const blockerWaiver = active
      ? findBlockerWaiverForSource(decisionRecords, `gate:judgment_axis_${definition.axis}`)
      : null;
    const status = active
      ? resolveSeniorAxisStatus(definition, evidence, { matchedBlockers, blockerWaiver })
      : 'inactive';
    return {
      axis: definition.axis,
      status,
      reason: active
        ? activationSignals.join('; ')
        : precision.reason,
      confidence: active ? calculateAxisConfidence(definition.confidence, activationSignals, graphContext) : 0,
      decision_question: definition.decision_question,
      required_evidence: definition.required_evidence,
      blocking_criteria: definition.blocking_criteria,
      acceptable_followup: definition.acceptable_followup,
      signals: activationSignals,
      activation_candidates: activationCandidates,
      activation_signals: activationSignals,
      activation_precision: {
        status: precision.status,
        reason: precision.reason,
        candidate_count: activationCandidates.length,
        non_text_signal_count: precision.non_text_signal_count,
        composition: precision.composition ?? null
      },
      matched_evidence: evidence.matched,
      optional_evidence: evidence.optional,
      missing_evidence: active ? missingSeniorAxisEvidenceKinds(definition, evidence.matched) : [],
      matched_blockers: matchedBlockers,
      blocker_waiver: blockerWaiver
        ? {
          decision_id: blockerWaiver.decision_id ?? null,
          source: blockerWaiver.source ?? null,
          status: blockerWaiver.status ?? null,
          artifact: blockerWaiver.artifact ?? null,
          reason: blockerWaiver.reason ?? null
        }
        : null,
      ignored_accepted_decision: evidence.ignored_accepted_decision
    };
  });
}

function classifyAxisActivationPrecision(axis, candidates = [], context = {}) {
  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  const composition = summarizeAxisActivationComposition(context);
  if (uniqueCandidates.length === 0) {
    return {
      status: 'no_signal',
      reason: `No ${axis} signal detected in Story, diff, PR route, risk surfaces, optional Graphify context, or optional code topology context`,
      active_signals: [],
      non_text_signal_count: 0,
      composition
    };
  }
  const nonTextSignals = uniqueCandidates.filter((signal) => isCorroboratingActivationSignal(axis, signal));
  if (nonTextSignals.length === 0) {
    return {
      status: 'insufficient_signal',
      reason: `${axis} has only text-derived candidates; suppressing activation until a changed-path, route, scope, docs, network-contract, or risk-surface corroboration exists`,
      active_signals: [],
      non_text_signal_count: 0,
      composition
    };
  }
  if (isDocUiCompositionPathOnlyAxisCandidate(axis, uniqueCandidates, nonTextSignals, composition)) {
    return {
      status: 'insufficient_signal',
      reason: `${axis} candidates came only from path/file-group signals in a docs/UI composition diff; suppressing activation until route, risk-surface, code-topology, scope, network-contract, source, or test evidence corroborates it`,
      active_signals: [],
      non_text_signal_count: nonTextSignals.length,
      composition
    };
  }
  if (axis === 'public_contract') {
    const corroboratingSignals = nonTextSignals.filter((signal) => /^(pr_route|file_group|network_contract|changed_path|code_topology):/.test(String(signal)));
    if (corroboratingSignals.length === 0) {
      return {
        status: 'insufficient_signal',
        reason: 'public_contract candidates were present, but no contract-correlated non-text signal was found',
        active_signals: [],
        non_text_signal_count: nonTextSignals.length,
        composition
      };
    }
  }
  return {
    status: 'active',
    reason: `${axis} activated from ${nonTextSignals.length} non-text corroborating signal(s)`,
    active_signals: uniqueCandidates,
    non_text_signal_count: nonTextSignals.length,
    composition
  };
}

function summarizeAxisActivationComposition({
  fileGroups = {},
  prRoute = null,
  changeClassification = null,
  codeTopologyContext = null,
  scope = null
} = {}) {
  const docsCount = (fileGroups.story_docs?.count ?? 0)
    + (fileGroups.architecture_docs?.count ?? 0)
    + (fileGroups.specifications?.count ?? 0)
    + (fileGroups.policy_docs?.count ?? 0);
  const sourceCount = fileGroups.source?.count ?? 0;
  const testCount = fileGroups.tests?.count ?? 0;
  const uiCount = (fileGroups.source?.files ?? []).filter((file) => isUiExperiencePath(file)).length;
  const codeTopologySignals = codeTopologyContext?.signals ?? [];
  const riskSurfaces = changeClassification?.risk_surfaces ?? [];
  return {
    docs_count: docsCount,
    source_count: sourceCount,
    test_count: testCount,
    ui_source_count: uiCount,
    route_type: prRoute?.route_type ?? null,
    risk_surface_count: riskSurfaces.length,
    code_topology_signal_count: codeTopologySignals.length,
    scope_status: scope?.status ?? null,
    docs_or_ui_composition_only: docsCount > 0
      && sourceCount === 0
      && testCount === 0
      && ['docs_only', 'design_or_ui_change'].includes(prRoute?.route_type ?? 'docs_only')
  };
}

function isUiExperiencePath(filePath) {
  return /(^|\/)(app|pages|components|ui|views|screens|routes)\//.test(String(filePath ?? ''))
    || /\.(tsx|jsx|css|scss|sass|less)$/.test(String(filePath ?? ''));
}

function isDocUiCompositionPathOnlyAxisCandidate(axis, candidates, nonTextSignals, composition) {
  const suppressibleAxes = new Set([
    'rollback_sensitive',
    'security_boundary',
    'data_state',
    'execution_topology',
    'ux_surface',
    'performance_semantic'
  ]);
  if (!suppressibleAxes.has(axis)) return false;
  if (!composition?.docs_or_ui_composition_only) return false;
  const strongPrefixes = /^(pr_route|risk_profile|code_topology|scope|network_contract|graphify|mixed_surface):/;
  if (candidates.some((signal) => strongPrefixes.test(String(signal)))) return false;
  return nonTextSignals.length > 0
    && nonTextSignals.every((signal) => /^(changed_path|file_group):/.test(String(signal)));
}

function isCorroboratingActivationSignal(axis, signal) {
  const normalized = String(signal ?? '');
  if (!normalized || normalized.startsWith('text:')) return false;
  if (normalized.startsWith('surface:')) return false;
  if (axis === 'public_contract' && normalized.startsWith('pr_route:')) return true;
  return true;
}

const JUDGMENT_AXIS_DEFINITIONS = [
  {
    axis: 'public_contract',
    confidence: 0.72,
    decision_question: 'この変更は外部利用者、CLI/API、設定、出力形式、またはPR本文契約を壊さないか。',
    required_evidence: ['story_spec_traceability', 'contract_doc', 'compat_or_output_test', 'current_verification'],
    blocking_criteria: ['public contract change lacks traceability or compatibility evidence', 'output/API/CLI behavior changed without reviewable old/new expectation'],
    acceptable_followup: 'Current behavior is backward-compatible and the remaining doc or cleanup item is bounded with an artifact or issue reference.'
  },
  {
    axis: 'rollback_sensitive',
    confidence: 0.78,
    decision_question: 'rollout、rollback、version skew、stored object、feature gateのどこで戻せなくなるか。',
    required_evidence: ['rollback_plan', 'feature_gate_disabled_behavior', 'upgrade_downgrade_test', 'decision_record', 'current_verification'],
    blocking_criteria: ['current release safety depends on an untested rollback path', 'stored or migrated state cannot be safely downgraded or replayed'],
    acceptable_followup: 'The shipped state is safe without the deferred work, and rollback or operator action is explicitly bounded.'
  },
  {
    axis: 'security_boundary',
    confidence: 0.82,
    decision_question: 'auth、permission、secret、sandbox、path access、trust boundaryを迂回できないか。',
    required_evidence: ['threat_model', 'negative_path_test', 'boundary_condition', 'security_review', 'current_verification'],
    blocking_criteria: ['trust boundary changed without negative-path evidence', 'secret/path/auth behavior depends on unchecked assumptions'],
    acceptable_followup: 'Only non-security cleanup remains; current trust boundary has negative-path or reviewer evidence.'
  },
  {
    axis: 'data_state',
    confidence: 0.78,
    decision_question: '永続状態、migration、query/cache、idempotency、replayで既存データを壊さないか。',
    required_evidence: ['migration_plan', 'rollback_plan', 'idempotency_test', 'query_semantics_test', 'current_verification'],
    blocking_criteria: ['persisted state changes without migration/rollback plan', 'retry or replay can corrupt state'],
    acceptable_followup: 'No current persisted state risk remains, and future cleanup is bounded to non-destructive data work.'
  },
  {
    axis: 'execution_topology',
    confidence: 0.8,
    decision_question: 'process/thread/worker/agent/gate/retry/artifact lifecycleのつながりでdeadlockや証跡欠落が起きないか。',
    required_evidence: ['topology_diagram', 'flow_replay', 'artifact_replay', 'agent_review', 'current_verification'],
    blocking_criteria: ['orchestration or artifact lifecycle changed without replay/review evidence', 'tool or agent side effects are not bounded'],
    acceptable_followup: 'Current topology is safe and observable; deferred work is a bounded diagram/doc improvement.'
  },
  {
    axis: 'ux_surface',
    confidence: 0.72,
    decision_question: 'ユーザーが見る導線、状態、アクセシビリティ、default-on/opt-outを壊さないか。',
    required_evidence: ['screenshot', 'visual_qa', 'accessibility_evidence', 'flow_replay', 'current_verification'],
    blocking_criteria: ['user-visible behavior changed without visual or flow evidence', 'empty/error/loading/focus states are unreviewed'],
    acceptable_followup: 'The visible path remains usable; deferred polish has screenshot or issue linkage.'
  },
  {
    axis: 'performance_semantic',
    confidence: 0.7,
    decision_question: 'performance改善やruntime/compiler意味変更が、速度だけでなく正しさも維持しているか。',
    required_evidence: ['benchmark_delta', 'perf_regression_guard', 'semantic_invariant_test', 'current_verification'],
    blocking_criteria: ['optimization changes semantics without invariant evidence', 'claimed performance improvement lacks comparable measurement'],
    acceptable_followup: 'Correctness is proven now; additional measurement is bounded and non-blocking.'
  },
  {
    axis: 'scope_reviewability',
    confidence: 0.74,
    decision_question: 'このPRは1人のreviewerが一貫した判断として読める粒度か、分割すべきか。',
    required_evidence: ['scope_reviewed', 'split_plan', 'review_owner_map', 'related_file_blast_radius', 'decision_record'],
    blocking_criteria: ['multiple unrelated decisions are bundled without split rationale', 'ownership or blast radius is unclear'],
    acceptable_followup: 'Current PR is coherent; separate cleanup is tracked without hiding required review ownership.'
  },
  {
    axis: 'release_ops',
    confidence: 0.76,
    decision_question: 'release note、operator action、observability、support/rollback導線が必要か。',
    required_evidence: ['release_note', 'rollout_plan', 'rollback_instruction', 'observability_evidence', 'current_verification'],
    blocking_criteria: ['operator/user action is required but not documented', 'release or rollback path lacks owner-visible evidence'],
    acceptable_followup: 'No current operator action is required, or action-required work is linked and safe to defer.'
  }
];

function classifySeniorAxisEvidence({
  axis,
  fileGroups = {},
  verificationEvidence = null,
  decisionRecords = null,
  graphContext = null,
  codeTopologyContext = null,
  scope = null,
  agentReviews = null
} = {}) {
  const currentVerification = (verificationEvidence?.commands ?? [])
    .filter((command) => command.binding?.status === 'current');
  const verificationMatches = currentVerification.flatMap((item) => classifyVerificationEvidenceItem(item));
  const matched = [];
  const optional = [
    ...classifyGraphImpactEvidence(graphContext),
    ...classifyCodeTopologyImpactEvidence(codeTopologyContext)
  ];
  const add = (kind, ref, extra = {}) => {
    if (!matched.some((item) => item.kind === kind && item.ref === ref)) {
      matched.push(buildEvidenceItem(kind, ref, extra));
    }
  };

  if ((fileGroups.story_docs?.count ?? 0) > 0 || (fileGroups.specifications?.count ?? 0) > 0) {
    add('story_spec_traceability', 'story/spec docs in diff', {
      strength: 'supporting',
      strength_reason: 'story/spec docs exist in the diff and provide traceability',
      binding_status: 'n/a',
      artifact_quality: 'story_doc'
    });
  }
  if ((fileGroups.architecture_docs?.count ?? 0) > 0 || (fileGroups.policy_docs?.count ?? 0) > 0 || (fileGroups.specifications?.count ?? 0) > 0) {
    add('contract_doc', 'architecture/policy/spec docs in diff', {
      strength: 'supporting',
      strength_reason: 'architecture/policy/spec docs are present for the changed contract surface',
      binding_status: 'n/a',
      artifact_quality: 'contract_doc'
    });
  }
  if ((fileGroups.architecture_docs?.count ?? 0) > 0 || (fileGroups.policy_docs?.count ?? 0) > 0) {
    add('topology_diagram', 'architecture docs in diff', {
      strength: 'supporting',
      strength_reason: 'architecture docs describe topology but are not replay proof',
      binding_status: 'n/a',
      artifact_quality: 'architecture_doc'
    });
  }
  if ((fileGroups.tests?.count ?? 0) > 0) {
    add('compat_or_output_test', 'test files in diff', {
      strength: 'supporting',
      strength_reason: 'changed tests signal intent but do not prove focused runtime coverage alone',
      binding_status: 'n/a',
      artifact_quality: 'changed_test_files'
    });
    add('semantic_invariant_test', 'test files in diff', {
      strength: 'supporting',
      strength_reason: 'changed tests indicate semantic coverage intent but remain indirect',
      binding_status: 'n/a',
      artifact_quality: 'changed_test_files'
    });
  }
  for (const item of verificationMatches) {
    add(item.kind, item.ref, item);
    add('current_verification', item.ref, item);
    if (item.kind === 'negative_path') add('negative_path_test', item.ref, item);
    if (item.kind === 'boundary_condition') add('boundary_condition', item.ref, item);
    if (item.kind === 'flow_replay') add('flow_replay', item.ref, item);
    if (item.kind === 'artifact_replay') add('artifact_replay', item.ref, item);
  }
  if (currentVerification.length > 0) add('current_verification', currentVerification[0].command ?? 'current verification', {
    strength: currentVerification[0].artifact ? 'strong' : 'supporting',
    strength_reason: currentVerification[0].artifact
      ? 'current verification includes a durable artifact'
      : 'current verification is bound to HEAD but lacks a durable artifact',
    binding_status: currentVerification[0].binding?.status ?? 'current',
    artifact_quality: currentVerification[0].artifact ? (currentVerification[0].artifact_check?.status ?? 'recorded') : 'missing_artifact',
    artifact: currentVerification[0].artifact ?? null
  });
  if (scope?.status === 'reviewable') add('scope_reviewed', 'scope.status=reviewable', {
    strength: 'supporting',
    strength_reason: 'scope classification says the current diff is reviewable',
    binding_status: 'derived',
    artifact_quality: 'scope_classification'
  });
  if (scope?.status === 'reviewable') add('split_plan', 'scope.status=reviewable', {
    strength: 'supporting',
    strength_reason: 'scope classification evaluated the split plan and found the current diff reviewable as one PR',
    binding_status: 'derived',
    artifact_quality: 'scope_classification'
  });
  if (scope?.status && scope.status !== 'reviewable') add('split_plan', scope.recommended_strategy ?? scope.status, {
    strength: 'supporting',
    strength_reason: 'scope classification recommends split planning',
    binding_status: 'derived',
    artifact_quality: 'scope_classification'
  });
  for (const item of optional) {
    add(item.kind, item.ref, item);
    if (axis === 'scope_reviewability' && ['graph_impact_scope', 'code_topology_impact_scope'].includes(item.kind)) {
      add('related_file_blast_radius', item.ref, {
        ...item,
        kind: 'related_file_blast_radius',
        strength_reason: `${item.kind} provides related-file blast radius for scope review`
      });
    }
  }
  if (axis === 'execution_topology' && hasAgentEvidenceLifecycle({ agentReviews, decisionRecords })) {
    add('agent_review', 'agent review summaries passed for required roles', {
      strength: 'strong',
      strength_reason: 'current-bound agent review lifecycle evidence is recorded for required roles',
      binding_status: 'current',
      artifact_quality: 'agent_review_artifact'
    });
  }
  if (axis === 'scope_reviewability' && hasAgentReviewOwnerMapEvidence(agentReviews)) {
    add('review_owner_map', 'agent review stage/role ownership map', {
      strength: 'supporting',
      strength_reason: 'agent review stages expose an ownership map for review responsibility',
      binding_status: 'current',
      artifact_quality: 'agent_review_artifact'
    });
  }

  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, `gate:judgment_axis_${axis}`);
  const acceptedFollowupDecision = isAcceptedAxisFollowupDecision(acceptedDecision) ? acceptedDecision : null;
  // An artifact-backed senior decision directly answers scope's split question
  // when automatic classification only flags a multi-commit coherent Story.
  // Keep this narrow: other axes must still supply their own evidence kinds.
  if (axis === 'scope_reviewability' && acceptedFollowupDecision && scope?.status !== 'reviewable') {
    add('scope_reviewed', acceptedFollowupDecision.decision_id ?? 'accepted scope review', {
      strength: 'supporting',
      strength_reason: 'artifact-backed accepted senior decision confirms this diff is one reviewable unit',
      binding_status: 'current',
      artifact_quality: 'decision_record',
      artifact: acceptedFollowupDecision.artifact
    });
  }
  if (acceptedFollowupDecision) {
    add(
      'decision_record',
      acceptedDecision.decision_id ?? acceptedDecision.summary ?? `gate:judgment_axis_${axis}`,
      {
        strength: 'supporting',
        strength_reason: 'accepted decision provides explicit follow-up rationale',
        binding_status: 'current',
        artifact_quality: 'decision_record',
        ...(acceptedDecision.artifact ? { artifact: acceptedDecision.artifact } : {})
      }
    );
    if (/rollback|rollout/i.test(acceptedDecision.summary ?? acceptedDecision.reason ?? '')) add('rollback_plan', acceptedDecision.summary ?? acceptedDecision.source);
    if (/release|operator|observability|rollout/i.test(acceptedDecision.summary ?? acceptedDecision.reason ?? '')) add('release_note', acceptedDecision.summary ?? acceptedDecision.source);
  }
  return {
    matched,
    optional,
    accepted_decision: acceptedFollowupDecision,
    ignored_accepted_decision: acceptedDecision && !acceptedFollowupDecision
      ? summarizeIgnoredAxisFollowupDecision(acceptedDecision)
      : null
  };
}

function resolveSeniorAxisStatus(definition, evidence, { matchedBlockers = [] } = {}) {
  const matchedKinds = new Set(evidence.matched.map((item) => item.kind));
  const missingEvidence = missingSeniorAxisEvidenceKinds(definition, evidence.matched);
  if (matchedBlockers.length > 0) {
    return 'active_blocked';
  }
  if (missingEvidence.length === 0) {
    return 'active_passed';
  }
  if (evidence.accepted_decision && matchedKinds.has('decision_record')) {
    return 'active_accepted_followup';
  }
  return 'active_needs_evidence';
}

function calculateAxisConfidence(base, signals, graphContext) {
  const graphBoost = graphContext?.available && (graphContext.matched_file_count ?? 0) > 0 ? 0.04 : 0;
  const signalBoost = Math.min(0.12, Math.max(0, signals.length - 1) * 0.04);
  return Math.min(0.95, Number((base + signalBoost + graphBoost).toFixed(2)));
}

function buildEngineeringJudgmentRouteGate(engineeringJudgment) {
  return {
    id: 'gate:engineering_judgment_route',
    type: 'engineering_judgment_route_gate',
    label: 'Engineering Judgment Route Gate',
    status: engineeringJudgment?.route_type ? 'passed' : 'needs_review',
    required: true,
    route_type: engineeringJudgment?.route_type ?? 'unknown',
    route_dag: engineeringJudgment?.route_dag ?? null,
    confidence: engineeringJudgment?.confidence ?? null,
    signals: engineeringJudgment?.signals ?? [],
    reason: engineeringJudgment?.route_type
      ? `Engineering judgment route selected: ${engineeringJudgment.route_type}; DAG=${engineeringJudgment.route_dag}`
      : 'Engineering judgment route could not be classified'
  };
}

function buildDesignInputJudgmentGate({
  designInputJudgment = null,
  changeClassification = null,
  fileGroups = {},
  engineeringJudgment = null
} = {}) {
  const applies = shouldExpectDesignInputJudgment({ changeClassification, fileGroups, engineeringJudgment });
  const present = designInputJudgment?.status === 'present';
  return {
    id: 'gate:design_input_judgment',
    type: 'design_input_judgment_gate',
    label: 'Design Input Judgment Gate',
    status: present ? 'passed' : applies ? 'needs_review' : 'not_required',
    required: false,
    phase: designInputJudgment?.phase ?? 'design_input',
    run_id: designInputJudgment?.run_id ?? null,
    expected_before: designInputJudgment?.expected_before ?? ['architecture', 'spec'],
    applies_to: designInputJudgment?.applies_to ?? {},
    reason: present
      ? `Design-input diagnosis was recorded before PR readiness: ${designInputJudgment.run_id ?? 'unknown run'}`
      : applies
        ? 'Workflow-heavy or cross-surface Architecture/Spec work should record design-input diagnosis before Architecture/Spec are treated as settled.'
        : 'Design-input diagnosis is optional for this change surface.',
    required_actions: present || !applies
      ? []
      : designInputJudgment?.required_actions ?? [
          'Run `vibepro story diagnose . --id <story-id> --pre-architecture --run-graphify` and regenerate PR evidence.'
        ]
  };
}

function shouldExpectDesignInputJudgment({ changeClassification = null, fileGroups = {}, engineeringJudgment = null } = {}) {
  if (changeClassification?.profile === 'workflow_heavy') return true;
  if (isCrossSurfaceDesignStory(fileGroups)) return true;
  const hasDesignDocs = ((fileGroups.architecture_docs?.count ?? 0) + (fileGroups.specifications?.count ?? 0)) > 0;
  const executionAxisActive = (engineeringJudgment?.active_axes ?? []).includes('execution_topology');
  return hasDesignDocs && (engineeringJudgment?.route_type === 'agent_workflow' || executionAxisActive);
}

function buildJudgmentAxisGates(engineeringJudgment) {
  const axes = (engineeringJudgment?.judgment_axes ?? [])
    .filter((axis) => axis.status !== 'inactive');
  return axes.map((axis) => {
    const validBlockerWaiver = isAcceptedBlockerWaiver(axis.blocker_waiver);
    return {
      id: `gate:judgment_axis_${axis.axis}`,
      type: 'judgment_axis_gate',
      label: `Judgment Axis: ${axis.axis}`,
      status: axis.status === 'active_blocked' && validBlockerWaiver
        ? 'accepted_followup'
        : mapJudgmentAxisStatusToGateStatus(axis.status),
      axis_status: axis.status,
      required: true,
      axis: axis.axis,
      confidence: axis.confidence,
      decision_question: axis.decision_question,
      required_evidence: axis.required_evidence,
      blocking_criteria: axis.blocking_criteria,
      acceptable_followup: axis.acceptable_followup,
      signals: axis.signals ?? [],
      matched_evidence: axis.matched_evidence ?? [],
      optional_evidence: axis.optional_evidence ?? [],
      missing_evidence: axis.missing_evidence ?? [],
      matched_blockers: axis.matched_blockers ?? [],
      blocker_waiver: axis.blocker_waiver ?? null,
      blocker_waiver_valid: validBlockerWaiver,
      blocker_waiver_missing_fields: validBlockerWaiver ? [] : summarizeBlockerWaiverMissingFields(axis.blocker_waiver),
      reason: buildJudgmentAxisGateReason(axis)
    };
  });
}

function mapJudgmentAxisStatusToGateStatus(status) {
  if (status === 'active_passed') return 'passed';
  if (status === 'active_accepted_followup') return 'accepted_followup';
  if (status === 'active_blocked') return 'block';
  if (status === 'active_needs_evidence') return 'needs_evidence';
  return 'not_required';
}

function buildJudgmentAxisGateReason(axis) {
  const prefix = `${axis.axis}: ${axis.decision_question}`;
  const blockerSummary = (axis.matched_blockers ?? [])
    .map((item) => `${item.id}:${item.criterion} / support=${item.supporting_evidence.join('|') || 'none'} / unresolved=${item.unresolved_counter_evidence.join('|') || 'none'}`)
    .join('; ');
  if (axis.status === 'active_passed') {
    return `${prefix} Evidence matched: ${(axis.matched_evidence ?? []).map((item) => item.kind).join(', ') || 'none'}.`;
  }
  if (axis.status === 'active_accepted_followup') {
    return `${prefix} Missing evidence accepted as a bounded follow-up: ${(axis.missing_evidence ?? []).join(', ') || 'none'}. ${axis.acceptable_followup}`;
  }
  if (axis.status === 'active_needs_evidence') {
    return `${prefix} Missing evidence: ${(axis.missing_evidence ?? []).join(', ') || axis.required_evidence.join(', ')}.`;
  }
  if (axis.status === 'active_blocked') {
    if (isAcceptedBlockerWaiver(axis.blocker_waiver)) {
      return `${prefix} Blocking criteria matched but explicitly waived: ${blockerSummary || (axis.blocking_criteria ?? []).join('; ')}. Waiver=${axis.blocker_waiver.decision_id ?? axis.blocker_waiver.source ?? 'accepted waiver'} / artifact=${axis.blocker_waiver.artifact ?? 'none'}.`;
    }
    if (axis.blocker_waiver) {
      const missingFields = summarizeBlockerWaiverMissingFields(axis.blocker_waiver);
      return `${prefix} Blocking criteria matched: ${blockerSummary || (axis.blocking_criteria ?? []).join('; ')}. Ignored blocker waiver missing ${missingFields.join(', ') || 'required metadata'}.`;
    }
    return `${prefix} Blocking criteria matched: ${blockerSummary || (axis.blocking_criteria ?? []).join('; ')}`;
  }
  return `${axis.axis}: inactive`;
}

function isAcceptedBlockerWaiver(waiver) {
  return Boolean(
    waiver
    && waiver.status === 'accepted'
    && String(waiver.decision_id ?? '').trim()
    && String(waiver.reason ?? '').trim()
    && String(waiver.artifact ?? '').trim()
  );
}

function isAcceptedAxisFollowupDecision(decision) {
  if (!decision || decision.status !== 'accepted') return false;
  return Boolean(String(decision.reason ?? '').trim() && String(decision.artifact ?? '').trim());
}

function findBlockerWaiverForSource(decisionRecords, source) {
  const decisions = Array.isArray(decisionRecords?.decisions) ? decisionRecords.decisions : [];
  const candidates = decisions.filter((decision) => (
    decision.source === source
    && decision.type === 'waiver'
  ));
  return candidates.find((decision) => isAcceptedBlockerWaiver(decision)) ?? candidates[0] ?? null;
}

function summarizeBlockerWaiverMissingFields(waiver) {
  if (!waiver) return [];
  return [
    String(waiver.decision_id ?? '').trim() ? null : 'decision_id',
    String(waiver.reason ?? '').trim() ? null : 'reason',
    String(waiver.artifact ?? '').trim() ? null : 'artifact',
    waiver.status === 'accepted' ? null : 'status=accepted'
  ].filter(Boolean);
}

function summarizeIgnoredAxisFollowupDecision(decision) {
  return {
    decision_id: decision.decision_id ?? null,
    source: decision.source ?? null,
    status: decision.status ?? null,
    missing_fields: [
      String(decision.decision_id ?? '').trim() ? null : 'decision_id',
      String(decision.reason ?? '').trim() ? null : 'reason',
      String(decision.artifact ?? '').trim() ? null : 'artifact'
    ].filter(Boolean),
    reason: 'accepted axis follow-up decisions require decision_id, reason, and artifact before they can cover missing evidence'
  };
}

function evaluateSeniorAxisBlockers(definition, context = {}) {
  const matchedKinds = new Set((context.evidence?.matched ?? []).map((item) => item.kind));
  const missingEvidence = missingSeniorAxisEvidenceKinds(definition, context.evidence?.matched ?? []);
  const supportingEvidence = (kinds) => kinds.filter((kind) => matchedKinds.has(kind));
  const unresolvedCounterEvidence = (kinds) => kinds.filter((kind) => missingEvidence.includes(kind));
  const sourceCount = context.fileGroups?.source?.count ?? 0;
  const verificationCommands = Array.isArray(context.verificationEvidence?.commands)
    ? context.verificationEvidence.commands.filter((item) => item.binding?.status === 'current')
    : [];
  const genericOnlyVerification = verificationCommands.length > 0
    && verificationCommands.every((item) => isGenericVerificationCommand(item.command));
  const signalSet = new Set(context.signals ?? []);
  const blockers = [];
  const addBlocker = (id, criterion, supportKinds = [], counterKinds = []) => {
    blockers.push({
      id,
      criterion,
      supporting_evidence: supportingEvidence(supportKinds),
      unresolved_counter_evidence: unresolvedCounterEvidence(counterKinds)
    });
  };

  if (definition.axis === 'public_contract') {
    const publicSurfaceChanged = sourceCount > 0
      || (context.networkContracts?.introduced_api_client_call_count ?? 0) > 0
      || [...signalSet].some((signal) => signal.startsWith('pr_route:') && signal !== 'pr_route:docs_only');
    if (publicSurfaceChanged && unresolvedCounterEvidence(['story_spec_traceability', 'contract_doc']).length > 0) {
      addBlocker(
        'public_contract_traceability_missing',
        'public contract change lacks traceability or compatibility evidence',
        ['current_verification'],
        ['story_spec_traceability', 'contract_doc']
      );
    }
    if (publicSurfaceChanged && unresolvedCounterEvidence(['compat_or_output_test']).length > 0 && genericOnlyVerification) {
      addBlocker(
        'public_contract_expectation_unreviewed',
        'output/API/CLI behavior changed without reviewable old/new expectation',
        ['current_verification'],
        ['compat_or_output_test']
      );
    }
  }

  if (definition.axis === 'security_boundary') {
    const authBoundaryChanged = signalSet.has('surface:security_or_auth')
      || signalSet.has('changed_path:security_boundary');
    if (authBoundaryChanged && unresolvedCounterEvidence(['negative_path_test', 'boundary_condition']).length > 0) {
      addBlocker(
        'security_boundary_negative_path_missing',
        'trust boundary changed without negative-path evidence',
        ['current_verification'],
        ['negative_path_test', 'boundary_condition']
      );
    }
  }

  if (definition.axis === 'release_ops') {
    const operatorFacingChange = signalSet.has('route:release_engineering')
      || signalSet.has('changed_path:release_ops');
    if (operatorFacingChange && unresolvedCounterEvidence(['release_note', 'rollback_instruction']).length > 0) {
      addBlocker(
        'release_ops_operator_path_missing',
        'operator/user action is required but not documented',
        ['current_verification'],
        ['release_note', 'rollback_instruction']
      );
    }
    if (operatorFacingChange && unresolvedCounterEvidence(['observability_evidence', 'rollback_instruction']).length > 0) {
      addBlocker(
        'release_ops_owner_visible_evidence_missing',
        'release or rollback path lacks owner-visible evidence',
        ['current_verification'],
        ['observability_evidence', 'rollback_instruction']
      );
    }
  }

  return blockers;
}

function buildCommonJudgmentSpineGate(engineeringJudgment, evidenceContext = {}) {
  const subchecks = buildCommonJudgmentSpineSubchecks(engineeringJudgment, evidenceContext);
  const missing = subchecks.filter((check) => isUnresolvedGateStatus(check.status));
  const status = missing.length === 0 ? 'passed' : 'needs_evidence';
  return {
    id: 'gate:common_judgment_spine',
    type: 'engineering_judgment_spine_gate',
    label: 'Common Judgment Spine Gate',
    status,
    required: true,
    spine: engineeringJudgment?.common_spine ?? [],
    subchecks,
    missing_subchecks: missing.map((check) => check.id),
    reason: status === 'passed'
      ? 'Intent, current reality, invariants, boundaries, failure modes, and done evidence have enough evidence for this route profile'
      : `Common judgment spine is missing evidence for: ${missing.map((check) => `${check.id}=${check.status}`).join(', ')}`
  };
}

function buildCommonJudgmentSpineSubchecks(engineeringJudgment, {
  storySource = null,
  fileGroups = null,
  verificationEvidence = null,
  inferredSpec = null,
  changeClassification = null,
  agentReviews = null,
  decisionRecords = null,
  prRoute = null,
  graphContext = null,
  codeTopologyContext = null
} = {}) {
  const acceptanceCount = storySource?.acceptance_criteria?.length ?? 0;
  const storyHasIntent = Boolean(storySource?.title || storySource?.requirement_title || storySource?.background || acceptanceCount > 0);
  const changedFileCount = Object.values(fileGroups ?? {})
    .filter((group) => Array.isArray(group?.files))
    .reduce((count, group) => count + group.files.length, 0);
  const currentVerification = (verificationEvidence?.commands ?? []).filter((command) => command.binding?.status === 'current');
  const acceptedDecisions = (decisionRecords?.decisions ?? []).filter((decision) => decision.status === 'accepted');
  const reviewPassCount = (agentReviews?.stages ?? [])
    .flatMap((stage) => stage.roles ?? [])
    .filter((role) => role.effective_status === 'pass')
    .length;
  const specClauseCount = Array.isArray(inferredSpec?.clauses) ? inferredSpec.clauses.length : 0;
  const hasExplicitSpecOrArchitecture = (fileGroups?.specifications?.count ?? 0) > 0 || (fileGroups?.architecture_docs?.count ?? 0) > 0;
  const hasTests = (fileGroups?.tests?.count ?? 0) > 0;
  const riskSurfaces = new Set(changeClassification?.risk_surfaces ?? []);
  const routeType = engineeringJudgment?.route_type ?? 'general_engineering';
  const documentationOnlyRoute = prRoute?.route_type === 'docs_only';
  const surfaceProfile = deriveJudgmentSurfaceProfile({
    routeType,
    prRoute,
    fileGroups,
    changeClassification,
    storySource,
    inferredSpec
  });
  const evidenceMatches = classifyJudgmentEvidence({
    currentVerification,
    surfaceProfile,
    fileGroups,
    storySource,
    inferredSpec,
    graphContext,
    codeTopologyContext
  });
  const highRisk = !documentationOnlyRoute && (
    changeClassification?.profile === 'workflow_heavy'
    || ['business_system', 'data_pipeline', 'security_trust', 'release_engineering', 'api_platform', 'infra_ops', 'agent_workflow'].includes(routeType)
    || ['api_contract', 'auth', 'security', 'database', 'persistence', 'runtime_behavior', 'deploy'].some((surface) => riskSurfaces.has(surface))
  );
  const boundarySensitive = highRisk
    || (!documentationOnlyRoute && (routeType === 'agent_workflow' || riskSurfaces.has('gate_orchestration')));
  const currentRealityRequirement = requiredEvidenceForJudgmentSubcheck('current_reality', surfaceProfile);
  const failureModesRequirement = requiredEvidenceForJudgmentSubcheck('failure_modes', surfaceProfile);
  const doneEvidenceRequirement = requiredEvidenceForJudgmentSubcheck('done_evidence', surfaceProfile);
  const docsRequirement = requiredEvidenceForJudgmentSubcheck('current_reality', { surface: 'docs_only' });
  const currentRealityMatches = surfaceProfile.surface === 'docs_only'
    ? evidenceMatches.docs
    : evidenceMatches.current_reality;
  const currentRealityRequiredMatches = currentRealityMatches.filter((item) => !item.optional);
  const currentRealityMinimums = minimumStrengthByJudgmentSubcheck('current_reality', surfaceProfile, { highRisk });
  const failureModesMinimums = minimumStrengthByJudgmentSubcheck('failure_modes', surfaceProfile, { highRisk });
  const doneEvidenceMinimums = minimumStrengthByJudgmentSubcheck('done_evidence', surfaceProfile, { highRisk });
  const currentRealityMissing = missingEvidenceKindsWithStrength(
    surfaceProfile.surface === 'docs_only' ? docsRequirement : currentRealityRequirement,
    surfaceProfile.surface === 'docs_only' ? evidenceMatches.docs : currentRealityRequiredMatches,
    surfaceProfile.surface === 'docs_only' ? buildMinimumStrengthMap(docsRequirement) : currentRealityMinimums
  );
  const failureModesMissing = missingEvidenceKindsWithStrength(failureModesRequirement, evidenceMatches.failure_modes, failureModesMinimums);
  const failureModesAcceptedCanonicalTerms = acceptedCanonicalEvidenceTermsForModes(failureModesMissing);
  const doneEvidenceMissing = missingEvidenceKindsWithStrength(doneEvidenceRequirement, evidenceMatches.done_evidence, doneEvidenceMinimums);
  return [
    {
      id: 'intent',
      status: storyHasIntent ? 'passed' : 'needs_story',
      evidence: storyHasIntent ? storySource?.path ?? storySource?.story_id ?? 'story_source' : null,
      surface: 'story',
      required_evidence_kind: ['story_intent'],
      matched_evidence: storyHasIntent ? [{ kind: 'story_intent', ref: storySource?.path ?? storySource?.story_id ?? 'story_source' }] : [],
      missing_evidence: storyHasIntent ? [] : ['story_intent'],
      reason: storyHasIntent
        ? `${acceptanceCount} acceptance criterion/criteria or Story intent text found`
        : 'Story purpose or Acceptance Criteria could not be resolved'
    },
    {
      id: 'current_reality',
      status: surfaceProfile.surface === 'docs_only'
        ? (evidenceMatches.docs.length > 0 || changedFileCount > 0 ? 'passed' : 'needs_evidence')
        : currentRealityMissing.length === 0 ? 'passed' : 'needs_evidence',
      evidence: firstEvidenceRef(currentRealityMatches)
        ?? `${changedFileCount} changed file(s) classified`,
      surface: surfaceProfile.surface,
      optional_evidence_kind: ['graph_impact_scope', 'code_topology_impact_scope'],
      required_evidence_kind: surfaceProfile.surface === 'docs_only' ? docsRequirement : currentRealityRequirement,
      minimum_strength: surfaceProfile.surface === 'docs_only' ? buildMinimumStrengthMap(docsRequirement) : currentRealityMinimums,
      matched_evidence: currentRealityMatches,
      missing_evidence: currentRealityMissing,
      reason: surfaceProfile.surface === 'docs_only'
        ? 'Docs-only changes can establish current reality through Story/Spec/doc reference traceability'
        : currentRealityMissing.length === 0
          ? `${surfaceProfile.surface} current reality is backed by ${currentRealityRequiredMatches[0].kind}`
          : `${surfaceProfile.surface} changes need focused runtime/path evidence; changed-file classification alone is not enough`
    },
    {
      id: 'invariants',
      status: !highRisk || specClauseCount > 0 || hasExplicitSpecOrArchitecture || hasTests ? 'passed' : 'needs_evidence',
      evidence: specClauseCount > 0
        ? `${specClauseCount} inferred spec clause(s)`
        : hasExplicitSpecOrArchitecture
          ? 'explicit spec/architecture docs'
          : hasTests
            ? 'test files in diff'
            : null,
      surface: surfaceProfile.surface,
      optional_evidence_kind: ['graph_impact_scope', 'code_topology_impact_scope'],
      required_evidence_kind: highRisk ? ['spec_clause', 'architecture_doc', 'test_contract'] : ['story_or_diff_scope'],
      matched_evidence: [
        ...buildInvariantEvidence({ specClauseCount, hasExplicitSpecOrArchitecture, hasTests, storySource }),
        ...evidenceMatches.graph_impact
      ],
      missing_evidence: (!highRisk || specClauseCount > 0 || hasExplicitSpecOrArchitecture || hasTests)
        ? []
        : ['spec_clause', 'architecture_doc', 'test_contract'],
      reason: highRisk
        ? 'High-risk changes need Spec, Architecture, or test evidence for invariants'
        : 'Light route does not require additional invariant evidence beyond Story and diff classification'
    },
    {
      id: 'boundaries',
      status: !boundarySensitive || hasExplicitSpecOrArchitecture || acceptedDecisions.length > 0 || currentVerification.length > 0 ? 'passed' : 'needs_evidence',
      evidence: hasExplicitSpecOrArchitecture
        ? 'explicit spec/architecture docs'
        : acceptedDecisions[0]?.decision_id ?? currentVerification[0]?.command ?? null,
      surface: surfaceProfile.surface,
      optional_evidence_kind: ['graph_impact_scope', 'code_topology_impact_scope'],
      required_evidence_kind: boundarySensitive ? ['architecture_doc', 'decision_record', 'current_verification'] : ['not_applicable'],
      minimum_strength: boundarySensitive ? buildMinimumStrengthMap(['architecture_doc', 'decision_record', 'current_verification']) : {},
      matched_evidence: [
        ...buildBoundaryEvidence({ hasExplicitSpecOrArchitecture, acceptedDecisions, currentVerification }),
        ...evidenceMatches.graph_impact
      ],
      missing_evidence: (!boundarySensitive || hasExplicitSpecOrArchitecture || acceptedDecisions.length > 0 || currentVerification.length > 0)
        ? []
        : ['architecture_doc', 'decision_record', 'current_verification'],
      reason: boundarySensitive
        ? 'Boundary-sensitive changes need architecture/spec, decision, or current verification evidence'
        : 'No high-risk boundary surface was detected'
    },
    {
      id: 'failure_modes',
      status: !highRisk || failureModesMissing.length === 0 ? 'passed' : 'needs_evidence',
      evidence: firstEvidenceRef(evidenceMatches.failure_modes),
      surface: surfaceProfile.surface,
      required_evidence_kind: highRisk ? failureModesRequirement : ['not_applicable'],
      minimum_strength: highRisk ? failureModesMinimums : {},
      matched_evidence: evidenceMatches.failure_modes,
      missing_evidence: (!highRisk || failureModesMissing.length === 0)
        ? []
        : failureModesMissing,
      accepted_canonical_terms: (!highRisk || failureModesMissing.length === 0)
        ? []
        : failureModesAcceptedCanonicalTerms,
      reason: highRisk
        ? [
          `${surfaceProfile.surface} changes need failure-mode evidence matching ${failureModesRequirement.join('|')}`,
          failureModesAcceptedCanonicalTerms.length > 0
            ? `Accepted canonical evidence terms: ${failureModesAcceptedCanonicalTerms.join('; ')}`
            : null
        ].filter(Boolean).join('. ')
        : 'Light route does not require additional failure-mode evidence'
    },
    {
      id: 'done_evidence',
      status: !highRisk || doneEvidenceMissing.length === 0 || (surfaceProfile.surface !== 'workflow' && reviewPassCount > 0) ? 'passed' : 'needs_evidence',
      evidence: firstEvidenceRef(evidenceMatches.done_evidence) ?? (surfaceProfile.surface !== 'workflow' && reviewPassCount > 0 ? `${reviewPassCount} passing review role(s)` : null),
      surface: surfaceProfile.surface,
      required_evidence_kind: highRisk ? doneEvidenceRequirement : ['downstream_gate'],
      minimum_strength: highRisk ? doneEvidenceMinimums : {},
      matched_evidence: evidenceMatches.done_evidence,
      missing_evidence: (!highRisk || doneEvidenceMissing.length === 0 || (surfaceProfile.surface !== 'workflow' && reviewPassCount > 0))
        ? []
        : doneEvidenceMissing,
      reason: highRisk
        ? `${surfaceProfile.surface} changes need done evidence matching ${doneEvidenceRequirement.join('|')}`
        : 'Light route completion is covered by the downstream Unit/Integration/Agent Review gates'
    }
  ];
}

function deriveJudgmentSurfaceProfile({ routeType, prRoute, fileGroups, changeClassification, storySource, inferredSpec }) {
  const riskSurfaces = new Set(changeClassification?.risk_surfaces ?? []);
  const text = [
    storySource?.title,
    storySource?.background,
    ...(storySource?.acceptance_criteria ?? []),
    ...(inferredSpec?.clauses ?? []).map((clause) => clause.text ?? clause.statement ?? '')
  ].filter(Boolean).join('\n').toLowerCase();
  const sourceCount = fileGroups?.source?.count ?? 0;
  const docCount = (fileGroups?.story_docs?.count ?? 0)
    + (fileGroups?.specifications?.count ?? 0)
    + (fileGroups?.architecture_docs?.count ?? 0)
    + (fileGroups?.policy_docs?.count ?? 0);
  if ((prRoute?.route_type === 'docs_only' || sourceCount === 0) && docCount > 0) {
    return { surface: 'docs_only', reason: 'docs/spec/story-only change' };
  }
  if (isReadOnlyUsageReportingChange(fileGroups)) {
    return { surface: 'reporting', reason: 'read-only usage report metric/reporting change' };
  }
  if (routeType === 'security_trust'
    || riskSurfaces.has('auth_boundary')
    || riskSurfaces.has('auth')
    || riskSurfaces.has('security')) {
    return { surface: 'auth_boundary', reason: 'auth/security boundary change' };
  }
  if (routeType === 'agent_workflow'
    || riskSurfaces.has('gate_orchestration')
    || riskSurfaces.has('review_lifecycle')
    || riskSurfaces.has('core_workflow_state')
    || riskSurfaces.has('queue_worker')
    || /\b(workflow|agent|gate|review|dag|replay|artifact|orchestration|queue|retry)\b/.test(text)) {
    return { surface: 'workflow', reason: 'workflow/agent orchestration change' };
  }
  if (/\b(auth|permission|role|denied|forbidden|認可|認証|権限)\b/.test(text)) {
    return { surface: 'auth_boundary', reason: 'auth/security boundary change' };
  }
  if (sourceCount > 0 || riskSurfaces.size > 0) {
    return { surface: 'runtime', reason: 'runtime source change' };
  }
  return { surface: 'docs_only', reason: 'no runtime surface detected' };
}

function requiredEvidenceForJudgmentSubcheck(id, surfaceProfile) {
  const surface = surfaceProfile?.surface ?? 'runtime';
  if (surface === 'docs_only') return ['story_spec_traceability', 'doc_reference_integrity', 'impact_scope_explained'];
  if (surface === 'reporting') {
    if (id === 'current_reality') return ['focused_test', 'runtime_path_evidence'];
    if (id === 'failure_modes') return ['focused_test', 'runtime_path_evidence'];
    if (id === 'done_evidence') return ['focused_test', 'runtime_path_evidence'];
  }
  if (id === 'current_reality') {
    if (surface === 'workflow') return ['flow_replay', 'artifact_replay', 'scenario_clause_e2e'];
    return ['focused_test', 'runtime_path_evidence', 'integration_runtime_path', 'e2e_runtime_path'];
  }
  if (id === 'failure_modes') {
    if (surface === 'auth_boundary') return ['auth_denied', 'permission_denied', 'boundary_condition', 'negative_path'];
    if (surface === 'workflow') return ['flow_replay', 'artifact_replay', 'scenario_clause_e2e'];
    return ['focused_test', 'runtime_path_evidence', 'negative_path'];
  }
  if (id === 'done_evidence') {
    if (surface === 'workflow') return ['flow_replay', 'artifact_replay', 'scenario_clause_e2e'];
    return ['focused_test', 'runtime_path_evidence', 'integration_runtime_path', 'e2e_runtime_path'];
  }
  return ['current_evidence'];
}

function classifyJudgmentEvidence({ currentVerification, surfaceProfile, fileGroups, storySource, inferredSpec, graphContext = null, codeTopologyContext = null }) {
  const evidence = currentVerification.flatMap((item) => classifyVerificationEvidenceItem(item));
  const graphImpact = classifyGraphImpactEvidence(graphContext);
  const topologyImpact = classifyCodeTopologyImpactEvidence(codeTopologyContext);
  const docs = [];
  if (storySource?.path || storySource?.story_id) {
    docs.push(buildEvidenceItem('story_spec_traceability', storySource.path ?? storySource.story_id, {
      strength: 'supporting',
      strength_reason: 'story/spec source is traceable to the selected story',
      binding_status: 'n/a',
      artifact_quality: 'story_doc'
    }));
  }
  if ((fileGroups?.specifications?.count ?? 0) > 0 || (fileGroups?.architecture_docs?.count ?? 0) > 0) {
    docs.push(buildEvidenceItem('doc_reference_integrity', 'spec_or_architecture_docs', {
      strength: 'supporting',
      strength_reason: 'explicit spec/architecture docs are present for the changed surface',
      binding_status: 'n/a',
      artifact_quality: 'architecture_doc'
    }));
  }
  if ((inferredSpec?.clauses?.length ?? 0) > 0) {
    docs.push(buildEvidenceItem('impact_scope_explained', `${inferredSpec.clauses.length} inferred spec clause(s)`, {
      strength: 'supporting',
      strength_reason: 'spec clauses explain the changed scope',
      binding_status: 'n/a',
      artifact_quality: 'spec_clause'
    }));
  } else if (storySource?.impact_scope) {
    docs.push(buildEvidenceItem('impact_scope_explained', storySource.impact_scope, {
      strength: 'supporting',
      strength_reason: 'story doc explicitly explains the change impact scope',
      binding_status: 'n/a',
      artifact_quality: 'impact_scope_statement'
    }));
  }
  const currentRequirement = requiredEvidenceForJudgmentSubcheck('current_reality', surfaceProfile);
  const failureRequirement = requiredEvidenceForJudgmentSubcheck('failure_modes', surfaceProfile);
  const doneRequirement = requiredEvidenceForJudgmentSubcheck('done_evidence', surfaceProfile);
  const docsOnlyEvidence = surfaceProfile?.surface === 'docs_only' ? docs : [];
  return {
    docs,
    current_reality: [
      ...evidence.filter((item) => currentRequirement.includes(item.kind)),
      ...graphImpact,
      ...topologyImpact
    ],
    failure_modes: [
      ...docsOnlyEvidence,
      ...evidence.filter((item) => failureRequirement.includes(item.kind))
    ],
    done_evidence: [
      ...docsOnlyEvidence,
      ...evidence.filter((item) => doneRequirement.includes(item.kind))
    ],
    graph_impact: graphImpact,
    code_topology_impact: topologyImpact
  };
}

function classifyGraphImpactEvidence(graphContext) {
  if (!graphContext) return [];
  if (!graphContext.available) return [];
  const matched = graphContext.matched_file_count ?? 0;
  if (matched <= 0) return [];
  const related = graphContext.related_file_count ?? 0;
  return [buildEvidenceItem('graph_impact_scope', `${graphContext.graph_path ?? 'graphify graph'} (${matched} changed / ${related} related)`, {
    optional: true,
    matched_file_count: matched,
    related_file_count: related,
    investigation_files: (graphContext.investigation_files ?? []).slice(0, 12),
    strength: 'supporting',
    strength_reason: 'Graphify narrows impact scope but does not prove runtime correctness',
    binding_status: 'derived',
    artifact_quality: 'graph_context'
  })];
}

function classifyCodeTopologyImpactEvidence(codeTopologyContext) {
  if (!codeTopologyContext?.available) return [];
  const matched = codeTopologyContext.matched_file_count ?? 0;
  if (matched <= 0) return [];
  const related = codeTopologyContext.related_file_count ?? 0;
  return [buildEvidenceItem('code_topology_impact_scope', `${codeTopologyContext.provider ?? 'code topology'} (${matched} changed / ${related} related)`, {
    optional: true,
    provider: codeTopologyContext.provider ?? null,
    matched_file_count: matched,
    related_file_count: related,
    symbol_count: codeTopologyContext.symbol_count ?? 0,
    route_count: codeTopologyContext.route_count ?? 0,
    call_path_count: codeTopologyContext.call_path_count ?? 0,
    risk_count: codeTopologyContext.risk_count ?? 0,
    investigation_files: (codeTopologyContext.investigation_files ?? []).slice(0, 12),
    strength: 'supporting',
    strength_reason: 'Code topology narrows impact scope but does not prove runtime correctness',
    binding_status: 'derived',
    artifact_quality: 'code_topology_context'
  })];
}

function classifyVerificationEvidenceItem(item) {
  const searchResolution = resolveVerificationCommandSearchText(item);
  const text = appendCanonicalEvidenceTokens(searchResolution.text.toLowerCase());
  const command = String(item.command ?? '').trim();
  const generic = isGenericVerificationCommand(command);
  const ref = command || item.summary || item.artifact || item.kind || 'verification';
  const matches = [];
  const add = (kind) => {
    if (!matches.some((match) => match.kind === kind)) {
      matches.push(buildVerificationEvidenceItem(kind, ref, item, { generic, searchResolution }));
    }
  };
  if (!text) return matches;
  if (!generic && ['unit', 'integration', 'e2e', 'build', 'typecheck'].includes(item.kind)) add('focused_test');
  if (!generic && /\b(runtime|path|src\/|test\/e2e|focused|acceptance|story-)\b/.test(text)) add('runtime_path_evidence');
  if (item.kind === 'integration' && !generic) add('integration_runtime_path');
  if (item.kind === 'e2e' && !generic) add('e2e_runtime_path');
  if (!generic && /\b(flow replay|flow_replay|verify flow|journey|replay)\b/.test(text)) add('flow_replay');
  if (!generic && /\b(artifact replay|artifact_replay|gate-dag|pr-prepare|pr-create|stale artifact|stale readiness)\b/.test(text)) add('artifact_replay');
  if (!generic && item.kind === 'e2e' && (/\b(scenario|acceptance|clause|ac:|story-)\b/.test(text) || /scenario[_ -]?clause[_ -]?e2e/.test(text))) add('scenario_clause_e2e');
  const visualMarkers = explicitVisualQaMarkersFromVerificationItem(item);
  if (!generic && visualMarkers.hasVisualQa) add('visual_qa');
  if (!generic && visualMarkers.hasScreenshot) add('screenshot');
  if (!generic && /\b(accessibility|accessibility evidence|a11y|aria|keyboard|focus order|focus visible)\b/.test(text)) add('accessibility_evidence');
  if (!generic && /\b(auth_denied|auth denied|permission denied|forbidden|unauthorized|401|403|拒否|権限)\b/.test(text)) add('auth_denied');
  if (!generic && /\b(permission_denied|permission denied|forbidden|403|権限)\b/.test(text)) add('permission_denied');
  if (!generic && /\b(boundary|edge case|境界|境界条件)\b/.test(text)) add('boundary_condition');
  if (!generic && /\b(negative|denied|failure mode|fail path|missing|unknown|null|unavailable|拒否|失敗|未確認)\b/.test(text)) add('negative_path');
  for (const kind of explicitEvidenceKindsFromVerificationText(text)) add(kind);
  return matches;
}

function explicitVisualQaMarkersFromVerificationItem(item) {
  const scenarios = Array.isArray(item?.observation?.scenarios) ? item.observation.scenarios : [];
  const targets = Array.isArray(item?.observation?.targets) ? item.observation.targets : [];
  const values = item?.observation?.values && typeof item.observation.values === 'object' ? item.observation.values : {};
  const scenarioText = scenarios.map((scenario) => String(scenario ?? '')).join('\n');
  const valueKeys = Object.keys(values).join('\n');
  const hasVisualQa = /(^|[^a-z0-9])visual[_ -]?qa\s*[:=]/i.test(scenarioText)
    || /(^|[^a-z0-9])visual[_ -]?qa([^a-z0-9]|$)/i.test(valueKeys);
  const hasScreenshot = /(^|[^a-z0-9])screenshot\s*[:=]/i.test(scenarioText)
    || /(^|[^a-z0-9])screenshot[_ -]?paths?([^a-z0-9]|$)/i.test(valueKeys)
    || targets.some((target) => isVisualQaArtifactRef(target))
    || isVisualQaArtifactRef(item?.artifact);
  return { hasVisualQa, hasScreenshot };
}

function isGenericVerificationCommand(command) {
  const normalized = String(command ?? '').trim().toLowerCase();
  return normalized === 'npm test'
    || normalized === 'npm run test'
    || normalized === 'node --test'
    || normalized === 'node --test test/vibepro-cli.test.js'
    || normalized === 'npm run typecheck';
}

function explicitEvidenceKindsFromVerificationText(text) {
  const explicitKinds = [
    ...CANONICAL_EVIDENCE_TOKEN_KINDS,
    'migration_plan',
    'rollback_plan',
    'idempotency_test',
    'query_semantics_test',
    'feature_gate_disabled_behavior',
    'upgrade_downgrade_test',
    'threat_model',
    'security_review',
    'topology_diagram',
    'accessibility_evidence',
    'benchmark_delta',
    'perf_regression_guard',
    'semantic_invariant_test',
    'contract_doc',
    'scope_reviewed',
    'split_plan',
    'graph_impact_scope',
    'review_owner_map',
    'release_note',
    'rollout_plan',
    'rollback_instruction',
    'observability_evidence'
  ];
  return explicitKinds.filter((kind) => evidenceKindPattern(kind).test(text));
}

const CANONICAL_EVIDENCE_TOKEN_KINDS = Object.freeze([
  'negative_path',
  'boundary_condition',
  'parse_failure',
  'auth_denied',
  'permission_denied'
]);

function canonicalEvidenceTokenKindsFromText(text) {
  const source = String(text ?? '');
  if (!source.trim()) return [];
  return CANONICAL_EVIDENCE_TOKEN_KINDS.filter((kind) => evidenceKindPattern(kind).test(source));
}

function appendCanonicalEvidenceTokens(text) {
  const source = String(text ?? '');
  const canonicalKinds = canonicalEvidenceTokenKindsFromText(source);
  if (canonicalKinds.length === 0) return source;
  return [source, ...canonicalKinds].join('\n');
}

function evidenceKindPattern(kind) {
  const escaped = escapeRegExp(kind).replaceAll('_', '[_ -]');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
}

function missingEvidenceKinds(required, matched) {
  const matchedKinds = new Set(matched.map((item) => item.kind));
  return required.filter((kind) => !matchedKinds.has(kind));
}

function missingSeniorAxisEvidenceKinds(definition, matched) {
  return missingEvidenceKindsWithStrength(
    definition.required_evidence,
    matched,
    buildMinimumStrengthMap(definition.required_evidence)
  );
}

function missingEvidenceKindsWithStrength(required, matched, minimumStrengthByKind = {}) {
  return required.filter((kind) => !matchedEvidenceMeetsStrength(kind, matched, minimumStrengthByKind[kind] ?? 'supporting'));
}

function matchedEvidenceMeetsStrength(kind, matched, minimumStrength) {
  return matched.some((item) => item.kind === kind && evidenceStrengthRank(item.strength) >= evidenceStrengthRank(minimumStrength));
}

function evidenceStrengthRank(strength) {
  if (strength === 'strong') return 3;
  if (strength === 'supporting') return 2;
  return 1;
}

export function buildEvidenceItem(kind, ref, extra = {}) {
  // Spread `extra` first so its descriptive fields (matched_file_count,
  // investigation_files, deprecation, ...) are carried through, but the
  // explicit kind/ref args and the defaulted fields always win over any
  // colliding key in `extra`. Otherwise a stray extra.kind/extra.ref would
  // silently override the caller's explicit identity.
  return {
    ...extra,
    kind,
    ref,
    strength: extra.strength ?? 'declared',
    strength_reason: extra.strength_reason ?? 'strength was not classified',
    binding_status: extra.binding_status ?? 'n/a',
    artifact_quality: extra.artifact_quality ?? 'unknown'
  };
}

function buildVerificationEvidenceItem(kind, ref, item, { generic = false, searchResolution = null } = {}) {
  const bindingStatus = item?.binding?.status ?? 'unknown';
  const artifactStatus = item?.artifact_check?.status ?? (item?.artifact ? 'recorded' : 'missing');
  const hasDurableArtifact = Boolean(item?.artifact) && artifactStatus === 'verified';
  const strongCandidate = !generic && bindingStatus === 'current' && hasDurableArtifact && item?.observation_check?.status === 'recorded';
  const resolution = searchResolution ?? resolveVerificationCommandSearchText(item);
  const strength = strongCandidate ? 'strong' : bindingStatus === 'current' ? 'supporting' : 'declared';
  const strengthReason = strongCandidate
    ? 'current-bound focused evidence includes recorded observation plus durable artifact'
    : bindingStatus === 'current'
      ? hasDurableArtifact
        ? 'current-bound evidence is useful but remains indirect or broad for high-risk proof'
        : 'current-bound pass claim lacks a verified durable artifact, so it cannot be strong'
      : 'evidence is declared without current-bound verification binding';
  return buildEvidenceItem(kind, ref, {
    artifact: item?.artifact ?? null,
    binding_status: bindingStatus,
    artifact_quality: item?.artifact ? artifactStatus : 'missing_artifact',
    resolution_source: resolution.source,
    ...(resolution.deprecation ? { deprecation: resolution.deprecation } : {}),
    strength,
    strength_reason: strengthReason
  });
}

function buildMinimumStrengthMap(requiredKinds, overrides = {}) {
  const map = {};
  for (const kind of requiredKinds ?? []) {
    map[kind] = overrides[kind] ?? 'supporting';
  }
  return map;
}

function firstEvidenceRef(items) {
  return items[0]?.ref ?? null;
}

function buildInvariantEvidence({ specClauseCount, hasExplicitSpecOrArchitecture, hasTests, storySource }) {
  const evidence = [];
  if (specClauseCount > 0) evidence.push(buildEvidenceItem('spec_clause', `${specClauseCount} inferred spec clause(s)`, {
    strength: 'supporting',
    strength_reason: 'spec clauses describe the invariant surface',
    binding_status: 'n/a',
    artifact_quality: 'spec_clause'
  }));
  if (hasExplicitSpecOrArchitecture) evidence.push(buildEvidenceItem('architecture_doc', 'explicit spec/architecture docs', {
    strength: 'supporting',
    strength_reason: 'architecture/spec docs bound the invariant surface',
    binding_status: 'n/a',
    artifact_quality: 'architecture_doc'
  }));
  if (hasTests) evidence.push(buildEvidenceItem('test_contract', 'test files in diff', {
    strength: 'supporting',
    strength_reason: 'changed tests indicate intended contract coverage but are not focused proof by themselves',
    binding_status: 'n/a',
    artifact_quality: 'changed_test_files'
  }));
  if (evidence.length === 0 && (storySource?.path || storySource?.story_id)) evidence.push(buildEvidenceItem('story_or_diff_scope', storySource.path ?? storySource.story_id, {
    strength: 'declared',
    strength_reason: 'story scope exists but invariant evidence is indirect',
    binding_status: 'n/a',
    artifact_quality: 'story_doc'
  }));
  return evidence;
}

function buildBoundaryEvidence({ hasExplicitSpecOrArchitecture, acceptedDecisions, currentVerification }) {
  const evidence = [];
  if (hasExplicitSpecOrArchitecture) evidence.push(buildEvidenceItem('architecture_doc', 'explicit spec/architecture docs', {
    strength: 'supporting',
    strength_reason: 'architecture/spec docs describe the relevant boundary',
    binding_status: 'n/a',
    artifact_quality: 'architecture_doc'
  }));
  if (acceptedDecisions[0]) evidence.push(buildEvidenceItem('decision_record', acceptedDecisions[0].decision_id, {
    strength: 'supporting',
    strength_reason: 'accepted decision records the boundary rationale',
    binding_status: 'current',
    artifact_quality: 'decision_record'
  }));
  if (currentVerification[0]) evidence.push(buildEvidenceItem('current_verification', currentVerification[0].command, {
    strength: currentVerification[0].artifact ? 'strong' : 'supporting',
    strength_reason: currentVerification[0].artifact
      ? 'current verification is tied to a durable artifact for the boundary path'
      : 'current verification is HEAD-bound but lacks a durable artifact',
    binding_status: currentVerification[0].binding?.status ?? 'current',
    artifact_quality: currentVerification[0].artifact ? (currentVerification[0].artifact_check?.status ?? 'recorded') : 'missing_artifact',
    artifact: currentVerification[0].artifact ?? null
  }));
  return evidence;
}

function minimumStrengthByJudgmentSubcheck(id, surfaceProfile, { highRisk = false } = {}) {
  const required = requiredEvidenceForJudgmentSubcheck(id, surfaceProfile);
  const map = buildMinimumStrengthMap(required);
  if (!highRisk) return map;
  const surface = surfaceProfile?.surface ?? 'runtime';
  if (surface === 'workflow') {
    for (const kind of required) map[kind] = 'strong';
    return map;
  }
  if (surface === 'auth_boundary' && id === 'failure_modes') {
    for (const kind of required) map[kind] = 'strong';
    return map;
  }
  if (surface === 'runtime' && ['current_reality', 'failure_modes', 'done_evidence'].includes(id)) {
    for (const kind of required) map[kind] = 'strong';
  }
  return map;
}

function buildPrScopeJudgmentGate({ scope = null, fileGroups = null, git = null, prRoute = null, decisionRecords = null } = {}) {
  const storyDocCount = fileGroups?.story_docs?.count ?? 0;
  const sourceCount = fileGroups?.source?.count ?? 0;
  const testCount = fileGroups?.tests?.count ?? 0;
  const docCount = (fileGroups?.architecture_docs?.count ?? 0)
    + (fileGroups?.specifications?.count ?? 0)
    + (fileGroups?.policy_docs?.count ?? 0);
  const changedFileCount = scope?.changed_file_count ?? git?.changed_files?.length ?? 0;
  const riskSurfaceCount = prRoute?.required_sections?.length ?? 0;
  const mixedUnrelated = storyDocCount > 1 || (fileGroups?.repo_control?.count ?? 0) > 0 && (sourceCount + docCount > 0);
  const needsSplit = scope?.status !== 'reviewable' || mixedUnrelated;
  const classification = needsSplit
    ? 'needs_split'
    : changedFileCount > Math.max(12, (scope?.reviewable_file_limit ?? DEFAULT_MAX_REVIEWABLE_FILES) / 2)
      ? 'large_but_coherent'
      : sourceCount > 0 && docCount > 0 && testCount > 0
        ? 'focused'
        : 'focused';
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:pr_scope_judgment')
    ?? findAcceptedDecisionForSource(decisionRecords, 'gate:split_resolution');
  const status = needsSplit && !acceptedDecision ? 'needs_split' : 'passed';
  const splitSuggestions = [];
  if (storyDocCount > 1) splitSuggestions.push('Split multiple Story docs into separate PRs or explicitly justify the bundled scope.');
  if ((fileGroups?.repo_control?.count ?? 0) > 0 && sourceCount + docCount > 0) splitSuggestions.push('Separate repo-control/agent configuration changes from product/source changes.');
  if (scope?.status !== 'reviewable') splitSuggestions.push(scope.recommended_strategy ?? 'Split the PR by lane and rerun VibePro pr prepare.');
  return {
    id: 'gate:pr_scope_judgment',
    type: 'pr_scope_judgment_gate',
    label: 'PR Scope Judgment Gate',
    status,
    required: true,
    classification,
    scope_status: scope?.status ?? null,
    recommended_strategy: scope?.recommended_strategy ?? null,
    changed_file_count: changedFileCount,
    reviewable_file_limit: scope?.reviewable_file_limit ?? null,
    story_doc_count: storyDocCount,
    source_file_count: sourceCount,
    test_file_count: testCount,
    doc_file_count: docCount,
    risk_surface_count: riskSurfaceCount,
    accepted_decision: acceptedDecision ? {
      source: acceptedDecision.source ?? null,
      summary: acceptedDecision.summary ?? null,
      reviewer: acceptedDecision.reviewer ?? null
    } : null,
    reasons: scope?.reasons ?? [],
    split_suggestions: splitSuggestions,
    required_actions: status === 'passed' ? [] : [
      ...splitSuggestions,
      'Regenerate `vibepro pr prepare` after the PR scope is reduced or an auditable split decision is recorded'
    ],
    reason: acceptedDecision
      ? `PR scope decision is recorded: ${acceptedDecision.summary ?? acceptedDecision.source}`
      : status === 'passed'
        ? `PR scope is ${classification}; ${changedFileCount} changed file(s) are reviewable as one Story PR`
      : 'PR scope requires a split decision or explicit bundled-scope justification before PR creation'
  };
}

const SCOPE_BOUNDARY_TEST_FILE_PATTERN = /(^|\/)(tests?|__tests__|spec)\//i;
const SCOPE_BOUNDARY_TEST_FILE_SUFFIX_PATTERN = /\.(test|spec)\.[jt]sx?$/;

function isScopeBoundaryTestFile(filePath) {
  return SCOPE_BOUNDARY_TEST_FILE_PATTERN.test(filePath) || SCOPE_BOUNDARY_TEST_FILE_SUFFIX_PATTERN.test(filePath);
}

function globToRegExp(pattern) {
  const normalized = pattern.replaceAll('\\', '/');
  const isDirPrefix = normalized.endsWith('/');
  let source = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        source += '.*';
        i += 1;
        // consume an optional following slash so `a/**/b` also matches `a/b`
        if (normalized[i + 1] === '/') i += 1;
      } else {
        source += '[^/]*';
      }
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (isDirPrefix) source += '.*';
  return new RegExp(`^${source}$`);
}

function matchesAnyGlob(filePath, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const normalizedFile = String(filePath).replaceAll('\\', '/');
  return patterns.some((pattern) => globToRegExp(String(pattern)).test(normalizedFile));
}

async function readScopeBoundaryIfExists(repoRoot, storyId) {
  if (!storyId) return null;
  const taskPath = path.join(getWorkspaceDir(repoRoot), 'stories', storyId, 'tasks', 'tasks.json');
  try {
    const taskState = JSON.parse(await readFile(taskPath, 'utf8'));
    return taskState?.scope_boundary ?? null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return null;
  }
}

function buildScopeBoundaryGate({ scopeBoundary = null, git = null, decisionRecords = null } = {}) {
  if (!scopeBoundary) return null;
  const declared = scopeBoundary.declared === true;
  const allowedPaths = Array.isArray(scopeBoundary.allowed_paths) ? scopeBoundary.allowed_paths : [];
  const changedFiles = (git?.changed_files ?? [])
    .map((file) => (typeof file === 'string' ? file : file.path))
    .filter(Boolean)
    .filter((file) => !isWorkspaceArtifactPath(file) && !isScopeBoundaryTestFile(file));
  const outOfScopeFiles = declared
    ? changedFiles.filter((file) => !matchesAnyGlob(file, allowedPaths))
    : [];
  const acceptedDecision = declared && outOfScopeFiles.length > 0
    ? (findAcceptedDecisionForSource(decisionRecords, 'gate:scope_boundary')
      ?? findAcceptedDecisionForSource(decisionRecords, 'gate:split_resolution'))
    : null;
  const status = !declared
    ? 'not_declared'
    : outOfScopeFiles.length === 0
      ? 'passed'
      : acceptedDecision
        ? 'passed_with_waiver'
        : 'needs_scope_correction';
  return {
    id: 'gate:scope_boundary',
    type: 'scope_boundary_gate',
    label: 'Story Scope Boundary Gate',
    status,
    required: declared,
    declared,
    allowed_paths: allowedPaths,
    out_of_scope_files: outOfScopeFiles,
    accepted_decision: acceptedDecision ? {
      source: acceptedDecision.source ?? null,
      summary: acceptedDecision.summary ?? null,
      reviewer: acceptedDecision.reviewer ?? null
    } : null,
    required_actions: status === 'needs_scope_correction' ? [
      `Split ${outOfScopeFiles.length} file(s) outside the declared scope into a separate Story PR, or update the story's --allowed-paths and rerun \`vibepro task create --from-plan\` + \`vibepro pr prepare\`.`,
      'Alternatively, record an accepted decision against `gate:scope_boundary` (or `gate:split_resolution`) if the bundled scope is intentional.'
    ] : [],
    reason: !declared
      ? 'Story has no declared scope boundary (informational only; does not block PR creation).'
      : status === 'passed'
        ? `All ${changedFiles.length} reviewable changed file(s) match the declared scope boundary (${allowedPaths.length} pattern(s)).`
        : status === 'passed_with_waiver'
          ? `Scope boundary violation is covered by an accepted decision: ${acceptedDecision.summary ?? acceptedDecision.source}`
          : `${outOfScopeFiles.length} changed file(s) fall outside the declared scope boundary: ${outOfScopeFiles.slice(0, 5).join(', ')}${outOfScopeFiles.length > 5 ? ', ...' : ''}`
  };
}

function buildRouteSpecificJudgmentGates(engineeringJudgment, evidenceContext = {}) {
  const routeType = engineeringJudgment?.route_type ?? 'general_engineering';
  const definitions = {
    business_system: [
      ['business_reality', 'Business Reality Gate', '現場業務、例外運用、正本、締め/承認/監査影響を先に読む'],
      ['domain_model', 'Domain Model Gate', '顧客、契約、請求、承認、在庫などの業務概念と関係をモデル化する'],
      ['state_transition', 'State Transition Gate', 'draft/submitted/approved のような業務状態遷移を明示する'],
      ['data_integrity', 'Data Integrity Gate', '既存データ、集計、移行、再実行、監査ログの整合性を守る'],
      ['permission_matrix', 'Permission Matrix Gate', '誰が閲覧/編集/承認できるかをUI/APIの両方で固定する'],
      ['operational_closure', 'Operational Closure Gate', '問い合わせ、監視、rollback、運用手順まで閉じる']
    ],
    developer_tool: [
      ['developer_friction', 'Developer Friction Gate', '実際の開発摩擦を最小単位で定義する'],
      ['workflow_loop', 'Workflow Loop Gate', 'copy/run/debug/release のような作業ループを閉じる'],
      ['cli_api_contract', 'CLI / API Contract Gate', '人間向け出力、機械向けJSON、exit code、config precedenceを固定する'],
      ['local_first_state', 'Local-First State Gate', '外部状態をローカルで高速・再現可能に読む'],
      ['fast_feedback', 'Fast Feedback Gate', 'doctor/check/watch/smoke で短い検証ループを作る'],
      ['install_release_path', 'Install / Release Path Gate', 'install、upgrade、package、releaseの導線を設計する']
    ],
    ui_ux_modernization: [
      ['current_ux', 'Current UX Gate', '現行導線、情報構造、ユーザーが依存する表示を固定する'],
      ['ux_invariants', 'UX Invariant Gate', '変えてよい見た目と壊してはいけない操作を分ける'],
      ['interaction_states', 'Interaction State Gate', 'loading/error/empty/disabled/hover/focusなどの状態を設計する'],
      ['visual_verification', 'Visual Verification Gate', '実ブラウザ/スクリーンショット/残差で見た目を確認する']
    ],
    agent_workflow: [
      ['context_acquisition', 'Context Acquisition Gate', 'agentが読むべきrepo/docs/log/graph/current stateを先に集める'],
      ['tool_boundary', 'Tool Boundary Gate', 'どのtool/agentがどの副作用を持つかを分離する'],
      ['delegation_policy', 'Delegation Policy Gate', 'どの段階でどのレビュー/サブエージェントを呼ぶかをDAGに置く'],
      ['evidence_lifecycle', 'Evidence Lifecycle Gate', 'start/record/close/stale/timed-outを証跡として閉じる'],
      ['human_decision_contract', 'Human Decision Contract Gate', '最後に人間が判断する問いと根拠をPRに出す']
    ],
    data_pipeline: [
      ['source_of_truth', 'Source of Truth Gate', '入力、正本、外部ID、同期境界を決める'],
      ['migration_rollback', 'Migration / Rollback Gate', '移行、再実行、rollback、backfillを設計する'],
      ['idempotency', 'Idempotency Gate', '重複実行、partial failure、retryで壊れないことを確認する']
    ],
    security_trust: [
      ['threat_model', 'Threat Model Gate', '攻撃経路、信頼境界、secret/token露出をモデル化する'],
      ['permission_enforcement', 'Permission Enforcement Gate', 'UI非表示ではなくAPI/DB境界で権限を守る'],
      ['security_regression', 'Security Regression Gate', '再発防止テストと監査証跡を残す']
    ],
    release_engineering: [
      ['release_traceability', 'Release Traceability Gate', 'source PR/commit/tag/changelog/CIを結びつける'],
      ['artifact_verification', 'Artifact Verification Gate', 'package、署名、appcast、tarball、integrityを確認する'],
      ['rollout_rollback', 'Rollout / Rollback Gate', '配布後検証、rollback、ユーザー影響を分ける']
    ],
    api_platform: [
      ['api_contract', 'API Contract Gate', 'route、client call、schema、error shape、compatを固定する'],
      ['boundary_validation', 'Boundary Validation Gate', 'validation/auth/rate limit/idempotencyを境界で守る']
    ],
    infra_ops: [
      ['blast_radius', 'Blast Radius Gate', '設定/CI/infra変更の影響範囲とrollbackを読む'],
      ['ops_observability', 'Ops Observability Gate', 'ログ、status、alert、rerun手順を確認する']
    ],
    knowledge_docs: [
      ['reader_decision', 'Reader Decision Gate', '読者が何を判断/実行できるようになるかを明確にする'],
      ['doc_freshness', 'Doc Freshness Gate', '現行仕様・コマンド・リンクと矛盾しないことを確認する']
    ],
    general_engineering: [
      ['system_model', 'System Model Gate', '対象システムのモデルと境界を明示する'],
      ['proof_plan', 'Proof Plan Gate', '変更に見合う証跡と検証ルートを選ぶ']
    ]
  };
  return (definitions[routeType] ?? definitions.general_engineering).map(([suffix, label, reason]) => {
    const base = {
      id: `gate:judgment_${routeType}_${suffix}`,
      type: 'route_specific_judgment_gate',
      label,
      status: 'passed',
      required: true,
      route_type: routeType,
      route_dag: engineeringJudgment?.route_dag ?? `${routeType}_dag`,
      reason
    };
    // Enforced route-specific judgment gate (narrow first step): the security/trust
    // route's regression gate is promoted from advisory to evidence-backed. A
    // current-bound passing security regression test or an explicit waiver decision
    // must exist before PR creation; every other judgment gate stays advisory so the
    // common spine and low-risk routes do not add mechanical friction.
    if (routeType === 'security_trust' && suffix === 'security_regression') {
      const hasEvidence = hasSecurityRegressionEvidence(evidenceContext);
      return {
        ...base,
        type: 'security_regression_gate',
        status: hasEvidence ? 'passed' : 'needs_evidence',
        reason: hasEvidence
          ? 'Security regression evidence (current-bound passing test) or an explicit waiver decision is recorded'
          : 'Security/trust route requires a current-bound passing security regression test, or an explicit waiver decision recorded against gate:judgment_security_trust_security_regression, before PR creation'
      };
    }
    // Enforced on the route axis (not the risk axis): a change to agent/gate/dag/skill/mcp
    // machinery must close its agent-review evidence lifecycle for the current git state,
    // even when the risk profile would not otherwise require staged reviews. Resolved by a
    // clean, current-bound recorded review or an explicit waiver decision.
    if (routeType === 'agent_workflow' && suffix === 'evidence_lifecycle') {
      const hasEvidence = hasAgentEvidenceLifecycle(evidenceContext);
      return {
        ...base,
        type: 'agent_evidence_lifecycle_gate',
        status: hasEvidence ? 'passed' : 'needs_evidence',
        reason: hasEvidence
          ? 'Agent review evidence lifecycle is closed for the current git state (recorded review or explicit waiver)'
          : 'Agent workflow route requires a current-bound recorded agent review with no unmet/stale/timed-out/blocked results, or an explicit waiver decision recorded against gate:judgment_agent_workflow_evidence_lifecycle, before PR creation'
      };
    }
    return base;
  });
}

function buildPrBodyContractGate(prRoute, { storySource, fileGroups, scope, git, verificationEvidence, decisionRecords }) {
  const hasStorySource = Boolean(storySource?.path);
  const hasDocIntent = (fileGroups.story_docs?.count ?? 0) > 0
    || (fileGroups.specifications?.count ?? 0) > 0
    || (fileGroups.architecture_docs?.count ?? 0) > 0
    || (fileGroups.policy_docs?.count ?? 0) > 0;
  const routeType = prRoute?.route_type ?? 'general_change';
  const routeNeedsSourceTrace = ['mirror_sync', 'release_merge'].includes(routeType);
  const hasRouteSpecificContract = ['docs_only', 'test_only'].includes(routeType);
  const routeContractResolved = !routeNeedsSourceTrace || (
    hasMirrorSourceEvidence({ git, decisionRecords })
    && hasCiStatusOrWaiverEvidence({ verificationEvidence, decisionRecords })
  );
  const status = ((hasStorySource || hasDocIntent || hasRouteSpecificContract || routeNeedsSourceTrace) && routeContractResolved)
    ? 'passed'
    : 'needs_review';
  return {
    id: 'gate:pr_body_contract',
    type: 'pr_body_contract_gate',
    label: 'PR Body Contract Gate',
    status,
    required: true,
    route_type: routeType,
    body_template: prRoute?.body_template ?? 'standard_story_review',
    required_sections: buildRouteBodyRequiredSections(routeType),
    scope_status: scope?.status ?? null,
    reason: status === 'passed'
      ? `PR body must use ${prRoute?.body_template ?? 'standard_story_review'} and expose the route-specific decision contract`
      : routeNeedsSourceTrace
        ? 'PR body needs explicit source traceability plus CI/waiver evidence before the route-specific contract is complete'
        : 'PR body needs a Story, Spec, Architecture, policy document, or explicit source traceability contract'
  };
}

function buildRouteBodyRequiredSections(routeType) {
  const base = ['decision_question', 'story_or_source_of_truth', 'gate_status', 'verification_or_waiver'];
  if (routeType === 'mirror_sync') return [...base, 'source_pr_or_commit', 'source_ci_or_waiver', 'mirror_artifact_policy'];
  if (routeType === 'release_merge') return [...base, 'release_source_prs', 'release_ci_status', 'deployment_scope'];
  if (routeType === 'config_or_agent_policy') return [...base, 'policy_boundary', 'affected_agents_or_hooks'];
  if (routeType === 'design_or_ui_change') return [...base, 'visual_evidence', 'ux_invariants'];
  if (routeType === 'docs_only') return [...base, 'reader_decision'];
  return base;
}

function buildMirrorSourceTraceabilityGate(prRoute, git, decisionRecords = null) {
  if (!['mirror_sync', 'release_merge'].includes(prRoute?.route_type)) return null;
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:mirror_source_traceability');
  const hasSourcePointer = hasMirrorSourceEvidence({ git, decisionRecords });
  return {
    id: 'gate:mirror_source_traceability',
    type: 'mirror_source_traceability_gate',
    label: prRoute.route_type === 'release_merge' ? 'Release Source Traceability Gate' : 'Mirror Source Traceability Gate',
    status: hasSourcePointer ? 'passed' : 'needs_evidence',
    required: true,
    route_type: prRoute.route_type,
    reason: hasSourcePointer
      ? acceptedDecision
        ? `Source traceability decision is recorded: ${acceptedDecision.summary}`
        : 'Commit metadata includes a source PR/commit/ref pointer'
      : 'Mirror/release route requires source PR, source commit, or upstream ref evidence in the VibePro PR contract'
  };
}

function buildCiStatusOrWaiverGate(prRoute, verificationEvidence = null, decisionRecords = null) {
  if (!['mirror_sync', 'release_merge'].includes(prRoute?.route_type)) return null;
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:ci_status_or_waiver');
  const hasEvidence = hasCiStatusOrWaiverEvidence({ verificationEvidence, decisionRecords });
  return {
    id: 'gate:ci_status_or_waiver',
    type: 'ci_status_or_waiver_gate',
    label: 'CI Status / Waiver Gate',
    status: hasEvidence ? 'passed' : 'needs_evidence',
    required: true,
    route_type: prRoute.route_type,
    reason: hasEvidence
      ? acceptedDecision
        ? `CI/waiver decision is recorded: ${acceptedDecision.summary}`
        : 'Current verification evidence cites CI status for this mirror/release route'
      : 'Mirror/release route must cite source CI, target CI, or an explicit waiver before merge'
  };
}

function buildVibeproArtifactPolicyGate(fileGroups, prRoute, decisionRecords = null) {
  if ((fileGroups.vibepro_artifacts?.count ?? 0) === 0) return null;
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:vibepro_artifact_policy');
  return {
    id: 'gate:vibepro_artifact_policy',
    type: 'vibepro_artifact_policy_gate',
    label: 'VibePro Artifact Policy Gate',
    status: acceptedDecision ? 'passed' : 'needs_review',
    required: true,
    route_type: prRoute?.route_type ?? 'general_change',
    artifact_files: fileGroups.vibepro_artifacts.files,
    reason: acceptedDecision
      ? `VibePro artifact policy decision is recorded: ${acceptedDecision.summary}`
      : '.vibepro artifacts are diagnostic evidence; committing them requires an explicit artifact policy decision in the PR body'
  };
}

function buildSplitResolutionGate(scope, prRoute, decisionRecords = null) {
  if (scope?.status !== 'needs_clean_branch') return null;
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:split_resolution');
  const status = acceptedDecision ? 'passed' : 'needs_review';
  return {
    id: 'gate:split_resolution',
    type: 'split_resolution_gate',
    label: 'Split Resolution Gate',
    status,
    required: true,
    route_type: prRoute?.route_type ?? 'general_change',
    reasons: scope?.reasons ?? [],
    reason: acceptedDecision
      ? `Split/clean-branch decision is explicitly recorded: ${acceptedDecision.summary}`
      : 'Scope requires a split/clean-branch decision to be resolved or explicitly justified before PR creation',
    decision_id: acceptedDecision?.decision_id ?? null
  };
}

function buildManagedWorktreeGate(context) {
  if (!context || context.status === 'not_applicable') return null;
  const required = context.mode === 'required';
  return {
    id: 'gate:managed_worktree',
    type: 'managed_worktree_gate',
    label: 'Managed Worktree Gate',
    status: context.status,
    required,
    mode: context.mode,
    command_name: context.command_name,
    expected_root: context.expected_root,
    actual_root: context.actual_root,
    expected_head_sha: context.expected_head_sha,
    current_head_sha: context.current_head_sha,
    managed_worktree: context.managed_worktree ? {
      path: context.managed_worktree.path,
      branch: context.managed_worktree.branch,
      actual_branch: context.managed_worktree.actual_branch,
      current_head_sha: context.managed_worktree.current_head_sha,
      dirty: context.managed_worktree.dirty,
      dirty_fingerprint: context.managed_worktree.dirty_fingerprint,
      raw_dirty: context.managed_worktree.raw_dirty ?? null,
      raw_dirty_fingerprint: context.managed_worktree.raw_dirty_fingerprint ?? context.managed_worktree.raw_fingerprint ?? null,
      fingerprint_scope: context.managed_worktree.fingerprint_scope ?? null
    } : null,
    reason: context.status === 'satisfied'
      ? 'PR command is running inside the recorded managed worktree'
      : context.reason,
    required_actions: context.status === 'satisfied'
      ? []
      : ['Run the command from the recorded VibePro managed worktree, update the managed worktree to the current HEAD, or explicitly disable managed_worktree for this repository.']
  };
}

function findAcceptedDecisionForSource(decisionRecords, source) {
  const decisions = Array.isArray(decisionRecords?.decisions) ? decisionRecords.decisions : [];
  return decisions.find((decision) => (
    decision.source === source
    && decision.status === 'accepted'
    && ['waiver', 'needs_review'].includes(decision.type)
  )) ?? null;
}

function hasMirrorSourceEvidence({ git = {}, decisionRecords = null }) {
  if (findAcceptedDecisionForSource(decisionRecords, 'gate:mirror_source_traceability')) return true;
  const commitText = (git?.commits ?? [])
    .map((commit) => [commit.subject, commit.message, commit.body].filter(Boolean).join('\n'))
    .join('\n');
  return /(https:\/\/github\.com\/\S+\/pull\/\d+|PR\s*#\d+|pull request\s*#\d+|source\s+(commit|pr)|origin\/\w+|[0-9a-f]{12,40})/i.test(commitText);
}

function hasCiStatusOrWaiverEvidence({ verificationEvidence = null, decisionRecords = null }) {
  if (findAcceptedDecisionForSource(decisionRecords, 'gate:ci_status_or_waiver')) return true;
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return commands.some((item) => (
    item.binding?.status === 'current'
    && ['pass', 'passed', 'success', 'ok'].includes(item.status)
    && /\b(ci|github actions|source ci|target ci|check run|checks passed)\b/i.test(`${item.kind ?? ''}\n${item.command ?? ''}\n${item.summary ?? ''}\n${item.artifact ?? ''}`)
  ));
}

function hasSecurityRegressionEvidence({ verificationEvidence = null, decisionRecords = null } = {}) {
  if (findAcceptedDecisionForSource(decisionRecords, 'gate:judgment_security_trust_security_regression')) return true;
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return commands.some((item) => {
    if (item.binding?.status !== 'current') return false;
    if (!['pass', 'passed', 'success', 'ok'].includes(item.status)) return false;
    const haystack = `${item.kind ?? ''}\n${item.command ?? ''}\n${item.summary ?? ''}\n${item.artifact ?? ''}`;
    const looksLikeTest = /\b(unit|integration|e2e|test|spec)\b/i.test(haystack);
    const looksSecurity = /\b(security|auth|authn|authz|permission|token|secret|regression|xss|csrf|injection|access control)\b/i.test(haystack);
    return looksLikeTest && looksSecurity;
  });
}

function detectSafetySurfaceFiles(fileGroups = {}) {
  const all = Object.values(fileGroups ?? {}).flatMap((group) => group?.files ?? []);
  const isSecretSurface = (p) => {
    const base = p.split('/').pop() ?? p;
    // Template/example env files are safe by convention.
    if (/^\.env(\.[\w.-]+)?$/.test(base) && !/\.(example|sample|template|dist)$/.test(base)) return true;
    if (/(^|\.)(npmrc|pypirc|netrc)$/.test(base)) return true;
    if (/\.(pem|p12|pfx|keystore|jks)$/.test(base)) return true;
    if (/\.key$/.test(base) && !/\.pub\.key$/.test(base)) return true;
    if (/^id_(rsa|ed25519|ecdsa|dsa)$/.test(base)) return true; // private keys (exclude .pub)
    if (/(^|[\/_.-])(secret|secrets|credential|credentials)([\/_.-]|$)/i.test(p) && !/\.(example|sample|template)$/.test(base)) return true;
    return false;
  };
  return all.filter(isSecretSurface);
}

function hasSafetyDecision(decisionRecords, source) {
  if (findAcceptedDecisionForSource(decisionRecords, source)) return true;
  const decisions = Array.isArray(decisionRecords?.decisions) ? decisionRecords.decisions : [];
  return decisions.some((decision) => decision.type === 'secret_exposure' && decision.status === 'accepted');
}

// Issue #128: story-shape -> required architecture blueprint dimensions.
// A data map (not logic) so new shapes/routes are a data change. Each dimension
// has a keyword matcher used to check whether architecture evidence addresses it.
// Deliberately starts narrow: only the workflow/scheduler shape.
const ARCHITECTURE_BLUEPRINT_DIMENSIONS = {
  workflow_scheduler: [
    {
      id: 'scheduling_owner',
      label: 'Scheduling owner',
      hint: 'what runs the scheduled jobs (local vs server-side) and how they are triggered',
      keywords: /(schedul|cron|interval|routine|runner|launchd|systemd|polling|trigger|定期実行|スケジュ)/i
    },
    {
      id: 'job_infrastructure',
      label: 'Job infrastructure',
      hint: 'what infrastructure runs server-side scheduled jobs (worker/queue/lambda/fly/actions/container)',
      keywords: /(infrastructure|infra|worker|queue|server-?side|lambda|fly machine|github actions|container|daemon|常駐|インフラ)/i
    }
  ]
};

function storyEvidenceText(storySource) {
  return [
    storySource?.title,
    storySource?.background,
    storySource?.summary,
    ...(storySource?.acceptance_criteria ?? [])
  ].filter(Boolean).join('\n');
}

// Conservative, high-precision detector: only flag stories that clearly describe
// scheduled / recurring workflow execution. The dimension list sits behind this
// so ordinary stories never see the gate (issue #128 note).
function detectBlueprintShapes(storySource) {
  const text = storyEvidenceText(storySource);
  const shapes = [];
  if (/\b(schedul\w*|cron|scheduled job|recurring|every \d+\s+(?:minute|hour|day|week)s?|polling|launchd|systemd timer)\b|定期実行|スケジュール|常駐ジョブ/i.test(text)) {
    shapes.push('workflow_scheduler');
  }
  return shapes;
}

// Reads architecture doc content + story text and checks which required blueprint
// dimensions are addressed. Returns null when no shape applies. Files only.
async function buildArchitectureBlueprintCoverage(repoRoot, { storySource, fileGroups }) {
  const shapes = detectBlueprintShapes(storySource);
  if (shapes.length === 0) return null;
  const required = shapes.flatMap((shape) =>
    (ARCHITECTURE_BLUEPRINT_DIMENSIONS[shape] ?? []).map((d) => ({ ...d, shape })));
  let evidence = storyEvidenceText(storySource);
  for (const file of (fileGroups.architecture_docs?.files ?? [])) {
    try {
      evidence += '\n' + await readFile(path.join(repoRoot, file), 'utf8');
    } catch {
      // unreadable doc -> no coverage contribution from that file
    }
  }
  const covered = [];
  const missing = [];
  for (const d of required) (d.keywords.test(evidence) ? covered : missing).push(d);
  return { shapes, required, covered, missing };
}

function buildArchitectureBlueprintGate(blueprintCoverage, decisionRecords = null) {
  if (!blueprintCoverage) return null;
  const waiver = findAcceptedDecisionForSource(decisionRecords, 'gate:architecture_blueprint');
  const missing = blueprintCoverage.missing ?? [];
  const resolved = Boolean(waiver) || missing.length === 0;
  return {
    id: 'gate:architecture_blueprint',
    type: 'architecture_blueprint_gate',
    label: 'Architecture Blueprint Gate',
    status: resolved ? 'passed' : 'needs_evidence',
    required: true,
    shapes: blueprintCoverage.shapes,
    required_dimensions: blueprintCoverage.required.map((d) => d.id),
    missing_dimensions: missing.map((d) => ({ id: d.id, label: d.label, hint: d.hint })),
    reason: resolved
      ? (waiver
        ? `Architecture blueprint dimensions waived: ${waiver.summary ?? 'waiver recorded'}`
        : 'Architecture evidence addresses the required blueprint dimensions for this story shape')
      : `Story shape (${blueprintCoverage.shapes.join(', ')}) requires the architecture evidence to address: ${missing.map((d) => d.label).join(', ')}. Add these to the architecture doc, or record a waiver against gate:architecture_blueprint.`
  };
}

function buildSafetySecretSurfaceGate(fileGroups, decisionRecords = null) {
  const files = detectSafetySurfaceFiles(fileGroups);
  if (files.length === 0) return null;
  const resolved = hasSafetyDecision(decisionRecords, 'gate:safety_secret_surface');
  return {
    id: 'gate:safety_secret_surface',
    type: 'safety_surface_gate',
    label: 'Secret/Credential Safety Gate',
    status: resolved ? 'passed' : 'needs_evidence',
    required: true,
    surface_files: files.slice(0, 20),
    reason: resolved
      ? 'Secret/credential surface change is covered by a recorded secret_exposure or waiver decision'
      : 'Change touches secret/credential surfaces; record a secret_exposure decision (--secret-action redacted|rotated|revoked|false_positive) or an explicit waiver against gate:safety_secret_surface before PR creation'
  };
}

function hasDeployVerificationEvidence({ verificationEvidence = null, decisionRecords = null } = {}) {
  if (findAcceptedDecisionForSource(decisionRecords, 'gate:deploy_verification')) return true;
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return commands.some((item) => {
    if (item.binding?.status !== 'current') return false;
    if (!['pass', 'passed', 'success', 'ok'].includes(item.status)) return false;
    const haystack = `${item.kind ?? ''}\n${item.command ?? ''}\n${item.summary ?? ''}\n${item.artifact ?? ''}`;
    return /\b(deploy|deployment|rollout|release|smoke|health\s*check|healthcheck|post-?deploy|prod(uction)?\s*verif)/i.test(haystack);
  });
}

/**
 * Route-independent, topology-driven gate. Fires only when (a) the Environment
 * Graph has real deploy targets and (b) the change is risk-bearing
 * (workflow_heavy / api_contract profile, or a release/mirror PR route).
 * pr prepare runs pre-merge, so it does not require a completed production
 * deploy; it requires the deploy/verification intent to be closed as evidence:
 * a current-bound deploy/smoke/health record, or an explicit waiver decision.
 * Returns null (gate absent, no friction) when there are no deploy targets or
 * the change is low-risk.
 */
function buildDeployVerificationGate({ environmentGraph = null, changeClassification = null, prRoute = null, verificationEvidence = null, decisionRecords = null } = {}) {
  const targets = deployTargetsFromGraph(environmentGraph);
  if (targets.length === 0) return null;
  const profile = changeClassification?.profile ?? null;
  const riskBearing = ['workflow_heavy', 'api_contract'].includes(profile)
    || ['mirror_sync', 'release_merge'].includes(prRoute?.route_type);
  if (!riskBearing) return null;
  const resolved = hasDeployVerificationEvidence({ verificationEvidence, decisionRecords });
  return {
    id: 'gate:deploy_verification',
    type: 'deploy_verification_gate',
    label: 'Deploy Verification Gate',
    status: resolved ? 'passed' : 'needs_evidence',
    required: true,
    deploy_targets: targets.map((t) => ({ id: t.id, type: t.type, provider: t.provider ?? null, environment: t.environment ?? null })),
    risk_profile: profile,
    reason: resolved
      ? 'Deploy/verification evidence (current-bound deploy/smoke/health record) or an explicit waiver decision is recorded for the change'
      : `Change is risk-bearing and the Environment Graph has ${targets.length} deploy target(s); record current-bound deploy/smoke/health evidence, or an explicit waiver against gate:deploy_verification, before PR creation`
  };
}

function hasAgentEvidenceLifecycle({ agentReviews = null, decisionRecords = null } = {}) {
  if (findAcceptedDecisionForSource(decisionRecords, 'gate:judgment_agent_workflow_evidence_lifecycle')) return true;
  if (!agentReviews) return false;
  const s = agentReviews.summary ?? {};
  if ((s.lifecycle_running_count ?? 0) > 0 || (s.lifecycle_timed_out_count ?? 0) > 0) {
    return false;
  }
  if (agentReviews.status === 'pass') return true;
  if ((s.required_review_count ?? 0) > 0
    && (s.unmet_required_review_count ?? 0) === 0
    && (s.unmet_checkpoint_review_count ?? 0) === 0
    && (s.stale_result_count ?? 0) === 0
    && (s.unverified_agent_result_count ?? 0) === 0
    && (s.block_result_count ?? 0) === 0) {
    return true;
  }
  const roles = (agentReviews.stages ?? []).flatMap((stage) => stage.roles ?? []);
  const passed = roles.filter((role) => role.effective_status === 'pass');
  const invalid = roles.filter((role) => ['missing', 'stale', 'unverified_agent', 'block', 'needs_changes'].includes(role.effective_status));
  return passed.length > 0 && invalid.length === 0;
}

function collectRequiredAgentReviewOwners(agentReviews = null) {
  const declaredRequiredReviews = [
    ...(agentReviews?.required_reviews ?? []),
    ...(agentReviews?.checkpoint_required_reviews ?? [])
  ];
  const requiredRoleKeys = new Set(declaredRequiredReviews.map((review) => (
    `${review.stage}:${review.role}`
  )));
  const roles = (agentReviews?.stages ?? []).flatMap((stage) => (
    (stage.roles ?? []).map((role) => ({
      stage: stage.stage,
      role: role.role,
      effective_status: role.effective_status,
      binding_mode: role.content_binding?.mode ?? null,
      reviewer_identity: role.agent_provenance?.reviewer_identity?.relation ?? 'unknown',
      reviewer_identity_source: role.agent_provenance?.reviewer_identity?.source ?? 'undeclared',
      reviewer_session_id: role.agent_provenance?.reviewer_identity?.reviewer_session_id ?? null,
      implementation_session_id: role.agent_provenance?.reviewer_identity?.implementation_session_id ?? null,
      lifecycle_status: role.lifecycle?.effective_status ?? null,
      surface_files: (role.content_binding?.surface_files ?? []).map((file) => (
        typeof file === 'string' ? file : file?.path
      )).filter(Boolean)
    })).filter((role) => requiredRoleKeys.has(`${role.stage}:${role.role}`))
  ));
  const resolvedRequiredRoleKeys = new Set(roles.map((role) => `${role.stage}:${role.role}`));
  const missingRequiredRoleKeys = [...requiredRoleKeys].filter((key) => !resolvedRequiredRoleKeys.has(key));
  const allRequiredRolesCurrent = requiredRoleKeys.size > 0
    && missingRequiredRoleKeys.length === 0
    && roles.length === requiredRoleKeys.size
    && roles.every((role) => (
    role.stage
      && role.role
      && role.effective_status === 'pass'
      && role.binding_mode === 'strict_head'
      && role.reviewer_identity === 'separate_session'
      && role.reviewer_identity_source === 'lifecycle_agent_binding'
      && role.reviewer_session_id
      && role.implementation_session_id
      && role.reviewer_session_id !== role.implementation_session_id
      && role.lifecycle_status === 'closed'
  ));
  return {
    roles,
    requiredRoleKeys,
    missingRequiredRoleKeys,
    allRequiredRolesCurrent
  };
}

export function buildAgentReviewOwnerMapEvidence(agentReviews = null, lanes = []) {
  const {
    roles,
    requiredRoleKeys,
    missingRequiredRoleKeys,
    allRequiredRolesCurrent
  } = collectRequiredAgentReviewOwners(agentReviews);
  const facets = lanes.map((lane) => {
    const changedPaths = [...new Set(lane.files ?? [])].filter(Boolean);
    const owners = roles.filter((role) => (
      role.effective_status === 'pass'
      && role.binding_mode === 'strict_head'
      && role.reviewer_identity === 'separate_session'
      && role.reviewer_identity_source === 'lifecycle_agent_binding'
      && role.reviewer_session_id
      && role.implementation_session_id
      && role.reviewer_session_id !== role.implementation_session_id
    )).map((role) => {
      const coveredPaths = changedPaths.filter((changedPath) => (
        role.surface_files.some((surfaceFile) => verificationTargetCoversChangedPath(surfaceFile, changedPath))
      ));
      return {
        stage: role.stage,
        role: role.role,
        effective_status: role.effective_status,
        binding_mode: role.binding_mode,
        reviewer_identity: role.reviewer_identity,
        reviewer_identity_source: role.reviewer_identity_source,
        reviewer_session_id: role.reviewer_session_id,
        implementation_session_id: role.implementation_session_id,
        covered_paths: coveredPaths
      };
    }).filter((owner) => owner.covered_paths.length > 0);
    const coveredPaths = new Set(owners.flatMap((owner) => owner.covered_paths));
    const uncoveredPaths = changedPaths.filter((changedPath) => !coveredPaths.has(changedPath));
    return {
      facet: lane.id,
      changed_paths: changedPaths,
      owners,
      uncovered_paths: uncoveredPaths,
      owned: allRequiredRolesCurrent && changedPaths.length > 0 && uncoveredPaths.length === 0
    };
  });
  const unownedFacets = facets.filter((facet) => !facet.owned).map((facet) => facet.facet);
  return {
    verified: facets.length > 0 && unownedFacets.length === 0,
    facets,
    unowned_facets: unownedFacets,
    required_role_keys: [...requiredRoleKeys],
    missing_required_role_keys: missingRequiredRoleKeys
  };
}

function hasAgentReviewOwnerMapEvidence(agentReviews = null) {
  return collectRequiredAgentReviewOwners(agentReviews).allRequiredRolesCurrent;
}

const BUG_PHYSICS_CLASSES = ['timing', 'state-invariant', 'deterministic-byte', 'observability', 'deployment'];

function buildBugPhysicsTriage({ storySource = {}, inferredSpec = null, verificationEvidence = null } = {}) {
  const evidenceText = [
    storyEvidenceText(storySource),
    bugPhysicsSpecText(inferredSpec)
  ].filter(Boolean).join('\n');
  const text = evidenceText.toLowerCase();
  const classes = BUG_PHYSICS_CLASSES.filter((className) => bugPhysicsClassMatchers[className].test(text));
  const probeEvidence = collectBugPhysicsProbeEvidence({ evidenceText, verificationEvidence });
  return {
    schema_version: '0.1.0',
    model: 'bug-physics-triage-v1',
    enum: BUG_PHYSICS_CLASSES,
    classes,
    active: classes.length > 0,
    probe_evidence: probeEvidence,
    gate_profile: buildBugPhysicsGateProfile(classes),
    contradiction_feedback: detectBugPhysicsContradiction(verificationEvidence)
  };
}

const bugPhysicsClassMatchers = {
  timing: /\b(timing|race|async|orphaned promise|intermittent|statistical|violation[-_\s]?rate|slo|settle[-_\s]?contract)\b|タイミング|競合|非同期/,
  'state-invariant': /\b(state[-_\s]?invariant|illegal[-_\s]?state|unrepresentable|by[-_\s]?construction|sticky[-_\s]?done|two visible surfaces|2 visible surfaces)\b|不正状態|状態不変/,
  'deterministic-byte': /\b(deterministic[-_\s]?byte|byte[-_\s]?sequence|real[-_\s]?byte|byte[-_\s]?fixture|headless replay|pty|xterm|alt[-_\s]?screen|terminal rendering|\\x1b)\b|バイト列|端末/,
  observability: /\b(observability|authoritative[-_\s]?signal|signal[-_\s]?source|signal[-_\s]?fusion|no reliable ground|monitoring|hook killed|indicator)\b|観測|監視|信号/,
  deployment: /\b(deployment|deploy|version[-_\s]?stamp|artifact version|running session|expected artifact|settings\.json|browser cache)\b|デプロイ|配布|実行中/
};

function bugPhysicsSpecText(inferredSpec) {
  const clauses = Array.isArray(inferredSpec?.clauses)
    ? inferredSpec.clauses.map((clause) => `${clause.id ?? ''} ${clause.type ?? ''} ${clause.statement ?? ''}`)
    : [];
  const questions = Array.isArray(inferredSpec?.open_questions)
    ? inferredSpec.open_questions.map((question) => `${question.id ?? ''} ${question.question ?? ''}`)
    : [];
  return [...clauses, ...questions].join('\n');
}

function collectBugPhysicsProbeEvidence({ evidenceText, verificationEvidence }) {
  const text = [
    evidenceText,
    bugPhysicsVerificationText(verificationEvidence)
  ].filter(Boolean).join('\n').toLowerCase();
  const probes = [
    ['phase_decomposition', /\b(phase[-_\s]?decompos|latency phase|timing phase)\b|フェーズ分解/],
    ['violation_rate', /\b(violation[-_\s]?rate|slo harness|statistical harness|settle[-_\s]?contract)\b/],
    ['real_byte_fixture', /\b(real[-_\s]?byte|byte[-_\s]?capture|byte[-_\s]?fixture|headless replay|pty|xterm)\b/],
    ['signal_availability', /\b(authoritative[-_\s]?signal|signal[-_\s]?availability|signal[-_\s]?source|monitoring)\b/],
    ['version_stamp', /\b(version[-_\s]?stamp|artifact version|running session|expected artifact)\b/],
    ['invariant_probe', /\b(illegal[-_\s]?state|unrepresentable|invariant unit|by[-_\s]?construction)\b/]
  ];
  return probes
    .filter(([, matcher]) => matcher.test(text))
    .map(([kind]) => ({ kind, source: 'story_spec_or_verification' }));
}

function buildBugPhysicsGateProfile(classes) {
  return {
    required: classes.map((className) => bugPhysicsProfileDefinitions[className]?.required).filter(Boolean),
    not_applicable: classes.flatMap((className) => bugPhysicsProfileDefinitions[className]?.not_applicable ?? [])
  };
}

const bugPhysicsProfileDefinitions = {
  timing: {
    required: {
      id: 'gate:bug_physics_timing_violation_rate',
      class: 'timing',
      label: 'Timing Violation-Rate Gate',
      evidence: /\b(violation[-_\s]?rate|slo harness|statistical harness|settle[-_\s]?contract|phase[-_\s]?decompos)\b/i,
      needs: 'timing bugs require phase decomposition plus violation-rate/SLO or settle-contract evidence'
    },
    not_applicable: [{
      id: 'gate:bug_physics_timing_single_shot_e2e_na',
      class: 'timing',
      label: 'Single-shot E2E N/A',
      reason: 'single-shot E2E green is not proof for statistical timing bugs'
    }]
  },
  'state-invariant': {
    required: {
      id: 'gate:bug_physics_state_invariant_design',
      class: 'state-invariant',
      label: 'Illegal State Unrepresentable Gate',
      evidence: /\b(illegal[-_\s]?state|unrepresentable|invariant unit|by[-_\s]?construction|state[-_\s]?invariant)\b/i,
      needs: 'state-invariant bugs require illegal-state-unrepresentable design and invariant regression evidence'
    },
    not_applicable: [{
      id: 'gate:bug_physics_state_slo_proof_only_na',
      class: 'state-invariant',
      label: 'SLO Proof-only N/A',
      reason: 'SLO/violation-rate can support but cannot be the primary proof for illegal-state bugs'
    }]
  },
  'deterministic-byte': {
    required: {
      id: 'gate:bug_physics_deterministic_byte_replay',
      class: 'deterministic-byte',
      label: 'Real-byte Replay Gate',
      evidence: /\b(real[-_\s]?byte|byte[-_\s]?capture|byte[-_\s]?fixture|headless replay|pty|xterm|deterministic[-_\s]?byte)\b/i,
      needs: 'deterministic-byte bugs require a real-byte fixture plus headless replay assertion'
    },
    not_applicable: [{
      id: 'gate:bug_physics_deterministic_byte_slo_na',
      class: 'deterministic-byte',
      label: 'Violation-rate SLO N/A',
      reason: 'fully deterministic byte bugs do not need violation-rate proof when real-byte replay is available'
    }]
  },
  observability: {
    required: {
      id: 'gate:bug_physics_observability_signal_source',
      class: 'observability',
      label: 'Authoritative Signal Source Gate',
      evidence: /\b(authoritative[-_\s]?signal|signal[-_\s]?source|signal[-_\s]?availability|monitoring|observability)\b/i,
      needs: 'observability bugs require a single authoritative signal source and monitoring evidence'
    },
    not_applicable: [{
      id: 'gate:bug_physics_observability_e2e_code_lane_na',
      class: 'observability',
      label: 'Spec/E2E Code Lane N/A',
      reason: 'observability bugs exit the code-gate lane when no reliable ground-truth signal exists in code'
    }]
  },
  deployment: {
    required: {
      id: 'gate:bug_physics_deployment_version_stamp',
      class: 'deployment',
      label: 'Version-stamp Propagation Gate',
      evidence: /\b(version[-_\s]?stamp|artifact version|running session|expected artifact|deployment stamp)\b/i,
      needs: 'deployment bugs require evidence that the running session reads the expected artifact version'
    },
    not_applicable: [{
      id: 'gate:bug_physics_deployment_code_gates_na',
      class: 'deployment',
      label: 'Code Gates N/A',
      reason: 'deployment bugs are outside code correctness; code gates are typed N/A unless code is also the selected physics class'
    }]
  }
};

function buildBugPhysicsTriageGate(triage) {
  const active = triage?.active === true;
  const hasProbe = (triage?.probe_evidence?.length ?? 0) > 0;
  return {
    id: 'gate:bug_physics_triage',
    type: 'bug_physics_triage_gate',
    label: 'Bug Physics Triage Gate',
    status: !active || hasProbe ? 'passed' : 'needs_evidence',
    required: true,
    classes: triage?.classes ?? [],
    enum: BUG_PHYSICS_CLASSES,
    probe_evidence: triage?.probe_evidence ?? [],
    reason: !active
      ? 'No bug-physics-specific route selected; ordinary gate profile remains in force'
      : hasProbe
        ? `Bug physics classes selected from probe evidence: ${(triage.classes ?? []).join(', ')}`
        : 'Active bug physics triage requires probe evidence before selecting a gate profile'
  };
}

function buildBugPhysicsProfileGates(triage, verificationEvidence) {
  const required = triage?.gate_profile?.required ?? [];
  const notApplicable = triage?.gate_profile?.not_applicable ?? [];
  return [
    ...required.map((definition) => {
      const passed = hasCurrentBugPhysicsEvidence(verificationEvidence, definition.evidence);
      return {
        id: definition.id,
        type: 'bug_physics_profile_gate',
        label: definition.label,
        status: passed ? 'passed' : 'needs_evidence',
        required: true,
        class: definition.class,
        selected_by: 'gate:bug_physics_triage',
        reason: passed
          ? `Current verification evidence satisfies ${definition.class} profile`
          : definition.needs
      };
    }),
    ...notApplicable.map((definition) => ({
      id: definition.id,
      type: 'typed_na_gate',
      label: definition.label,
      status: 'not_applicable',
      required: false,
      class: definition.class,
      selected_by: 'gate:bug_physics_triage',
      distinct_from: 'waiver',
      na_reason: definition.reason,
      reason: `Typed N/A: ${definition.reason}`
    }))
  ];
}

function buildBugPhysicsContradictionGate(triage, verificationEvidence) {
  const contradiction = triage?.contradiction_feedback ?? { detected: false };
  return {
    id: 'gate:bug_physics_contradiction_feedback',
    type: 'bug_physics_feedback_gate',
    label: 'Bug Physics Contradiction Feedback Gate',
    status: contradiction.detected ? 'failed' : 'passed',
    required: triage?.active === true,
    feedback_to: 'gate:bug_physics_triage',
    reason: contradiction.detected
      ? contradiction.reason
      : 'No evidence that the selected harness failed to reproduce the bug'
  };
}

export function bugPhysicsVerificationText(verificationEvidence) {
  return (verificationEvidence?.commands ?? [])
    .map((item) => {
      const observation = item.observation ?? {};
      const scenarios = Array.isArray(observation.scenarios) ? observation.scenarios : [];
      const values = observation.values && typeof observation.values === 'object'
        ? Object.entries(observation.values).flatMap(([key, value]) => [key, value])
        : [];
      return [
        item.kind,
        item.status,
        item.command,
        item.summary,
        item.artifact,
        ...scenarios,
        ...values
      ].filter(Boolean).join(' ');
    })
    .join('\n');
}

function hasCurrentBugPhysicsEvidence(verificationEvidence, matcher) {
  return (verificationEvidence?.commands ?? []).some((item) => {
    if (item.binding?.status !== 'current') return false;
    if (!['pass', 'passed', 'success', 'ok'].includes(item.status)) return false;
    return matcher.test(`${item.command ?? ''}\n${item.summary ?? ''}\n${item.artifact ?? ''}`);
  });
}

function detectBugPhysicsContradiction(verificationEvidence) {
  const current = (verificationEvidence?.commands ?? []).filter((item) => item.binding?.status === 'current');
  const contradiction = current.find((item) => /cannot reproduce|could not reproduce|failed to reproduce|not reproducible|0 reproductions|harness .*not .*reproduce/i.test(`${item.command ?? ''}\n${item.summary ?? ''}`));
  if (!contradiction) return { detected: false };
  return {
    detected: true,
    source: contradiction.command ?? contradiction.kind ?? 'verification_evidence',
    reason: 'Selected harness could not reproduce the bug; this is evidence of possible bug-physics misclassification and must loop back to triage'
  };
}

function buildGateDag({
  repoRoot,
  story,
  storySource,
  storySourceIntegrity = null,
  architectureDecision,
  requirementConsistency,
  designSsotReconciliation = null,
  responsibilityAuthority = null,
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
  decisionRecords = null,
  inferredSpec = null,
  designDiagramSpec = null,
  specDrift = null,
  changeClassification = null,
  engineeringJudgment = null,
  designInputJudgment = null,
  architectureSources = [],
  bugPhysicsTriage = null,
  architectureBlueprint = null,
  environmentGraph = null,
  git = null,
  scope = null,
  scopeBoundary = null,
  prRoute = null,
  graphContext = null,
  codeTopologyContext = null,
  journeyMap = null,
  managedWorktreeContext = null,
  managedWorktreeGate = null,
  validationSequenceEvaluation = null
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
    verificationEvidence,
    bugPhysicsTriage,
    changeClassification
  });
  const requirementGate = {
    id: 'gate:requirement',
    type: 'requirement_gate',
    label: 'Requirement Gate',
    status: resolveRequirementGateStatus(requirementConsistency),
    required: fileGroups.source.count > 0 || fileGroups.story_docs.count > 0 || fileGroups.policy_docs.count > 0,
    reason: buildRequirementGateReason(requirementConsistency),
    structured_evidence_guidance: buildRequirementStructuredEvidenceGuidance(requirementConsistency),
    deprecation_notices: requirementConsistency?.legacy_keyword_resolution_deprecations ?? []
  };
  const designSsotGate = buildDesignSsotGate(designSsotReconciliation, {
    artifact: `.vibepro/pr/${story.story_id}/design-ssot-reconciliation.json`
  });
  const responsibilityAuthorityGate = buildResponsibilityAuthorityGate(responsibilityAuthority);
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
  const storySourceIntegrityGate = buildStorySourceIntegrityGate(storySourceIntegrity);
  const architectureAxisQuality = buildArchitectureAxisQuality({
    engineeringJudgment,
    architectureDecision,
    architectureSources,
    decisionRecords
  });
  const architectureGate = {
    id: 'architecture',
    type: 'architecture_gate',
    label: 'Architecture Gate',
    status: architectureDecision.startsWith('ADRあり') || architectureDecision.startsWith('ADR不要') ? 'satisfied' : 'needs_review',
    required: true,
    reason: architectureDecision,
    axis_quality: architectureAxisQuality
  };
  const specGate = {
    ...buildSpecGateNode({ repoRoot, fileGroups, inferredSpec, specDrift, storySource }),
    required: true
  };
  const architectureBlueprintGate = buildArchitectureBlueprintGate(architectureBlueprint, decisionRecords);
  const routeGate = buildPrRouteGate(prRoute);
  const engineeringJudgmentGate = buildEngineeringJudgmentRouteGate(engineeringJudgment);
  const designInputJudgmentGate = buildDesignInputJudgmentGate({
    designInputJudgment,
    changeClassification,
    fileGroups,
    engineeringJudgment
  });
  const judgmentAxisGates = buildJudgmentAxisGates(engineeringJudgment);
  const commonJudgmentSpineGate = buildCommonJudgmentSpineGate(engineeringJudgment, {
    storySource,
    fileGroups,
    verificationEvidence,
    inferredSpec,
    changeClassification,
    agentReviews,
    decisionRecords,
    prRoute,
    graphContext,
    codeTopologyContext
  });
  const prScopeJudgmentGate = buildPrScopeJudgmentGate({ scope, fileGroups, git, prRoute, decisionRecords });
  const scopeBoundaryGate = buildScopeBoundaryGate({ scopeBoundary, git, decisionRecords });
  const bugPhysicsTriageGate = buildBugPhysicsTriageGate(bugPhysicsTriage);
  const bugPhysicsProfileGates = buildBugPhysicsProfileGates(bugPhysicsTriage, verificationEvidence);
  const bugPhysicsContradictionGate = bugPhysicsProfileGates.length > 0
    ? buildBugPhysicsContradictionGate(bugPhysicsTriage, verificationEvidence)
    : null;
  const routeSpecificJudgmentGates = buildRouteSpecificJudgmentGates(engineeringJudgment, {
    verificationEvidence,
    decisionRecords,
    agentReviews
  });
  const prBodyContractGate = buildPrBodyContractGate(prRoute, {
    storySource,
    fileGroups,
    scope,
    git,
    verificationEvidence,
    decisionRecords
  });
  const mirrorSourceTraceabilityGate = buildMirrorSourceTraceabilityGate(prRoute, git, decisionRecords);
  const ciStatusOrWaiverGate = buildCiStatusOrWaiverGate(prRoute, verificationEvidence, decisionRecords);
  const vibeproArtifactPolicyGate = buildVibeproArtifactPolicyGate(fileGroups, prRoute, decisionRecords);
  const splitResolutionGate = buildSplitResolutionGate(scope, prRoute, decisionRecords);
  const effectiveManagedWorktreeGate = managedWorktreeGate ?? buildManagedWorktreeGate(managedWorktreeContext);
  const safetySecretSurfaceGate = buildSafetySecretSurfaceGate(fileGroups, decisionRecords);
  const deployVerificationGate = buildDeployVerificationGate({ environmentGraph, changeClassification, prRoute, verificationEvidence, decisionRecords });
  const designDiagramsGate = buildDesignDiagramsGate({ storySource, fileGroups, inferredSpec: designDiagramSpec ?? inferredSpec });
  const changeClassificationGate = buildChangeClassificationGate(changeClassification);
  const prFreshnessGate = buildPrFreshnessGate(git, { verificationEvidence, agentReviews });
  const artifactConsistencyGate = buildArtifactConsistencyGate({
    git,
    verificationEvidence,
    agentReviews,
    managedWorktreeContext,
    changeClassification,
    storyId: story?.story_id ?? storySource?.story_id ?? storySource?.storyId ?? storySource?.id ?? null
  });
  const uiExperienceChange = hasUiExperienceSourceChange(fileGroups);
  const designQualityGate = designQualityEvidence ? {
    id: 'gate:design_quality',
    type: 'design_quality_gate',
    label: 'Design Quality DAG Gate',
    status: designQualityEvidence.status,
    required: true,
    reason: designQualityEvidence.status === 'ready_for_review'
      ? buildDesignQualityGateReadyReason(designQualityEvidence)
      : `Design Quality DAG needs evidence: ${designQualityEvidence.missing?.join(', ') || 'missing quality evidence'}`,
    artifacts: designQualityEvidence.artifacts,
    screen_count: designQualityEvidence.screen_count,
    evidence_status: designQualityEvidence.evidence_status,
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
      threshold_pct: run.threshold_pct ?? null,
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
  const decisionRecordGate = buildDecisionRecordGate(decisionRecords);
  const failureModeCoverageGate = buildFailureModeCoverageGate({
    storySource,
    fileGroups,
    changeClassification,
    verificationEvidence,
    inferredSpec
  });
  const fastLane = buildFastLaneEvaluation({
    prRoute,
    changeClassification,
    fileGroups,
    engineeringJudgment,
    safetySecretSurfaceGate,
    networkContracts
  });
  const agentReviewGate = buildAgentReviewGate(agentReviews, fileGroups, fastLane);
  const agentReviewDag = fastLane.applicable ? { nodes: [], terminal_nodes: [], stage_order: [] } : buildAgentReviewProcessDag(agentReviews);
  const fastLaneGate = fastLane.applicable ? buildFastLaneGate(fastLane) : null;
  const reviewInspectionRequiredGate = buildReviewInspectionRequiredGate({
    agentReviews,
    changeClassification,
    engineeringJudgment
  });
  const definitionOfDoneGate = buildDefinitionOfDoneGate({
    fileGroups,
    verificationEvidence,
    flowVerification,
    agentReviewGate
  });
  const pathSurfaceMatrixGate = buildPathSurfaceMatrixGate({
    storySource,
    fileGroups,
    changeClassification,
    verificationEvidence,
    flowVerification,
    decisionRecords
  });
  const journeyContextGate = buildJourneyContextGate(journeyMap, {
    uiExperienceChange,
    decisionRecords
  });
  const workflowHeavyGates = buildWorkflowHeavyGates({
    repoRoot,
    changeClassification,
    inferredSpec,
    flowVerification,
    e2eCoverage,
    verificationEvidence
  });
  const dagConnectivityGate = {
    id: 'gate:dag_connectivity',
    type: 'dag_connectivity_gate',
    label: 'DAG Connectivity Gate',
    status: 'pending',
    required: true,
    reason: 'DAG connectivity has not been evaluated yet'
  };
  const validationSequenceGate = {
    id: 'gate:validation_sequencing',
    type: 'validation_sequencing_gate',
    label: 'Risk-adaptive Validation Sequencing Gate',
    status: validationSequenceEvaluation?.status ?? 'not_applicable',
    required: validationSequenceEvaluation?.status !== 'not_applicable',
    reason: validationSequenceEvaluation?.ready_for_final_gate
      ? 'Targeted validation, advisory preflight, frozen expensive verification, and final current-head review are complete'
      : `Validation sequence is incomplete: ${(validationSequenceEvaluation?.blocking_phases ?? []).join(', ')}`,
    blocking_phases: validationSequenceEvaluation?.blocking_phases ?? []
  };
  const nodes = [
    storyGate,
    storySourceIntegrityGate,
    designInputJudgmentGate,
    engineeringJudgmentGate,
    commonJudgmentSpineGate,
    ...judgmentAxisGates,
    prScopeJudgmentGate,
    ...(scopeBoundaryGate ? [scopeBoundaryGate] : []),
    bugPhysicsTriageGate,
    ...bugPhysicsProfileGates,
    ...(bugPhysicsContradictionGate ? [bugPhysicsContradictionGate] : []),
    ...routeSpecificJudgmentGates,
    routeGate,
    prBodyContractGate,
    ...(mirrorSourceTraceabilityGate ? [mirrorSourceTraceabilityGate] : []),
    ...(ciStatusOrWaiverGate ? [ciStatusOrWaiverGate] : []),
    ...(vibeproArtifactPolicyGate ? [vibeproArtifactPolicyGate] : []),
    ...(splitResolutionGate ? [splitResolutionGate] : []),
    ...(effectiveManagedWorktreeGate ? [effectiveManagedWorktreeGate] : []),
    ...(safetySecretSurfaceGate ? [safetySecretSurfaceGate] : []),
    ...(deployVerificationGate ? [deployVerificationGate] : []),
    changeClassificationGate,
    prFreshnessGate,
    architectureGate,
    ...(architectureBlueprintGate ? [architectureBlueprintGate] : []),
    specGate,
    designDiagramsGate,
    {
      id: 'code',
      type: 'code_gate',
      label: 'Code Gate',
      status: fileGroups.source.count > 0 ? 'present' : 'not_required',
      files: fileGroups.source.files
    },
    networkContractGate,
    pathSurfaceMatrixGate,
    ...(journeyContextGate ? [journeyContextGate] : []),
    designSsotGate,
    responsibilityAuthorityGate,
    requirementGate,
    failureModeCoverageGate,
    decisionRecordGate,
    ...gates,
    ...(designQualityGate ? [designQualityGate] : []),
    ...(visualQaGate ? [visualQaGate] : []),
    ...workflowHeavyGates,
    validationSequenceGate,
    ...(fastLaneGate ? [fastLaneGate] : []),
    ...agentReviewDag.nodes,
    agentReviewGate,
    reviewInspectionRequiredGate,
    definitionOfDoneGate,
    artifactConsistencyGate,
    dagConnectivityGate,
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
    { from: 'story', to: 'gate:story_source_integrity' },
    { from: 'gate:story_source_integrity', to: 'gate:design_input_judgment' },
    { from: 'gate:design_input_judgment', to: 'gate:engineering_judgment_route' },
    { from: 'gate:engineering_judgment_route', to: 'gate:common_judgment_spine' },
    ...(judgmentAxisGates.length > 0
      ? judgmentAxisGates.flatMap((gate) => [
        { from: 'gate:common_judgment_spine', to: gate.id },
        { from: gate.id, to: 'gate:pr_scope_judgment' }
      ])
      : [{ from: 'gate:common_judgment_spine', to: 'gate:pr_scope_judgment' }]),
    ...(scopeBoundaryGate
      ? [
        { from: 'gate:pr_scope_judgment', to: 'gate:scope_boundary' },
        { from: 'gate:scope_boundary', to: 'gate:bug_physics_triage' }
      ]
      : [{ from: 'gate:pr_scope_judgment', to: 'gate:bug_physics_triage' }]),
    ...(routeSpecificJudgmentGates.length > 0
      ? routeSpecificJudgmentGates.flatMap((gate) => [
        { from: 'gate:bug_physics_triage', to: gate.id },
        { from: gate.id, to: 'gate:pr_route_classification' }
      ])
      : [{ from: 'gate:bug_physics_triage', to: 'gate:pr_route_classification' }]),
    ...bugPhysicsProfileGates.flatMap((gate) => [
      { from: 'gate:bug_physics_triage', to: gate.id },
      { from: gate.id, to: 'gate:bug_physics_contradiction_feedback' }
    ]),
    ...(bugPhysicsContradictionGate
      ? [
        { from: 'gate:bug_physics_contradiction_feedback', to: 'gate:bug_physics_triage', feedback: true, reason: 'selected harness contradiction loops back to triage' },
        { from: 'gate:bug_physics_contradiction_feedback', to: 'gate:change_classification' }
      ]
      : [{ from: 'gate:bug_physics_triage', to: 'gate:change_classification' }]),
    { from: 'gate:pr_route_classification', to: 'gate:pr_body_contract' },
    ...(mirrorSourceTraceabilityGate ? [
      { from: 'gate:pr_route_classification', to: 'gate:mirror_source_traceability' },
      { from: 'gate:mirror_source_traceability', to: 'gate:pr_body_contract' }
    ] : []),
    ...(ciStatusOrWaiverGate ? [
      { from: 'gate:pr_route_classification', to: 'gate:ci_status_or_waiver' },
      { from: 'gate:ci_status_or_waiver', to: 'gate:pr_body_contract' }
    ] : []),
    ...(vibeproArtifactPolicyGate ? [
      { from: 'gate:pr_route_classification', to: 'gate:vibepro_artifact_policy' },
      { from: 'gate:vibepro_artifact_policy', to: 'gate:pr_body_contract' }
    ] : []),
    ...(splitResolutionGate ? [
      { from: 'gate:pr_route_classification', to: 'gate:split_resolution' },
      { from: 'gate:split_resolution', to: 'gate:pr_body_contract' }
    ] : []),
    ...(safetySecretSurfaceGate ? [
      { from: 'gate:pr_route_classification', to: 'gate:safety_secret_surface' },
      { from: 'gate:safety_secret_surface', to: 'gate:pr_body_contract' }
    ] : []),
    ...(deployVerificationGate ? [
      { from: 'gate:pr_route_classification', to: 'gate:deploy_verification' },
      { from: 'gate:deploy_verification', to: 'gate:pr_body_contract' }
    ] : []),
    ...(effectiveManagedWorktreeGate ? [
      { from: 'gate:pr_body_contract', to: 'gate:managed_worktree' },
      { from: 'gate:managed_worktree', to: 'gate:change_classification' }
    ] : [
      { from: 'gate:pr_body_contract', to: 'gate:change_classification' }
    ]),
    { from: 'gate:change_classification', to: 'gate:pr_freshness' },
    { from: 'gate:pr_freshness', to: 'architecture' },
    { from: 'gate:pr_freshness', to: 'spec' },
    ...(architectureBlueprintGate
      ? [
        { from: 'architecture', to: 'gate:architecture_blueprint' },
        { from: 'gate:architecture_blueprint', to: 'code' }
      ]
      : [{ from: 'architecture', to: 'code' }]),
    { from: 'spec', to: 'gate:design_diagrams' },
    { from: 'gate:design_diagrams', to: 'code' },
    ...acceptanceNodes.flatMap((node) => [
      { from: 'story', to: node.id },
      { from: node.id, to: 'gate:requirement' },
      { from: node.id, to: 'gate:unit' },
      { from: node.id, to: 'gate:integration' },
      { from: node.id, to: 'gate:e2e' }
    ]),
    { from: 'code', to: 'gate:network_contract' },
    { from: 'gate:network_contract', to: 'gate:path_surface_matrix' },
    ...(journeyContextGate
      ? [
        { from: 'gate:path_surface_matrix', to: 'gate:journey_context' },
        { from: 'gate:journey_context', to: 'gate:design_ssot_reconciliation' }
      ]
      : [{ from: 'gate:path_surface_matrix', to: 'gate:design_ssot_reconciliation' }]),
    { from: 'gate:design_ssot_reconciliation', to: 'gate:responsibility_authority' },
    { from: 'gate:responsibility_authority', to: 'gate:requirement' },
    { from: 'gate:requirement', to: 'gate:failure_mode_coverage' },
    { from: 'gate:failure_mode_coverage', to: 'gate:decision_record' },
    { from: 'gate:decision_record', to: 'gate:unit' },
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
        stageUpstreams: buildAgentReviewStageUpstreams({ designQualityGate, visualQaGate }),
        fastLaneNodeId: fastLaneGate ? 'gate:fast_lane' : null
      })
    ] : [
      ...buildWorkflowHeavyEdges({
        workflowHeavyGates,
        defaultUpstreamNodeId: designQualityGate ? 'gate:design_quality' : 'gate:e2e'
      }),
      ...buildAgentReviewProcessEdges({
        defaultUpstreamNodeId: workflowHeavyGates.length > 0 ? 'gate:release_confidence' : designQualityGate ? 'gate:design_quality' : 'gate:e2e',
        agentReviewDag,
        stageUpstreams: buildAgentReviewStageUpstreams({ designQualityGate, visualQaGate }),
        fastLaneNodeId: fastLaneGate ? 'gate:fast_lane' : null
      })
    ]),
    { from: 'gate:agent_review', to: 'gate:review_inspection_required' },
    { from: 'gate:review_inspection_required', to: 'gate:definition_of_done' },
    { from: 'gate:definition_of_done', to: 'gate:artifact_consistency' },
    { from: 'gate:artifact_consistency', to: 'gate:validation_sequencing' },
    { from: 'gate:validation_sequencing', to: 'gate:dag_connectivity' },
    { from: 'gate:dag_connectivity', to: 'pr' }
  ];

  const allNodes = [...nodes, ...acceptanceNodes];
  Object.assign(dagConnectivityGate, buildDagConnectivityGate(allNodes, edges));
  const requiredGates = [
    storyGate,
    storySourceIntegrityGate,
    designInputJudgmentGate,
    engineeringJudgmentGate,
    commonJudgmentSpineGate,
    ...judgmentAxisGates,
    prScopeJudgmentGate,
    scopeBoundaryGate,
    bugPhysicsTriageGate,
    ...bugPhysicsProfileGates,
    bugPhysicsContradictionGate,
    ...routeSpecificJudgmentGates,
    routeGate,
    prBodyContractGate,
    mirrorSourceTraceabilityGate,
    ciStatusOrWaiverGate,
    vibeproArtifactPolicyGate,
    splitResolutionGate,
    effectiveManagedWorktreeGate,
    architectureGate,
    specGate,
    designDiagramsGate,
    changeClassificationGate,
    prFreshnessGate,
    networkContractGate,
    pathSurfaceMatrixGate,
    journeyContextGate,
    designSsotGate,
    responsibilityAuthorityGate,
    requirementGate,
    failureModeCoverageGate,
    decisionRecordGate,
    ...gates,
    designQualityGate,
    visualQaGate,
    ...workflowHeavyGates,
    ...agentReviewDag.nodes,
    agentReviewGate,
    reviewInspectionRequiredGate,
    definitionOfDoneGate,
    artifactConsistencyGate,
    validationSequenceGate,
    dagConnectivityGate
  ].filter((gate) => gate?.required);
  const needsEvidence = requiredGates.filter((gate) => isUnresolvedGateStatus(gate.status));
  const efficiency = buildAgentReviewEfficiencySummary(agentReviews, needsEvidence.length === 0);
  const suppressedJudgmentAxes = collectSuppressedJudgmentAxes(engineeringJudgment);
  return {
    schema_version: '0.1.0',
    model: 'story-acceptance-verification-dag',
    overall_status: needsEvidence.length > 0 ? 'needs_verification' : 'ready_for_review',
    story_id: story.story_id,
    summary: {
      acceptance_criteria_count: acceptanceCriteria.length,
      required_gate_count: requiredGates.length,
      needs_evidence_count: needsEvidence.length,
      engineering_judgment_route: engineeringJudgment?.route_type ?? null,
      engineering_judgment_dag: engineeringJudgment?.route_dag ?? null,
      active_judgment_axes: (engineeringJudgment?.judgment_axes ?? [])
        .filter((axis) => axis.status !== 'inactive')
        .map((axis) => axis.axis),
      suppressed_judgment_axes: suppressedJudgmentAxes,
      judgment_axis_count: judgmentAxisGates.length,
      judgment_axis_accepted_followup_count: judgmentAxisGates.filter((gate) => gate.status === 'accepted_followup').length,
      pr_scope_judgment_status: prScopeJudgmentGate.status,
      scope_boundary_status: scopeBoundaryGate?.status ?? null,
      bug_physics_classes: bugPhysicsTriage?.classes ?? [],
      bug_physics_profile_count: bugPhysicsTriage?.gate_profile?.required?.length ?? 0,
      pr_route: prRoute?.route_type ?? null,
      pr_body_template: prRoute?.body_template ?? null,
      story_status: storyGate.status,
      story_source_integrity_status: storySourceIntegrityGate.status,
      design_input_judgment_status: designInputJudgmentGate.status,
      architecture_status: architectureGate.status,
      architecture_axis_quality_status: architectureAxisQuality.status,
      spec_status: specGate.status,
      scenario_clauses: extractScenarioCoverageClauses(inferredSpec),
      path_surface_matrix_status: pathSurfaceMatrixGate.status,
      journey_context_status: journeyContextGate?.status ?? null,
      design_ssot_reconciliation_status: designSsotGate.status,
      responsibility_authority_status: responsibilityAuthorityGate.status,
      requirement_status: requirementGate.status,
      failure_mode_coverage_status: failureModeCoverageGate.status,
      decision_record_status: decisionRecordGate.status,
      review_inspection_required_status: reviewInspectionRequiredGate.status,
      artifact_consistency_status: artifactConsistencyGate.status,
      managed_worktree_status: effectiveManagedWorktreeGate?.status ?? null,
      correctness_ready: efficiency.correctness_ready,
      efficiency_debt: efficiency
    },
    nodes: allNodes,
    edges
  };
}

export function buildAgentReviewEfficiencySummary(agentReviews, correctnessReady = false) {
  const lifecycles = [];
  let duplicateDispatchCount = 0;
  for (const stage of agentReviews?.stages ?? []) {
    for (const role of stage.roles ?? []) {
      const lifecycle = role.lifecycle ?? {};
      for (let index = 0; index < (lifecycle.timed_out_count ?? 0); index += 1) lifecycles.push({ status: 'timed_out' });
      if (['obsolete', 'orphaned_agent'].includes(lifecycle.effective_status)) {
        lifecycles.push({ status: lifecycle.effective_status });
      }
      duplicateDispatchCount += Math.max(0, (lifecycle.running_count ?? 0) - 1);
    }
  }
  const delivery = agentReviews?.delivery_efficiency ?? {};
  const metrics = aggregateDeliveryMetrics({
    ...(delivery.measurements ?? {}),
    reviews: delivery.reviews
  });
  const budget = evaluateDeliveryBudget(delivery.policy ?? {}, metrics);
  const summary = summarizeEfficiencyDebt({
    correctness_ready: correctnessReady,
    lifecycles,
    duplicate_dispatch_count: duplicateDispatchCount,
    budget
  });
  return {
    ...summary,
    metrics,
    budget,
    attribution: {
      status: metrics.attribution_status ?? 'unknown',
      reason: delivery.attribution_reason ?? 'no session-cost attribution was connected to this PR preparation'
    },
    dispatch_decision: delivery.dispatch_decision ?? {
      status: 'unknown',
      reason: 'no concrete Story/stage/role/HEAD/surface dispatch request was evaluated'
    },
    repair: {
      batch_count: delivery.repair_batch_count ?? null,
      states: delivery.repair_states ?? []
    }
  };
}

async function buildDeliveryEfficiencyContext(repoRoot, storyId, agentReviews) {
  let policy = {};
  try {
    const config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
    policy = resolveEfficiencyPolicy(config, storyId) ?? {};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const reviews = [];
  const repairStates = [];
  for (const stage of agentReviews?.stages ?? []) {
    for (const role of stage.roles ?? []) {
      for (const lifecycle of stage.lifecycle?.entries ?? []) {
        if (lifecycle.role !== role.role) continue;
        reviews.push({
          role: role.role,
          started_at: lifecycle.started_at,
          finished_at: lifecycle.closed_at
        });
      }
      const repairPath = path.join(getWorkspaceDir(repoRoot), 'review-finding-repair', storyId, stage.stage, role.role, 'state.json');
      try {
        const state = JSON.parse(await readFile(repairPath, 'utf8'));
        repairStates.push({
          stage: stage.stage,
          role: role.role,
          status: state.status,
          repair_batch_count: Array.isArray(state.repair_batches) ? state.repair_batches.length : null
        });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const knownRepairCounts = repairStates.map((state) => state.repair_batch_count).filter(Number.isFinite);
  return {
    policy,
    reviews,
    measurements: {
      repair_batch_count: knownRepairCounts.length > 0 ? knownRepairCounts.reduce((sum, count) => sum + count, 0) : null,
      attribution_status: 'unknown'
    },
    attribution_reason: 'PR preparation has review lifecycle timing but no bounded session-cost attribution input',
    dispatch_decision: {
      status: 'unknown',
      reason: 'dispatch decisions are evaluated only for concrete current-HEAD review requests'
    },
    repair_batch_count: knownRepairCounts.length > 0 ? knownRepairCounts.reduce((sum, count) => sum + count, 0) : null,
    repair_states: repairStates
  };
}

function buildAgentReviewProcessDag(agentReviews) {
  const stages = agentReviews?.parallel_dispatch?.required_stages ?? [];
  if (!agentReviews?.required || stages.length === 0) return { nodes: [], terminal_nodes: [], stage_order: [] };
  const stageLookup = new Map((agentReviews.stages ?? []).map((stage) => [stage.stage, stage]));
  const requiredRoleLookup = new Map(stages.map((stage) => [stage.stage, new Set(stage.roles ?? [])]));
  const nodes = [];
  const joinNodes = [];
  const stageOrder = stages.map((stage) => stage.stage);
  for (const requiredStage of stages) {
    const stage = stageLookup.get(requiredStage.stage);
    const dispatchBatchId = `review:dispatch_batch:${requiredStage.stage}`;
    const prepareId = `review:prepare:${requiredStage.stage}`;
    const joinId = `review:join:${requiredStage.stage}`;
    const dispatch = stage?.parallel_dispatch ?? {};
    const dispatchPrepared = Boolean(dispatch.prepared || stage?.roles?.some((role) => role.artifact));
    const requiredRoles = requiredRoleLookup.get(requiredStage.stage);
    const stageRoleLookup = new Map((stage?.roles ?? []).map((item) => [item.role, item]));
    const stageRoles = requiredRoles
      ? [...requiredRoles].map((role) => stageRoleLookup.get(role) ?? {
        role,
        status: 'missing',
        effective_status: 'missing',
        summary: null,
        artifact: null
      })
      : (stage?.roles ?? []);
    const preflightItems = stageRoles.map((role) => buildAgentReviewDispatchPreflight(requiredStage.stage, role));
    const dispatchBatchStatus = resolveAgentReviewDispatchBatchStatus(preflightItems, dispatchPrepared);
    const recordStatuses = stageRoles.map((role) => normalizeAgentReviewRecordStatus(role.effective_status));
    const joinStatus = recordStatuses.some((status) => status === 'failed')
      ? 'failed'
      : recordStatuses.length > 0 && recordStatuses.every((status) => status === 'passed')
        ? 'passed'
        : 'needs_review';
    nodes.push({
      id: dispatchBatchId,
      type: 'agent_review_dispatch_batch_gate',
      label: `Review Dispatch Batch: ${requiredStage.stage}`,
      status: dispatchBatchStatus,
      required: true,
      serial_index: requiredStage.serial_index ?? stageOrder.indexOf(requiredStage.stage) + 1,
      depends_on_stage: requiredStage.depends_on_stage ?? null,
      next_stage: requiredStage.next_stage ?? null,
      dispatch_state: requiredStage.dispatch_state ?? null,
      role_count: stageRoles.length,
      dispatch_ready_count: preflightItems.filter((item) => item.status === 'passed').length,
      dispatch_blocker_count: preflightItems.filter((item) => item.status === 'failed').length,
      dispatch_warning_count: preflightItems.filter((item) => item.status === 'needs_review').length,
      reason: buildAgentReviewDispatchBatchReason(requiredStage.stage, preflightItems, dispatchPrepared)
    });
    for (const item of preflightItems) {
      nodes.push({
        id: item.id,
        type: 'agent_review_dispatch_preflight_gate',
        label: `Review Dispatch Preflight: ${item.role}`,
        status: item.status,
        required: true,
        stage: requiredStage.stage,
        role: item.role,
        preflight_kind: item.kind,
        reason: item.reason
      });
    }
    nodes.push({
      id: prepareId,
      type: 'agent_review_prepare_gate',
      label: `Review Prepare: ${requiredStage.stage}`,
      status: dispatchPrepared ? 'passed' : 'needs_review',
      required: true,
      serial_index: requiredStage.serial_index ?? stageOrder.indexOf(requiredStage.stage) + 1,
      depends_on_stage: requiredStage.depends_on_stage ?? null,
      next_stage: requiredStage.next_stage ?? null,
      dispatch_state: requiredStage.dispatch_state ?? null,
      command: requiredStage.prepare_command,
      artifact: requiredStage.dispatch_artifact,
      reason: dispatchPrepared
        ? 'Policy-aware agent review dispatch instructions were generated'
        : 'Policy-aware agent review dispatch instructions have not been generated'
    });

    for (const role of stageRoles) {
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
        reason: role.effective_status === 'stale'
          ? role.stale_reason ?? `Recorded ${requiredStage.stage}:${role.role} review is stale for the current git state`
          : role.summary ?? `Run the ${requiredStage.stage}:${role.role} agent review`
      });
      nodes.push({
        id: recordId,
        type: 'agent_review_record_gate',
        label: `Review Record: ${role.role}`,
        status: recordStatus,
        required: true,
        artifact: role.artifact,
        reason: buildAgentReviewRecordReason(requiredStage.stage, role)
      });
    }
    nodes.push({
      id: joinId,
      type: 'agent_review_stage_join_gate',
      label: `Review Stage Join: ${requiredStage.stage}`,
      status: joinStatus,
      required: true,
      serial_index: requiredStage.serial_index ?? stageOrder.indexOf(requiredStage.stage) + 1,
      depends_on_stage: requiredStage.depends_on_stage ?? null,
      next_stage: requiredStage.next_stage ?? null,
      role_count: stageRoles.length,
      reason: buildAgentReviewStageJoinReason(requiredStage.stage, joinStatus, stageRoles)
    });
    joinNodes.push(joinId);
  }
  return { nodes, terminal_nodes: joinNodes, stage_order: stageOrder };
}

function buildAgentReviewDispatchPreflight(stage, role) {
  const lifecycle = role.lifecycle ?? {};
  const latest = lifecycle.latest ?? {};
  const latestCloseReason = latest.close_reason ?? null;
  const preflightId = `review:preflight:${stage}:${role.role}`;
  if (lifecycle.effective_status === 'running' || lifecycle.running_count > 0) {
    return {
      id: preflightId,
      role: role.role,
      status: 'failed',
      kind: 'dedupe_running',
      reason: `A ${stage}:${role.role} review subagent is already running; close or record it before dispatching another reviewer for the same role`
    };
  }
  if (role.effective_status === 'stale') {
    return {
      id: preflightId,
      role: role.role,
      status: 'failed',
      kind: 'git_stability',
      reason: role.stale_reason ?? `Recorded ${stage}:${role.role} review is stale; rerun review prepare and dispatch only after evidence matches the current git state`
    };
  }
  if (lifecycle.effective_status === 'timed_out' || lifecycle.timed_out_count > 0) {
    return {
      id: preflightId,
      role: role.role,
      status: 'failed',
      kind: 'lifecycle_recovery',
      reason: `A ${stage}:${role.role} review lifecycle timed out; close it and record replacement evidence before starting a new dispatch batch`
    };
  }
  if (lifecycle.effective_status === 'manual_shutdown' || latestCloseReason === 'manual_shutdown') {
    return {
      id: preflightId,
      role: role.role,
      status: 'needs_review',
      kind: 'lifecycle_recovery',
      reason: `A ${stage}:${role.role} review lifecycle ended with manual_shutdown; record closure/replacement intent before re-dispatching`
    };
  }
  if (role.effective_status === 'pass') {
    if (isAgentReviewMergeDeltaReused(role)) {
      return {
        id: preflightId,
        role: role.role,
        status: 'passed',
        kind: 'dedupe_reused_merge_delta_pass',
        reason: `Recorded ${stage}:${role.role} review is accepted via merge-delta reuse for this head; do not dispatch a duplicate reviewer for the same role`
      };
    }
    return {
      id: preflightId,
      role: role.role,
      status: 'passed',
      kind: 'dedupe_current_pass',
      reason: `Current ${stage}:${role.role} review already passed; do not dispatch a duplicate reviewer for the same git state`
    };
  }
  if (role.effective_status === 'block' || role.effective_status === 'needs_changes') {
    return {
      id: preflightId,
      role: role.role,
      status: 'failed',
      kind: 'recorded_blocker',
      reason: role.summary ?? `Recorded ${stage}:${role.role} review must be resolved before re-dispatching`
    };
  }
  if (role.effective_status === 'unverified_agent') {
    return {
      id: preflightId,
      role: role.role,
      status: 'needs_review',
      kind: 'provenance_recovery',
      reason: role.provenance_reason ?? `Recorded ${stage}:${role.role} review lacks verified parallel subagent provenance; fix evidence before dispatching more reviewers`
    };
  }
  return {
    id: preflightId,
    role: role.role,
    status: 'passed',
    kind: 'ready_for_dispatch',
    reason: `${stage}:${role.role} has no current review result or active lifecycle blocker; it is eligible for the next stage-local dispatch batch`
  };
}

function resolveAgentReviewDispatchBatchStatus(preflightItems, dispatchPrepared) {
  if (preflightItems.some((item) => item.status === 'failed')) return 'failed';
  if (preflightItems.some((item) => item.status === 'needs_review')) return 'needs_review';
  return dispatchPrepared ? 'passed' : 'needs_review';
}

function buildAgentReviewDispatchBatchReason(stage, preflightItems, dispatchPrepared) {
  const blocked = preflightItems.filter((item) => item.status === 'failed');
  if (blocked.length > 0) {
    return `Do not dispatch ${stage} review batch until preflight blockers are resolved: ${blocked.map((item) => `${item.role}:${item.kind}`).join(', ')}`;
  }
  const warnings = preflightItems.filter((item) => item.status === 'needs_review');
  if (warnings.length > 0) {
    return `Review ${stage} dispatch preflight before starting more subagents: ${warnings.map((item) => `${item.role}:${item.kind}`).join(', ')}`;
  }
  return dispatchPrepared
    ? `All ${stage} role preflight checks passed and dispatch instructions are prepared`
    : `All ${stage} role preflight checks passed; run review prepare before dispatching the stage-local batch`;
}

function buildAgentReviewStageJoinReason(stage, status, roles) {
  if (status === 'passed') {
    const reusedCount = roles.filter((role) => isAgentReviewMergeDeltaReused(role)).length;
    return reusedCount > 0
      ? `All parallel ${stage} agent review roles are closed and accepted; ${reusedCount} role(s) use merge-delta reuse for this head`
      : `All parallel ${stage} agent review roles are closed and recorded for the current git state`;
  }
  if (status === 'failed') {
    return `At least one parallel ${stage} agent review role returned block`;
  }
  const remaining = roles
    .filter((role) => normalizeAgentReviewRecordStatus(role.effective_status) !== 'passed')
    .map((role) => role.role);
  return `Wait for all parallel ${stage} reviews to close and record before dispatching the next review stage${remaining.length > 0 ? `: ${remaining.join(', ')}` : ''}`;
}

function buildAgentReviewRecordReason(stage, role) {
  if (role.effective_status === 'pass') {
    if (isAgentReviewMergeDeltaReused(role)) {
      return `Recorded ${stage}:${role.role} review is accepted via merge-delta reuse for this head`;
    }
    return `Recorded ${stage}:${role.role} review for the current git state`;
  }
  if (role.effective_status === 'stale') {
    return role.stale_reason ?? `Recorded ${stage}:${role.role} review is stale for the current git state`;
  }
  if (role.effective_status === 'unverified_agent') {
    return role.provenance_reason ?? `Recorded ${stage}:${role.role} review is missing verified parallel subagent provenance`;
  }
  if (role.effective_status === 'block' || role.effective_status === 'needs_changes') {
    return role.summary ?? `Recorded ${stage}:${role.role} review did not pass`;
  }
  return role.artifact
    ? `Recorded ${stage}:${role.role} review is not accepted for the current git state`
    : `Record ${stage}:${role.role} with vibepro review record`;
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

function buildPrFreshnessGate(git, options = {}) {
  const freshness = git?.pr_freshness ?? null;
  const status = freshness?.status === 'passed' ? 'passed' : freshness?.status ?? 'needs_evidence';
  const evidenceBindings = collectPrFreshnessEvidenceBindings(options);
  return {
    id: 'gate:pr_freshness',
    type: 'pr_freshness_gate',
    label: 'PR Freshness Gate',
    status,
    required: true,
    base_ref: freshness?.base_ref ?? git?.base_ref ?? null,
    head_ref: freshness?.head_ref ?? git?.head_ref ?? null,
    base_sha: freshness?.base_sha ?? git?.base_sha ?? null,
    head_sha: freshness?.head_sha ?? git?.head_sha ?? null,
    merge_base_sha: freshness?.merge_base_sha ?? git?.merge_base_sha ?? null,
    head_contains_base: freshness?.head_contains_base ?? false,
    pr_prepare_regenerated_at_runtime: freshness?.pr_prepare_regenerated_at_runtime ?? true,
    required_actions: freshness?.required_actions ?? [
      'git fetch origin',
      'rebase the PR branch onto the current base ref',
      'rerun verification evidence',
      'rerun vibepro pr prepare'
    ],
    content_binding_details: {
      model: 'vibepro-content-scoped-evidence-freshness-v1',
      evidence_count: evidenceBindings.length,
      stale_evidence_count: evidenceBindings.filter((binding) => binding.status === 'stale').length,
      bindings: evidenceBindings
    },
    reason: freshness?.reason ?? 'PR freshness could not be proven'
  };
}

function collectPrFreshnessEvidenceBindings({ verificationEvidence = null, agentReviews = null } = {}) {
  const bindings = [];
  for (const command of verificationEvidence?.commands ?? []) {
    const contentBinding = command.binding?.content_binding ?? command.content_binding ?? null;
    if (!contentBinding) continue;
    bindings.push({
      artifact_type: 'verification_command',
      kind: command.kind ?? null,
      status: command.binding?.status ?? null,
      reason: command.binding?.reason ?? null,
      binding_mode: contentBinding.mode ?? null,
      surface_files: contentBinding.surface_files ?? [],
      changed_files: contentBinding.changed_files ?? [],
      missing_files: contentBinding.missing_files ?? [],
      recorded_surface_hash: contentBinding.recorded_surface_hash ?? contentBinding.surface_hash ?? null,
      current_surface_hash: contentBinding.current_surface_hash ?? null,
      recorded_head_sha: contentBinding.recorded_head_sha ?? command.git_context?.head_sha ?? null,
      current_head_sha: contentBinding.current_head_sha ?? null
    });
  }
  for (const stage of agentReviews?.stages ?? []) {
    for (const role of stage.roles ?? []) {
      const contentBinding = role.content_binding ?? null;
      if (!contentBinding) continue;
      bindings.push({
        artifact_type: 'agent_review_result',
        stage: stage.stage ?? null,
        role: role.role ?? null,
        status: role.binding_status ?? null,
        reason: role.stale_reason ?? null,
        binding_mode: contentBinding.mode ?? null,
        surface_files: contentBinding.surface_files ?? [],
        changed_files: contentBinding.changed_files ?? [],
        missing_files: contentBinding.missing_files ?? [],
        recorded_surface_hash: contentBinding.recorded_surface_hash ?? contentBinding.surface_hash ?? null,
        current_surface_hash: contentBinding.current_surface_hash ?? null,
        recorded_head_sha: contentBinding.recorded_head_sha ?? role.git_context?.head_sha ?? null,
        current_head_sha: contentBinding.current_head_sha ?? null
      });
    }
  }
  return bindings;
}

export function buildArtifactConsistencyGate({ git = null, verificationEvidence = null, agentReviews = null, managedWorktreeContext = null, changeClassification = null, storyId = null } = {}) {
  const managedWorktree = managedWorktreeContext?.managed_worktree ?? managedWorktreeContext;
  const current = {
    head_sha: git?.head_sha ?? null,
    status_fingerprint_hash: fingerprintHashForContext(git),
    user_status_fingerprint_hash: git?.user_status_fingerprint_hash ?? null,
    raw_status_fingerprint_hash: git?.status_fingerprint_hash ?? null,
    dirty: git?.dirty === true,
    raw_dirty: git?.raw_dirty === true,
    dirty_files: Array.isArray(git?.dirty_files)
      ? git.dirty_files.map(sanitizeChangedFileItemForOutput)
      : [],
    raw_dirty_files: Array.isArray(git?.raw_dirty_files)
      ? git.raw_dirty_files.map(sanitizeChangedFileItemForOutput)
      : [],
    vibepro_internal_dirty_files: Array.isArray(git?.vibepro_internal_dirty_files)
      ? git.vibepro_internal_dirty_files.map(sanitizeChangedFileItemForOutput)
      : [],
    fingerprint_scope: git?.fingerprint_scope ?? null,
    managed_worktree: managedWorktree ? {
      id: managedWorktree.id ?? null,
      path: managedWorktree.path ?? null,
      branch: managedWorktree.branch ?? null,
      head_sha: managedWorktree.current_head_sha ?? managedWorktree.head_sha ?? null,
      dirty: managedWorktree.dirty ?? null,
      dirty_fingerprint: managedWorktree.dirty_fingerprint ?? null,
      raw_dirty: managedWorktree.raw_dirty ?? null,
      raw_dirty_fingerprint: managedWorktree.raw_dirty_fingerprint ?? managedWorktree.raw_fingerprint ?? null,
      fingerprint_scope: managedWorktree.fingerprint_scope ?? null
    } : null
  };
  const artifacts = [
    ...collectVerificationArtifactBindings(verificationEvidence, changeClassification),
    ...collectReviewArtifactBindings(agentReviews, changeClassification)
  ];
  const inconsistent = artifacts.filter((artifact) => !isArtifactBindingAccepted(artifact.status));
  const staleArtifactDetails = inconsistent.map((artifact) => buildStaleArtifactDetail(artifact, { git, storyId }));
  const staleArtifactGroups = buildStaleArtifactGroups(staleArtifactDetails);
  const status = inconsistent.length === 0 ? 'passed' : 'stale_evidence';
  return {
    id: 'gate:artifact_consistency',
    type: 'artifact_consistency_gate',
    label: 'Artifact Consistency Gate',
    status,
    required: true,
    current,
    artifact_count: artifacts.length,
    inconsistent_artifact_count: inconsistent.length,
    artifacts,
    inconsistent_artifacts: inconsistent.slice(0, 20),
    stale_artifact_details: staleArtifactDetails,
    stale_artifact_groups: staleArtifactGroups,
    required_actions: buildArtifactConsistencyRequiredActions(status, staleArtifactDetails),
    reason: status === 'passed'
      ? artifacts.length > 0
        ? buildArtifactConsistencyPassedReason(artifacts)
        : 'No recorded verification/review artifacts are present; no cross-artifact binding conflict was found'
      : `${inconsistent.length} recorded verification/review artifact(s) are not bound to the current git state`
  };
}

function buildStaleArtifactDetail(artifact, { git = null, storyId = null } = {}) {
  const rootCause = deriveArtifactRootCause(artifact);
  const remediationCommands = buildArtifactRemediationCommands(artifact, storyId);
  const artifactPath = artifact.artifact ?? null;
  return {
    artifact_path: artifactPath,
    artifact_type: artifact.artifact_type ?? 'unknown',
    artifact_kind: artifact.kind ?? null,
    stage: artifact.stage ?? null,
    role: artifact.role ?? null,
    status: artifact.status ?? null,
    stale_reason: artifact.reason ?? 'artifact is not bound to the current git state',
    root_cause: rootCause,
    blocking: true,
    remediation_command: remediationCommands[0] ?? 'rerun current-bound VibePro evidence and rerun `vibepro pr prepare`',
    remediation_commands: remediationCommands,
    recorded_head_sha: artifact.recorded_head_sha ?? null,
    current_head_sha: git?.head_sha ?? null,
    recorded_status_fingerprint_hash: artifact.recorded_status_fingerprint_hash ?? null,
    current_status_fingerprint_hash: fingerprintHashForContext(git),
    content_binding: artifact.content_binding ?? null,
    dependency_chain: [
      {
        step: 'current_git_state',
        head_sha: git?.head_sha ?? null,
        status_fingerprint_hash: fingerprintHashForContext(git)
      },
      {
        step: 'recorded_artifact',
        artifact_path: artifactPath,
        head_sha: artifact.recorded_head_sha ?? null,
        status_fingerprint_hash: artifact.recorded_status_fingerprint_hash ?? null
      }
    ]
  };
}

function deriveArtifactRootCause(artifact) {
  const status = artifact.status ?? 'unknown';
  const reason = String(artifact.reason ?? '').toLowerCase();
  if (status === 'legacy' || reason.includes('not bound to a git head')) return 'missing_git_binding';
  if (status === 'unverified_agent' || reason.includes('unverified')) return 'unverified_agent_lifecycle';
  if (reason.includes('head')) return 'head_mismatch';
  if (reason.includes('dirty') || reason.includes('fingerprint')) return 'dirty_fingerprint_mismatch';
  if (reason.includes('provenance')) return 'missing_provenance';
  if (reason.includes('review') && reason.includes('closed')) return 'review_lifecycle_not_closed';
  if (reason.includes('summary')) return 'artifact_summary_mismatch';
  if (reason.includes('risk surface')) return 'risk_surface_changed';
  if (status === 'stale') return 'stale_binding';
  if (status === 'not_current' || status === 'unknown') return 'unproven_current_binding';
  return status;
}

function buildArtifactRemediationCommands(artifact, storyId = null) {
  const storyArg = storyId ? shellQuote(storyId) : '<story-id>';
  if (artifact.artifact_type === 'verification_command') {
    const kindArg = artifact.kind ? shellQuote(artifact.kind) : '<kind>';
    const commandArg = artifact.command ? ` --command ${shellQuote(artifact.command)}` : '';
    const summaryArg = artifact.summary ? ` --summary ${shellQuote(artifact.summary)}` : '';
    const artifactArg = artifact.artifact ? ` --artifact ${shellQuote(artifact.artifact)}` : '';
    const targetArgs = (artifact.observation?.targets ?? [])
      .map((target) => ` --target ${shellQuote(target)}`)
      .join('');
    const scenarioArgs = (artifact.observation?.scenarios ?? [])
      .map((scenario) => ` --scenario ${shellQuote(scenario)}`)
      .join('');
    const observedArgs = Object.entries(artifact.observation?.values ?? {})
      .map(([key, value]) => ` --observed ${shellQuote(`${key}=${value}`)}`)
      .join('');
    const strictFreshnessArg = artifact.content_binding?.mode === 'strict_head'
      ? ' --strict-head-binding'
      : '';
    return [
      `vibepro verify record . --id ${storyArg} --kind ${kindArg} --status pass${commandArg}${summaryArg}${artifactArg}${targetArgs}${scenarioArgs}${observedArgs}${strictFreshnessArg}`,
      `vibepro pr prepare . --story-id ${storyArg}`
    ];
  }
  if (artifact.artifact_type === 'agent_review_result') {
    const stageArg = artifact.stage ? shellQuote(artifact.stage) : '<stage>';
    const roleArg = artifact.role ? shellQuote(artifact.role) : '<role>';
    const recordCommand = buildReviewRecordCommandTemplate(
      storyId ?? '<story-id>',
      artifact.stage ?? '<stage>',
      artifact.role ?? '<role>'
    );
    const strictFreshnessArgs = artifact.content_binding?.mode === 'strict_head'
      ? ' --strict-head-binding --strict-head-reason "preserve the recorded strict HEAD freshness policy during recovery"'
      : '';
    return [
      `vibepro review prepare . --id ${storyArg} --stage ${stageArg}`,
      buildReviewStartCommandTemplate(storyId ?? '<story-id>', artifact.stage ?? '<stage>', artifact.role ?? '<role>'),
      `vibepro review close . --id ${storyArg} --stage ${stageArg} --role ${roleArg} --agent-id ${shellQuote('<agent-id>')} --close-reason completed --close-evidence ${shellQuote('<artifact>')}`,
      `${recordCommand}${strictFreshnessArgs}`,
      `vibepro pr prepare . --story-id ${storyArg}`
    ];
  }
  return [
    `vibepro pr prepare . --story-id ${storyArg}`
  ];
}

function buildStaleArtifactGroups(details = []) {
  const groups = new Map();
  for (const detail of details) {
    const key = `${detail.artifact_type ?? 'unknown'}:${detail.root_cause ?? 'unknown'}`;
    const group = groups.get(key) ?? {
      artifact_type: detail.artifact_type ?? 'unknown',
      root_cause: detail.root_cause ?? 'unknown',
      count: 0,
      artifact_paths: [],
      remediation_commands: []
    };
    group.count += 1;
    if (detail.artifact_path && group.artifact_paths.length < 10) group.artifact_paths.push(detail.artifact_path);
    for (const command of detail.remediation_commands ?? []) {
      if (!group.remediation_commands.includes(command) && group.remediation_commands.length < 10) {
        group.remediation_commands.push(command);
      }
    }
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function buildArtifactConsistencyRequiredActions(status, staleArtifactDetails = []) {
  if (status === 'passed') return [];
  const detailActions = staleArtifactDetails.slice(0, 5).map((detail) => {
    const artifact = detail.artifact_path ?? detail.artifact_type ?? 'artifact';
    return `${artifact}: ${detail.root_cause}; ${detail.remediation_command}`;
  });
  return [
    'Rerun current-bound verification evidence for stale command artifacts',
    'Rerun `vibepro review prepare`, close review subagents, and record current-git review results for stale review artifacts',
    ...detailActions,
    'Rerun `vibepro pr prepare` so Gate DAG, PR body, verification evidence, and review summary are bound to the same HEAD and dirty fingerprint'
  ];
}

function buildArtifactConsistencyPassedReason(artifacts = []) {
  const currentCount = artifacts.filter((artifact) => artifact.status === 'current').length;
  const reusedMergeDeltaCount = artifacts.filter((artifact) => artifact.status === 'reused_merge_delta').length;
  const reusedLowRiskCount = artifacts.filter((artifact) => artifact.status === 'reused_low_risk').length;
  const historicalNonblockingCount = artifacts.filter((artifact) => artifact.status === 'historical_nonblocking').length;
  const parts = [];
  if (currentCount > 0) parts.push(`${currentCount} current`);
  if (reusedMergeDeltaCount > 0) parts.push(`${reusedMergeDeltaCount} merge-delta reused`);
  if (reusedLowRiskCount > 0) parts.push(`${reusedLowRiskCount} low-risk reused`);
  if (historicalNonblockingCount > 0) parts.push(`${historicalNonblockingCount} historical nonblocking`);
  return `${artifacts.length} recorded verification/review artifact(s) accepted for artifact consistency (${parts.join(', ')}); reused artifacts are not labeled as current`;
}

function collectVerificationArtifactBindings(verificationEvidence = null, changeClassification = null) {
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return commands.map((command) => {
    const bindingStatus = command.binding?.status ?? (command.git_context?.head_sha ? 'unknown' : 'legacy');
    const reuseDecision = buildEvidenceReuseDecision({
      item: command,
      gate: gateForVerificationKind(command.kind),
      changeClassification
    });
    const reusableLowRisk = reuseDecision.status === 'reusable';
    const status = bindingStatus === 'current'
      ? 'current'
      : reusableLowRisk
        ? 'reused_low_risk'
        : bindingStatus;
    return {
      artifact_type: 'verification_command',
      kind: command.kind ?? null,
      command: command.command ?? null,
      summary: command.summary ?? null,
      artifact: command.artifact ?? null,
      observation: command.observation ?? null,
      recorded_head_sha: command.git_context?.head_sha ?? null,
      recorded_status_fingerprint_hash: fingerprintHashForContext(command.git_context),
      recorded_user_status_fingerprint_hash: command.git_context?.user_status_fingerprint_hash ?? null,
      status,
      content_binding: command.binding?.content_binding ?? command.content_binding ?? null,
      reuse_policy: reusableLowRisk ? changeClassification?.evidence_reuse_policy ?? null : null,
      scoped_reuse_decision: reuseDecision,
      reason: reusableLowRisk
        ? reuseDecision.reason
        : command.binding?.reason ?? (bindingStatus === 'legacy'
        ? 'verification evidence is not bound to a git head'
        : 'verification evidence binding could not be proven current')
    };
  });
}

function isArtifactBindingAccepted(status) {
  return status === 'current'
    || status === 'reused_low_risk'
    || status === 'reused_merge_delta'
    || status === 'historical_nonblocking';
}

function isAgentReviewMergeDeltaReused(role) {
  return role?.binding_status === 'reused_merge_delta' || role?.merge_delta_reuse?.reusable === true;
}

function collectReviewArtifactBindings(agentReviews = null, changeClassification = null) {
  const stages = Array.isArray(agentReviews?.stages) ? agentReviews.stages : [];
  const currentRequirementKeys = new Set([
    ...(agentReviews?.required_reviews ?? []),
    ...(agentReviews?.checkpoint_required_reviews ?? [])
  ].map((requirement) => `${requirement?.stage ?? ''}:${requirement?.role ?? ''}`));
  const explicitlySupersededKeys = new Set([
    ...(agentReviews?.risk_adaptive_coverage?.duplicate_checkpoint_roles_suppressed ?? []),
    ...(agentReviews?.risk_adaptive_coverage?.validation_sequence_review_roles ?? [])
  ]);
  const artifacts = [];
  for (const stage of stages) {
    for (const role of stage.roles ?? []) {
      if (!role.artifact) continue;
      const roleKey = `${stage.stage ?? ''}:${role.role ?? ''}`;
      const stale = role.effective_status === 'stale';
      const unverified = role.effective_status === 'unverified_agent';
      const historicalNonblocking = stale
        && explicitlySupersededKeys.has(roleKey)
        && !currentRequirementKeys.has(roleKey);
      const mergeDeltaReused = isAgentReviewMergeDeltaReused(role);
      const current = !stale && !unverified && !mergeDeltaReused;
      const staleReason = role.stale_reason ?? role.provenance_reason ?? role.summary ?? 'agent review result is missing, stale, or not accepted for the current git state';
      const reusableLowRisk = !current
        && !mergeDeltaReused
        && stale
        && canReuseLowRiskArtifactBinding({ status: 'pass', binding: { status: 'stale', reason: staleReason } }, changeClassification);
      const status = historicalNonblocking
        ? 'historical_nonblocking'
        : current
        ? 'current'
        : mergeDeltaReused
          ? 'reused_merge_delta'
          : reusableLowRisk
            ? 'reused_low_risk'
            : stale
              ? 'stale'
              : role.effective_status ?? 'not_current';
      artifacts.push({
        artifact_type: 'agent_review_result',
        stage: stage.stage ?? null,
        role: role.role ?? null,
        artifact: role.artifact ?? null,
        recorded_head_sha: role.git_context?.head_sha ?? role.source_git_context?.head_sha ?? null,
        recorded_status_fingerprint_hash: fingerprintHashForContext(role.git_context ?? role.source_git_context),
        recorded_user_status_fingerprint_hash: (role.git_context ?? role.source_git_context)?.user_status_fingerprint_hash ?? null,
        status,
        required_current: !historicalNonblocking,
        content_binding: role.content_binding ?? null,
        reuse_policy: mergeDeltaReused ? role.merge_delta_reuse ?? { mode: 'merge_delta_reuse' } : reusableLowRisk ? changeClassification?.evidence_reuse_policy ?? null : null,
        reason: historicalNonblocking
          ? 'review result is retained as audit history but is not part of the current PR-final or checkpoint-required review set'
          : current
          ? 'agent review result is bound to the current git state; review outcome is handled by Agent Review Gate'
          : mergeDeltaReused
            ? `merge-delta review reuse accepted for artifact consistency: ${staleReason}`
            : reusableLowRisk
              ? `low-risk evidence change reused agent review despite dirty fingerprint change: ${staleReason}`
              : staleReason
      });
    }
  }
  return artifacts;
}

function buildFailureModeCoverageGate({ storySource = null, fileGroups = null, changeClassification = null, verificationEvidence = null, inferredSpec = null } = {}) {
  const modes = deriveFailureModeCandidates({ storySource, fileGroups, changeClassification, inferredSpec });
  const highRisk = storySource?.pr_scope_strategy === 'atomic_single_pr'
    || changeClassification?.profile === 'workflow_heavy'
    || ['api_contract', 'auth', 'security', 'database', 'persistence', 'runtime_behavior', 'deploy'].some((surface) => (changeClassification?.risk_surfaces ?? []).includes(surface));
  const currentEvidence = (verificationEvidence?.commands ?? []).filter((command) => command.binding?.status === 'current');
  const coveredModes = modes.map((mode) => {
    const evidenceCommand = findFailureModeEvidenceCommand(mode, currentEvidence);
    return {
      ...mode,
      status: evidenceCommand ? 'covered' : highRisk ? 'missing_coverage' : 'not_required',
      evidence: evidenceCommand?.command ?? null
    };
  });
  const missing = coveredModes.filter((mode) => mode.status === 'missing_coverage');
  const status = missing.length === 0 ? 'passed' : 'missing_coverage';
  const acceptedCanonicalTerms = acceptedCanonicalEvidenceTermsForModes(missing.map((mode) => mode.id));
  return {
    id: 'gate:failure_mode_coverage',
    type: 'failure_mode_coverage_gate',
    label: 'Failure Mode Coverage Gate',
    status,
    required: true,
    high_risk: highRisk,
    candidate_count: coveredModes.length,
    missing_count: missing.length,
    modes: coveredModes,
    missing_modes: missing.map((mode) => mode.id),
    accepted_canonical_terms: acceptedCanonicalTerms,
    required_actions: missing.length === 0 ? [] : [
      `Record current-bound verification evidence for failure modes: ${missing.map((mode) => mode.id).join(', ')}`,
      acceptedCanonicalTerms.length > 0
        ? `Accepted canonical evidence terms: ${acceptedCanonicalTerms.join('; ')}`
        : null,
      'Use executable Unit/Integration/E2E/Flow evidence; source markers or static mentions alone do not satisfy failure-mode coverage',
      'If a mode is genuinely not applicable, record a decision with the non-applicability reason before PR creation'
    ].filter(Boolean),
    reason: missing.length === 0
      ? coveredModes.length === 0
        ? 'No route-specific failure mode candidates were detected'
        : `${coveredModes.length} failure mode candidate(s) are covered or not critical for this route profile`
      : `${missing.length} high-risk failure mode candidate(s) lack current verification evidence`
  };
}

function acceptedCanonicalEvidenceTermsForModes(modeIds) {
  return (modeIds ?? [])
    .filter((modeId) => CANONICAL_EVIDENCE_TOKEN_KINDS.includes(modeId))
    .map((modeId) => `${modeId} (${canonicalEvidenceTokenExamples(modeId).join(', ')})`);
}

function canonicalEvidenceTokenExamples(kind) {
  return [
    kind,
    kind.replaceAll('_', '-'),
    kind.replaceAll('_', ' ')
  ];
}

function deriveFailureModeCandidates({ storySource = null, fileGroups = null, changeClassification = null, inferredSpec = null } = {}) {
  const text = [
    storySource?.title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? []),
    ...(inferredSpec?.clauses ?? []).map((clause) => clause.statement)
  ].filter(Boolean).join('\n').toLowerCase();
  const files = [
    ...(fileGroups?.source?.files ?? []),
    ...(fileGroups?.tests?.files ?? []),
    ...(fileGroups?.other?.files ?? [])
  ].join('\n').toLowerCase();
  const runtimeSourceFiles = (fileGroups?.source?.files ?? []).join('\n').toLowerCase();
  const surfaces = new Set(changeClassification?.risk_surfaces ?? []);
  const typedAtomicScopeBoundary = storySource?.pr_scope_strategy === 'atomic_single_pr'
    || (storySource?.pr_scope_review_facets ?? []).length > 0
    || (storySource?.pr_scope_dependency_boundaries ?? []).length > 0;
  const candidates = [];
  const add = (id, reason, keywords) => {
    if (candidates.some((mode) => mode.id === id)) return;
    candidates.push({ id, reason, keywords });
  };
  if (/\b(timeout|deadline|time out|タイムアウト)\b/.test(text) || /\b(timeout|retry|poll)\b/.test(files)) {
    add('timeout', 'Timeout/deadline behavior is mentioned by Story or touched runtime code', ['timeout', 'deadline', 'time out']);
  }
  if (/\b(json|parse|parser|解析|パース)\b/.test(text) || /\b(parser|json|extract)\b/.test(runtimeSourceFiles)) {
    add('parse_failure', 'Parser/JSON extraction behavior can fail on malformed input', ['parse', 'parser', 'json', 'malformed']);
  }
  if (typedAtomicScopeBoundary || /\b(schema|validation|validate|検証)\b/.test(text) || /\b(schema|validator|validation)\b/.test(files)) {
    add('schema_failure', 'Schema/validation behavior can reject malformed or partial data', ['schema', 'validation', 'validate']);
  }
  if (/\b(provider|external|api|http|network|外部)\b/.test(text) || surfaces.has('api_contract')) {
    add('provider_failure', 'External provider/API/network dependency can fail or return incomplete data', ['provider', 'external', 'api', 'http', 'network']);
  }
  if (/\b(retry|queue|worker|poll|非同期)\b/.test(text) || /\b(queue|worker|retry|poll)\b/.test(files)) {
    add('retry_or_async_failure', 'Retry/queue/worker/polling paths can fail or duplicate work', ['retry', 'queue', 'worker', 'poll']);
  }
  if (/\b(auth|authentication|authorization|permission|access control|security|credential|認可|認証)\b/.test(text) || surfaces.has('auth') || surfaces.has('security')) {
    add('auth_denied', 'Auth/permission boundary can deny or leak access', ['auth', 'permission', 'security', 'denied']);
  }
  if (/\b(db|database|persist|保存|永続)\b/.test(text) || surfaces.has('database') || surfaces.has('persistence')) {
    add('persistence_failure', 'Persistence paths can fail or store partial state', ['database', 'persist', 'storage', 'db']);
  }
  if (surfaces.has('gate_orchestration')
    || surfaces.has('review_lifecycle')
    || /\b(evidence|artifact|gate|dag|review|provenance|handoff|waiver|followup|follow-up|fake green|fake-value)\b/.test(text)
    || /\b(agent-review|pr-manager|html-report|gate|dag|review)\b/.test(files)) {
    add(
      'evidence_lifecycle_regression',
      'Gate/review/evidence lifecycle changes can produce misleading green artifacts or unreconstructable handoffs',
      ['accepted_followup', 'needs_evidence', 'active_needs_evidence', 'provenance', 'inspection', 'gate-dag', 'pr-prepare', 'artifact replay']
    );
  }
  if (changeClassification?.profile === 'workflow_heavy'
    || surfaces.has('gate_orchestration')
    || surfaces.has('review_lifecycle')
    || /\b(workflow|state transition|lifecycle|dispatch|preflight|stale|pending)\b/.test(text)
    || /\b(workflow|lifecycle|dispatch|preflight)\b/.test(files)) {
    add(
      'workflow_state_regression',
      'Workflow/state transitions can leave stale, pending, or over-green gate states',
      ['flow_replay', 'artifact_replay', 'scenario_clause_e2e', 'workflow', 'state transition', 'stale']
    );
  }
  return candidates;
}

function findFailureModeEvidenceCommand(mode, currentEvidence) {
  let bestMatch = null;
  for (const command of currentEvidence ?? []) {
    if (!isExecutableFailureModeEvidence(command, mode)) continue;
    const resolvedEvidence = resolveVerificationCommandSearchText(command);
    const evidenceText = appendCanonicalEvidenceTokens(resolvedEvidence.surface_text.toLowerCase());
    const score = scoreFailureModeEvidence(mode, evidenceText);
    if (score > (bestMatch?.score ?? 0)) {
      bestMatch = { command, score };
    }
  }
  return bestMatch?.score > 0 ? bestMatch.command : null;
}

function isExecutableFailureModeEvidence(command, mode) {
  if (!isPassingVerificationStatus(command?.status)) return false;
  if (command?.observation_check?.status !== 'recorded') return false;
  if (!String(command?.command ?? '').trim()) return false;
  const resolvedEvidence = resolveVerificationCommandSearchText(command);
  if (resolvedEvidence.source !== 'structured_observation') return false;
  if ((resolvedEvidence.targets ?? []).length === 0) return false;
  if (!String(resolvedEvidence.surface_text ?? '').trim()) return false;
  const scenarioAssertion = (command?.observation?.scenarios ?? [])
    .map((scenario) => String(scenario))
    .join('\n');
  const observedValues = command?.observation?.values;
  const observedAssertion = observedValues && typeof observedValues === 'object'
    ? Object.entries(observedValues).map(([key, value]) => `${key}=${String(value)}`).join('\n')
    : '';
  return scoreFailureModeEvidence(mode, scenarioAssertion) > 0
    || scoreFailureModeEvidence(mode, observedAssertion) > 0;
}

function failureModeCoveredByEvidence(mode, evidenceText) {
  return scoreFailureModeEvidence(mode, evidenceText) > 0;
}

function scoreFailureModeEvidence(mode, evidenceText) {
  if (!evidenceText) return 0;
  const normalizedText = appendCanonicalEvidenceTokens(String(evidenceText ?? '').toLowerCase());
  const modeId = String(mode?.id ?? '').toLowerCase();
  if (modeId && normalizedText.includes(modeId)) return 100;
  const keywords = (mode?.keywords ?? [])
    .map((keyword) => String(keyword).toLowerCase())
    .filter(Boolean);
  if (modeId === 'parse_failure') {
    const strongParseKeywords = keywords.filter((keyword) => keyword !== 'json');
    return strongParseKeywords.some((keyword) => normalizedText.includes(keyword)) ? 80 : 0;
  }
  const matchCount = keywords.filter((keyword) => normalizedText.includes(keyword)).length;
  return matchCount > 0 ? 10 + matchCount : 0;
}

function buildJourneyContextGate(journeyMap, { uiExperienceChange = false, decisionRecords = null } = {}) {
  if (!uiExperienceChange) return null;
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:journey_context');
  const affectedConflicts = (journeyMap?.affected_conflicts ?? []).filter((conflict) => !isCuratedJourneyItemHandled(conflict));
  const affectedOpenQuestions = journeyMap?.affected_open_questions ?? [];
  const blockerQuestions = affectedOpenQuestions.filter((question) => question.blocker === true && !isCuratedJourneyItemHandled(question));
  const affectedWalkingSkeleton = (journeyMap?.affected_release_slices ?? [])
    .some((slice) => slice.kind === 'walking_skeleton' || slice.slice_id === 'walking_skeleton');
  const walkingSkeletonGap = affectedWalkingSkeleton && journeyMap?.walking_skeleton_status === 'needs_evidence';
  const status = acceptedDecision
    ? 'accepted_followup'
    : !journeyMap || journeyMap.status === 'missing'
      ? 'needs_evidence'
      : !journeyMap.current_story
        ? 'needs_review'
        : affectedConflicts.length > 0
          ? 'needs_review'
          : blockerQuestions.length > 0 || walkingSkeletonGap
            ? 'needs_evidence'
            : journeyMap.status === 'needs_curated_journey'
              ? 'needs_review'
              : 'passed';
  const reasons = [];
  if (!journeyMap || journeyMap.status === 'missing') {
    reasons.push('UI experience source changed but no Journey context pack is generated');
  } else if (journeyMap.status === 'needs_curated_journey') {
    reasons.push('UI experience source changed and only machine-derived Journey handoff context exists; curated Journey is still required');
  } else if (!journeyMap.current_story) {
    reasons.push('UI experience source changed but the current Story is not placed on the Journey Map');
  } else {
    reasons.push(`Current Story Journey step: ${journeyMap.current_story.activity_id}/${journeyMap.current_story.step_id}`);
  }
  if (affectedConflicts.length > 0) {
    reasons.push(`${affectedConflicts.length} Journey conflict(s) affect the current Story or step`);
  }
  if (blockerQuestions.length > 0) {
    reasons.push(`${blockerQuestions.length} blocking Journey open question(s) affect the current Story or step`);
  }
  if (walkingSkeletonGap) {
    reasons.push('Current Story is in the walking skeleton while walking skeleton Journey coverage still needs evidence');
  }
  if (acceptedDecision) {
    reasons.push(`Journey context follow-up accepted by decision record: ${acceptedDecision.summary ?? acceptedDecision.source}`);
  }
  return {
    id: 'gate:journey_context',
    type: 'journey_context_gate',
    label: 'Journey Context Gate',
    status,
    required: true,
    journey_status: journeyMap?.status ?? 'missing',
    journey_id: journeyMap?.journey_id ?? null,
    artifact_kind: journeyMap?.artifact_kind ?? null,
    curated: journeyMap?.curated === true,
    handoff_available: journeyMap?.handoff_available === true,
    curation_status: journeyMap?.curation_status ?? null,
    curated_journey_path: journeyMap?.curated_journey_path ?? null,
    current_story: journeyMap?.current_story ?? null,
    walking_skeleton_status: journeyMap?.walking_skeleton_status ?? null,
    affected_release_slices: journeyMap?.affected_release_slices ?? [],
    affected_conflicts: affectedConflicts,
    affected_open_questions: affectedOpenQuestions,
    accepted_decision: acceptedDecision ? {
      source: acceptedDecision.source ?? null,
      summary: acceptedDecision.summary ?? null,
      reviewer: acceptedDecision.reviewer ?? null
    } : null,
    required_actions: status === 'passed' || status === 'accepted_followup' ? [] : [
      'Run `vibepro journey handoff .` so UI changes are reviewed against the latest Journey context pack',
      'Create or attach a curated Journey when the product Journey must be treated as settled',
      'Place the changed Story on a Journey step or record why this UI change has no Journey impact',
      'Resolve affected Journey conflicts/open questions, or record an auditable `gate:journey_context` decision'
    ],
    reason: reasons.join('; ')
  };
}

function isCuratedJourneyItemHandled(item) {
  const status = String(item?.curation?.status ?? '').toLowerCase();
  return ['resolved', 'accepted', 'answered', 'deferred'].includes(status);
}

function buildVerificationCommandSearchText(command) {
  return resolveVerificationCommandSearchText(command).text;
}

function resolveVerificationCommandSearchText(command) {
  if (['recorded', 'partial'].includes(command?.observation_check?.status)) {
    const observation = command?.observation ?? {};
    const observedValues = observation.values && typeof observation.values === 'object'
      ? Object.entries(observation.values).flatMap(([key, value]) => [key, String(value)])
      : [];
    const structuredText = [
      ...(observation.targets ?? []),
      ...(observation.scenarios ?? []),
      ...observedValues
    ].filter(Boolean).join('\n');
    if (structuredText.trim()) {
      return {
        text: structuredText,
        source: command?.observation_check?.status === 'recorded'
          ? 'structured_observation'
          : 'partial_structured_observation',
        targets: observation.targets ?? [],
        surface_text: [
          ...(observation.scenarios ?? []),
          ...observedValues
        ].filter(Boolean).join('\n'),
        deprecation: null
      };
    }
  }
  const legacyText = [
    command?.command,
    command?.summary,
    command?.artifact
  ].filter(Boolean).join('\n');
  if (!legacyText.trim()) {
    return {
      text: '',
      source: 'missing',
      deprecation: null
    };
  }
  return {
    text: legacyText,
    source: 'legacy_summary_keyword',
    deprecation: legacyKeywordResolutionDeprecation()
  };
}

function legacyKeywordResolutionDeprecation() {
  return {
    status: 'deprecated',
    replacement: 'verify record --target/--scenario/--observed',
    removal_not_before: '2026-08-05',
    reason: 'Keyword matching from free-form command/summary text is migration-only compatibility; record structured observation fields instead.'
  };
}

function canResolutionSatisfyPathSurfaceCoverage(resolution) {
  return ['structured_observation', 'legacy_summary_keyword'].includes(resolution?.source);
}

function buildPathSurfaceMatrixGate({ storySource = null, fileGroups = null, changeClassification = null, verificationEvidence = null, flowVerification = null, decisionRecords = null } = {}) {
  const surfaces = derivePathSurfaceRows({ storySource, fileGroups, changeClassification });
  const requireTargetCoverage = storySource?.pr_scope_strategy === 'atomic_single_pr';
  const currentVerification = (verificationEvidence?.commands ?? []).filter((command) => command.binding?.status === 'current');
  const flowEvidenceText = buildFlowVerificationSurfaceSearchText(flowVerification);
  const highRisk = changeClassification?.profile === 'workflow_heavy';
  const rows = surfaces.map((surface) => {
    let verificationEvidenceItem = null;
    let verificationResolution = null;
    for (const command of currentVerification) {
      const resolution = resolveVerificationCommandSearchText(command);
      if (!canResolutionSatisfyPathSurfaceCoverage(resolution)) continue;
      if (pathSurfaceCoveredByResolution(surface, resolution, { requireTargetCoverage })) {
        verificationEvidenceItem = command;
        verificationResolution = resolution;
        break;
      }
    }
    const flowEvidence = !requireTargetCoverage
      && !verificationEvidenceItem
      && pathSurfaceCoveredByEvidence(surface, flowEvidenceText);
    const evidence = Boolean(verificationEvidenceItem || flowEvidence);
    const required = highRisk || surface.required;
    return {
      ...surface,
      required,
      status: evidence ? 'covered' : required ? 'missing_surface_evidence' : 'not_required',
      evidence: evidence
        ? verificationEvidenceItem?.command ?? 'flow_verification'
        : null,
      resolution_source: verificationResolution?.source ?? (flowEvidence ? 'flow_verification' : null),
      ...(verificationResolution?.deprecation ? { deprecation: verificationResolution.deprecation } : {})
    };
  });
  const missing = rows.filter((row) => row.status === 'missing_surface_evidence');
  const deprecationNotices = rows
    .filter((row) => row.deprecation)
    .map((row) => ({
      surface: row.surface,
      path_type: row.path_type,
      resolution_source: row.resolution_source,
      ...row.deprecation
    }));
  const acceptedDecision = findAcceptedDecisionForSource(decisionRecords, 'gate:path_surface_matrix');
  const status = missing.length === 0 || acceptedDecision ? 'passed' : 'partial_surface';
  return {
    id: 'gate:path_surface_matrix',
    type: 'path_surface_matrix_gate',
    label: 'Path Surface Matrix Gate',
    status,
    required: true,
    high_risk: highRisk,
    target_binding_mode: requireTargetCoverage ? 'atomic_changed_paths' : 'legacy_surface_signal',
    row_count: rows.length,
    missing_surface_count: missing.length,
    accepted_decision: acceptedDecision ? {
      source: acceptedDecision.source ?? null,
      summary: acceptedDecision.summary ?? null,
      reviewer: acceptedDecision.reviewer ?? null
    } : null,
    rows,
    missing_surfaces: missing.map((row) => row.surface),
    deprecation_notices: deprecationNotices,
    structured_evidence_guidance: {
      accepted_fields: ['--target <changed path>', '--scenario "path_surface:<surface>"', '--observed "surface=<surface>"'],
      command_template: 'vibepro verify record . --id <story-id> --kind integration --status pass --command "<focused command>" --target "<changed path>" --scenario "path_surface:<surface>" --observed "surface=<surface>"'
    },
    required_actions: missing.length === 0 ? [] : [
      `Record current-bound verification evidence for changed surface(s): ${[...new Set(missing.map((row) => row.surface))].join(', ')}`,
      'Use structured observation fields: --target "<changed path>" --scenario "path_surface:<surface>" --observed "surface=<surface>"',
      'Trace the value/state from input through persistence/API/UI/report/review surface, or mark the surface not applicable with an auditable decision',
      'Rerun `vibepro pr prepare` after the surface evidence is recorded'
    ],
    reason: acceptedDecision
      ? `Path/surface matrix accepted by decision record: ${acceptedDecision.summary ?? acceptedDecision.source}`
      : missing.length === 0
      ? rows.length === 0
        ? 'No user-visible or cross-surface path rows were detected'
        : `${rows.length} path surface row(s) are covered or not critical for this route`
      : `${missing.length} changed path surface row(s) lack current evidence`
  };
}

function derivePathSurfaceRows({ storySource = null, fileGroups = null, changeClassification = null } = {}) {
  const rows = [];
  const atomicTargetBinding = storySource?.pr_scope_strategy === 'atomic_single_pr';
  const files = [...new Set(Object.entries(fileGroups ?? {})
    .filter(([group]) => group !== 'vibepro_artifacts')
    .flatMap(([, value]) => value?.files ?? []))].sort();
  const text = [
    storySource?.title,
    storySource?.background,
    storySource?.policy,
    ...(storySource?.acceptance_criteria ?? [])
  ].filter(Boolean).join('\n').toLowerCase();
  const add = (surface, pathType, reason, required = false, changedPath = null) => {
    const existing = rows.find((row) => row.surface === surface && row.path_type === pathType);
    if (existing) {
      if (atomicTargetBinding && changedPath && !existing.changed_paths.includes(changedPath)) existing.changed_paths.push(changedPath);
      return;
    }
    rows.push({
      surface,
      path_type: pathType,
      reason,
      required,
      ...(atomicTargetBinding ? { changed_paths: changedPath ? [changedPath] : [] } : {})
    });
  };
  if (atomicTargetBinding && files.length > 0) {
    for (const file of files) {
      add('changed_path_inventory', 'atomic_changed_path_surface', 'Atomic scope requires current evidence for every changed path', true, file);
    }
  }
  for (const file of files) {
    const normalized = file.toLowerCase();
    if (/\.(tsx|jsx|vue|svelte)$/.test(normalized) || normalized.includes('/components/') || normalized.includes('/app/')) {
      add('ui', 'output_surface', `UI file changed: ${file}`, true, file);
    }
    if (normalized.includes('/api/') || /route\.(ts|js)$/.test(normalized)) {
      add('api', 'contract_surface', `API route/client file changed: ${file}`, true, file);
    }
    if (normalized.includes('/services/') || normalized.includes('/lib/')) {
      add('service', 'transform_surface', `Service/transform file changed: ${file}`, false, file);
    }
    if (normalized.includes('/worker') || normalized.includes('/queue')) {
      add('worker', 'async_surface', `Worker/queue file changed: ${file}`, true, file);
    }
    if (atomicTargetBinding && pathImpliesCliSurface(normalized)) {
      add('cli', 'public_contract_surface', `CLI entrypoint/command file changed: ${file}`, true, file);
    }
    if (atomicTargetBinding && pathImpliesStateTransitionSurface(normalized)) {
      add('state', 'state_transition_surface', `State transition/ledger file changed: ${file}`, true, file);
    }
    if (atomicTargetBinding && pathImpliesManagedProcessSurface(normalized)) {
      add('process', 'external_process_surface', `Managed external-process file changed: ${file}`, true, file);
    }
    if (normalized.includes('pr-manager') || normalized.includes('report') || normalized.includes('html-report')) {
      add('review_surface', 'gate_or_report_surface', `Gate/report artifact code changed: ${file}`, true, file);
    }
    if (pathImpliesPersistenceSurface(normalized, { includeAtomicAliases: atomicTargetBinding })) {
      add('persistence', 'state_surface', `Persistence/schema file changed: ${file}`, true, file);
    }
  }
  if (/\b(report|summary|hq|review|artifact|pr body|gate)\b/.test(text)) {
    add('review_surface', 'story_surface', 'Story mentions report/review/gate artifact output', true);
  }
  if (/\b(ui|screen|browser|画面)\b/.test(text)) {
    add('ui', 'story_surface', 'Story mentions UI/screen output', false);
  }
  if (/\b(api|http|network)\b/.test(text) || (changeClassification?.risk_surfaces ?? []).includes('api_contract')) {
    add('api', 'story_surface', 'Story or classifier mentions API/network surface', false);
  }
  return rows;
}

function pathImpliesPersistenceSurface(normalizedPath, { includeAtomicAliases = false } = {}) {
  const normalized = String(normalizedPath ?? '').toLowerCase();
  if (!normalized) return false;
  if (/^docs\/(management\/stories|stories|specs)\/story-/.test(normalized)) return false;
  const pattern = includeAtomicAliases
    ? /(^|[\/._-])(database|db|prisma|schema|migrations?|persistence|atomic-file)(?=$|[\/._-])/
    : /(^|[\/._-])(database|db|prisma|schema|migrations?)(?=$|[\/._-])/;
  return pattern.test(normalized);
}

function pathImpliesCliSurface(normalizedPath) {
  const normalized = String(normalizedPath ?? '').toLowerCase();
  return normalized === 'src/cli.js'
    || normalized === 'bin/vibepro.js'
    || /(^|\/)cli(?=$|[\/._-])/.test(normalized);
}

function pathImpliesStateTransitionSurface(normalizedPath) {
  const normalized = String(normalizedPath ?? '').toLowerCase();
  if (!normalized || normalized.startsWith('docs/')) return false;
  return /(^|[\/._-])(outcome-manager|decision-outcome-ledger|state-manager)(?=$|[\/._-])/.test(normalized);
}

function pathImpliesManagedProcessSurface(normalizedPath) {
  const normalized = String(normalizedPath ?? '').toLowerCase();
  if (!normalized || normalized.startsWith('docs/')) return false;
  return /(^|[\/._-])managed-command-executor(?=$|[\/._-])/.test(normalized);
}

function pathSurfaceCoveredByEvidence(surface, evidenceText) {
  if (!evidenceText) return false;
  const terms = {
    ui: ['ui', 'screen', 'browser', 'playwright', 'visual'],
    api: ['api', 'http', 'network', 'route'],
    service: ['service', 'transform', 'unit'],
    worker: ['worker', 'queue', 'retry', 'async', 'poll'],
    cli: ['cli'],
    state: ['state', 'outcome', 'ledger'],
    process: ['process', 'executor'],
    review_surface: ['gate', 'report', 'pr body', 'artifact', 'review'],
    persistence: ['database', 'db', 'schema', 'persist', 'persistence', 'storage'],
    changed_path_inventory: ['changed_path_inventory', 'changed path', 'path surface', 'atomic scope']
  }[surface.surface] ?? [surface.surface];
  return terms.some((term) => evidenceTextContainsSurfaceTerm(evidenceText, term));
}

function pathSurfaceCoveredByResolution(surface, resolution, { requireTargetCoverage = false } = {}) {
  if (resolution?.source !== 'structured_observation') {
    if (requireTargetCoverage) return false;
    return pathSurfaceCoveredByEvidence(surface, resolution?.text?.toLowerCase());
  }
  if (!pathSurfaceCoveredByEvidence(surface, resolution.surface_text?.toLowerCase())) return false;
  if (!requireTargetCoverage) return true;
  if ((surface.changed_paths ?? []).length === 0) return true;
  return surface.changed_paths.every((changedPath) => (
    resolution.targets.some((target) => verificationTargetCoversChangedPath(target, changedPath))
  ));
}

function verificationTargetCoversChangedPath(target, changedPath) {
  const normalizedTarget = String(target ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  const normalizedChangedPath = String(changedPath ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalizedTarget || normalizedTarget === '.' || !normalizedChangedPath) return false;
  return normalizedChangedPath === normalizedTarget || normalizedChangedPath.startsWith(`${normalizedTarget}/`);
}

function evidenceTextContainsSurfaceTerm(evidenceText, term) {
  const normalizedTerm = String(term ?? '').trim().toLowerCase();
  if (!normalizedTerm) return false;
  const pattern = normalizedTerm.split(/\s+/).map(escapeRegExpLiteral).join('\\s+');
  return new RegExp(`(^|[^a-z0-9])${pattern}(?=$|[^a-z0-9])`, 'i').test(evidenceText);
}

function escapeRegExpLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFlowVerificationSurfaceSearchText(flowVerification) {
  const flowEvidence = resolveWorkflowFlowEvidence({ flowVerification });
  if (!flowEvidence.passed) return '';
  const verification = flowVerification?.verification ?? flowVerification;
  const probes = Array.isArray(verification?.probes)
    ? verification.probes
    : Array.isArray(flowVerification?.probes)
      ? flowVerification.probes
      : [];
  return probes
    .filter((probe) => ['pass', 'passed', 'success', 'ok'].includes(probe?.status))
    .flatMap((probe) => [
      probe.id,
      probe.name,
      probe.title,
      probe.path,
      probe.route,
      probe.url,
      ...(probe.artifacts?.screenshot_paths ?? []),
      ...(probe.artifacts?.trace_paths ?? [])
    ])
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function buildWorkflowHeavyGates({ repoRoot, changeClassification, inferredSpec, flowVerification, e2eCoverage, verificationEvidence }) {
  if (changeClassification?.profile !== 'workflow_heavy') return [];
  const flowEvidence = resolveWorkflowFlowEvidence({ repoRoot, flowVerification, e2eCoverage, verificationEvidence });
  const hasPassingFlowEvidence = flowEvidence.passed;
  const flowEvidenceActions = flowEvidence.required_actions ?? [];
  const clauses = [
    ...(Array.isArray(inferredSpec?.clauses) ? inferredSpec.clauses : []),
    ...(Array.isArray(inferredSpec?.scenario_clauses) ? inferredSpec.scenario_clauses : [])
  ];
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
        : flowEvidence.reason ?? 'workflow_heavy changes require production path matrix evidence via Flow Verification or current E2E evidence with story acceptance coverage',
      required_actions: pathMatrixStatus === 'passed' ? [] : flowEvidenceActions
    },
    {
      id: 'gate:workflow_flow_replay',
      type: 'workflow_heavy_gate',
      label: 'Workflow Flow Replay Gate',
      status: hasPassingFlowEvidence ? 'passed' : 'needs_evidence',
      required: true,
      reason: hasPassingFlowEvidence
        ? flowEvidence.reason
        : flowEvidence.reason ?? 'Run `vibepro verify flow . --base-url <url> --id <story-id>` or record current E2E evidence with story acceptance coverage before release',
      required_actions: hasPassingFlowEvidence ? [] : flowEvidenceActions
    },
    {
      id: 'gate:evidence_coverage',
      type: 'workflow_heavy_gate',
      label: 'Evidence Coverage Gate',
      status: evidenceCoverageStatus,
      required: true,
      reason: evidenceCoverageStatus === 'passed'
        ? 'Workflow clauses and flow replay evidence are both present'
        : 'workflow_heavy release readiness requires scenario clauses plus flow replay evidence',
      required_actions: evidenceCoverageStatus === 'passed' ? [] : flowEvidenceActions
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
        : 'implementation may be consistent, but production workflow confidence is low',
      required_actions: evidenceCoverageStatus === 'passed' ? [] : flowEvidenceActions
    }
  ];
}

function resolveWorkflowFlowEvidence({ repoRoot = '.', flowVerification, e2eCoverage, verificationEvidence }) {
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
        reason: 'Flow Verification pass requires at least one passing runtime probe; configure `.vibepro/config.json` flow_design.runtime_probes[] or record explicit current E2E replay evidence with `verify record --kind e2e --scenario flow_replay:... --scenario scenario_clause_e2e:...`',
        required_actions: buildWorkflowReplayRequiredActions()
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
  if (flowStatus === 'needs_evidence') {
    return {
      passed: false,
      reason: flowVerification?.verification?.reason ?? flowVerification?.reason ?? 'Flow Verification needs configured runtime probes before it can produce workflow replay evidence',
      required_actions: buildWorkflowReplayRequiredActions()
    };
  }

  const e2eEvidence = Array.isArray(verificationEvidence?.commands)
    ? verificationEvidence.commands.find((item) => item.kind === 'e2e' && item.binding?.status === 'current')
    : null;
  if (!['pass', 'passed', 'success', 'ok'].includes(e2eEvidence?.status)) {
    return {
      passed: false,
      reason: 'workflow_heavy changes require current passing Flow Verification or E2E replay evidence',
      required_actions: buildWorkflowReplayRequiredActions()
    };
  }
  if (e2eObservationCoversWorkflowReplay(repoRoot, e2eEvidence)) {
    return {
      passed: true,
      reason: 'Current E2E evidence explicitly records flow_replay and scenario_clause_e2e observations'
    };
  }
  if (requiresStoryE2eCoverage(e2eCoverage) && e2eCoverage.status !== 'passed') {
    return {
      passed: false,
      reason: buildE2eCoverageReason(e2eCoverage),
      required_actions: buildWorkflowReplayRequiredActions()
    };
  }
  if (!e2eEvidenceCoversStoryAcceptance(e2eEvidence, e2eCoverage)) {
    return {
      passed: false,
      reason: 'Current E2E evidence must execute a story acceptance E2E file with executable assertions for workflow-heavy replay, or record explicit flow replay observations on current E2E evidence',
      required_actions: buildWorkflowReplayRequiredActions()
    };
  }
  return {
    passed: true,
    reason: requiresStoryE2eCoverage(e2eCoverage)
      ? 'Current E2E evidence passed with story acceptance coverage'
      : 'Current E2E evidence passed and no story acceptance coverage was required'
  };
}

function buildWorkflowReplayRequiredActions() {
  return [
    'Configure `.vibepro/config.json` with `flow_design.runtime_probes[]`, then run `vibepro verify flow . --base-url <url> --id <story-id>`.',
    'Or record current Playwright/E2E evidence explicitly: `vibepro verify record . --id <story-id> --kind e2e --status pass --command "<playwright command>" --scenario "flow_replay: <flow exercised>" --scenario "scenario_clause_e2e: <scenario clause exercised>" --target "<existing e2e spec file>"`.'
  ];
}

function e2eObservationCoversWorkflowReplay(repoRoot, evidence) {
  if (evidence?.kind !== 'e2e') return false;
  if (!['recorded', 'partial'].includes(evidence?.observation_check?.status)) return false;
  if (!e2eEvidenceHasExistingTarget(repoRoot, evidence)) return false;
  const matches = classifyVerificationEvidenceItem(evidence);
  const kinds = new Set(matches.map((match) => match.kind));
  return kinds.has('flow_replay')
    && hasExplicitObservationMarker(evidence, 'flow_replay')
    && hasExplicitObservationMarker(evidence, 'scenario_clause_e2e');
}

function e2eEvidenceHasExistingTarget(repoRoot, evidence) {
  const targets = evidence?.observation?.targets ?? [];
  return targets.some((target) => {
    const normalized = String(target ?? '').trim();
    if (!normalized || /^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
    if (!isE2eReplayTargetPath(normalized)) return false;
    if (!e2eTargetMatchesCommand(normalized, evidence?.command)) return false;
    const absolute = path.resolve(repoRoot, normalized);
    const relative = path.relative(repoRoot, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
    return existsSync(absolute);
  });
}

function isE2eReplayTargetPath(target) {
  const normalized = String(target ?? '').replaceAll('\\', '/').toLowerCase();
  return /\.(spec|test)\.[jt]sx?$/.test(normalized) && (
    normalized.startsWith('test/e2e/')
    || normalized.startsWith('tests/e2e/')
    || normalized.includes('/e2e/')
  );
}

function e2eTargetMatchesCommand(target, command) {
  const normalizedTarget = String(target ?? '').replaceAll('\\', '/').toLowerCase();
  const normalizedCommand = String(command ?? '').replaceAll('\\', '/').toLowerCase();
  if (!normalizedCommand) return false;
  return normalizedCommand.includes(normalizedTarget);
}

function hasExplicitObservationMarker(evidence, marker) {
  const normalizedMarker = String(marker ?? '').toLowerCase();
  if (!normalizedMarker) return false;
  const observation = evidence?.observation ?? {};
  const values = observation.values && typeof observation.values === 'object'
    ? observation.values
    : {};
  if (Object.keys(values).some((key) => String(key).toLowerCase() === normalizedMarker)) return true;
  return (observation.scenarios ?? []).some((scenario) => {
    const text = String(scenario ?? '').trim().toLowerCase();
    return text === normalizedMarker
      || text.startsWith(`${normalizedMarker}:`)
      || text.startsWith(`${normalizedMarker}=`);
  });
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

function buildDagConnectivityGate(nodes = [], edges = []) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const invalidEdges = edges.filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to));
  const outgoing = new Map();
  const incoming = new Map();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.get(edge.from).push(edge.to);
    incoming.get(edge.to).push(edge.from);
  }
  const fromStory = walkGraph('story', outgoing);
  const toPr = walkGraph('pr', incoming);
  const connectedNodes = nodes.filter((node) => node.id !== 'pr');
  const unreachableNodes = connectedNodes
    .filter((node) => !fromStory.has(node.id))
    .map((node) => node.id);
  const deadEndNodes = connectedNodes
    .filter((node) => !toPr.has(node.id))
    .map((node) => node.id);
  const status = invalidEdges.length === 0 && unreachableNodes.length === 0 && deadEndNodes.length === 0
    ? 'passed'
    : 'needs_review';
  return {
    id: 'gate:dag_connectivity',
    type: 'dag_connectivity_gate',
    label: 'DAG Connectivity Gate',
    status,
    required: true,
    invalid_edges: invalidEdges,
    unreachable_nodes: unreachableNodes,
    dead_end_nodes: deadEndNodes,
    unreachable_required_nodes: unreachableNodes.filter((id) => nodes.find((node) => node.id === id)?.required === true),
    dead_end_required_nodes: deadEndNodes.filter((id) => nodes.find((node) => node.id === id)?.required === true),
    reason: status === 'passed'
      ? 'Every DAG node is reachable from story and can reach the final PR decision'
      : `DAG has ${invalidEdges.length} invalid edge(s), ${unreachableNodes.length} unreachable node(s), and ${deadEndNodes.length} node(s) that cannot reach PR`
  };
}

function walkGraph(start, adjacency) {
  const seen = new Set();
  const queue = [start];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return seen;
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

function buildAgentReviewProcessEdges({ defaultUpstreamNodeId, agentReviewDag, stageUpstreams = {}, fastLaneNodeId = null }) {
  if (!agentReviewDag.nodes.length) {
    // Under fast lane the process dag is empty; keep the fast_lane node reachable
    // by routing the agent-review entry through it: upstream -> fast_lane -> agent_review.
    if (fastLaneNodeId) {
      return [
        { from: defaultUpstreamNodeId, to: fastLaneNodeId },
        { from: fastLaneNodeId, to: 'gate:agent_review' }
      ];
    }
    return [{ from: defaultUpstreamNodeId, to: 'gate:agent_review' }];
  }
  const edges = [];
  const stageOrder = agentReviewDag.stage_order?.length
    ? agentReviewDag.stage_order
    : agentReviewDag.nodes
      .filter((node) => node.type === 'agent_review_prepare_gate')
      .map((node) => node.id.split(':')[2]);
  const firstStage = stageOrder[0];
  if (firstStage) {
    const entryUpstreams = [...new Set([
      defaultUpstreamNodeId,
      ...Object.values(stageUpstreams).filter(Boolean)
    ])];
    for (const upstream of entryUpstreams) {
      edges.push({
        from: upstream,
        to: `review:dispatch_batch:${firstStage}`,
        reason: 'serial Agent Review entry waits for all relevant upstream review surfaces before stage-local parallel dispatch'
      });
    }
  }
  for (const [index, stage] of stageOrder.entries()) {
    const dispatchBatchId = `review:dispatch_batch:${stage}`;
    const prepareId = `review:prepare:${stage}`;
    const joinId = `review:join:${stage}`;
    const previousStage = stageOrder[index - 1] ?? null;
    if (previousStage) {
      edges.push({
        from: `review:join:${previousStage}`,
        to: dispatchBatchId,
        reason: 'next Agent Review stage is blocked until the previous stage join passes'
      });
    }
    const preflightNodes = agentReviewDag.nodes.filter((node) => node.type === 'agent_review_dispatch_preflight_gate' && node.id.startsWith(`review:preflight:${stage}:`));
    if (preflightNodes.length === 0) {
      edges.push({ from: dispatchBatchId, to: prepareId });
    }
    for (const preflightNode of preflightNodes) {
      edges.push({ from: dispatchBatchId, to: preflightNode.id });
      edges.push({ from: preflightNode.id, to: prepareId });
    }
    const roleNodes = agentReviewDag.nodes.filter((node) => node.type === 'agent_review_role_gate' && node.id.startsWith(`review:${stage}:`));
    if (roleNodes.length === 0) {
      edges.push({ from: prepareId, to: joinId });
    }
    for (const roleNode of roleNodes) {
      const role = roleNode.id.slice(`review:${stage}:`.length);
      const recordId = `review:record:${stage}:${role}`;
      edges.push({ from: prepareId, to: roleNode.id });
      edges.push({ from: roleNode.id, to: recordId });
      edges.push({ from: recordId, to: joinId });
    }
  }
  const lastStage = stageOrder[stageOrder.length - 1];
  if (lastStage) {
    edges.push({ from: `review:join:${lastStage}`, to: 'gate:agent_review' });
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

export function buildNetworkContractGate(networkContracts, fileGroups, evidenceContext = {}) {
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
  const inconclusiveScan = networkContracts.status === 'inconclusive' && status === 'passed';
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
            : inconclusiveScan
              ? 'Network contract scan found no candidate files to examine (inconclusive scan); no client calls were present to verify'
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

// Fast lane waives Agent Review only for low-risk changes (docs-only or light
// profile) with no risk surface. It is a typed N/A, never a silent skip: the
// determination is recorded as gate:fast_lane and counted in usage report.
const FAST_LANE_HIGH_RISK_ROUTES = new Set([
  'security_trust', 'release_engineering', 'data_pipeline', 'business_system',
  'api_platform', 'infra_ops', 'agent_workflow'
]);

function buildFastLaneEvaluation({
  prRoute = null,
  changeClassification = null,
  fileGroups = null,
  engineeringJudgment = null,
  safetySecretSurfaceGate = null,
  networkContracts = null
} = {}) {
  const routeType = prRoute?.route_type ?? null;
  const profile = changeClassification?.profile ?? null;
  const riskSurfaces = Array.isArray(changeClassification?.risk_surfaces) ? changeClassification.risk_surfaces : [];
  const sourceCount = fileGroups?.source?.count ?? 0;
  // Source-touching changes keep agent review even when profile is light; fast lane
  // is for docs-only routes and non-source light changes (config/test/docs).
  const lowRisk = routeType === 'docs_only' || (profile === 'light' && sourceCount === 0);
  // Disqualifiers are signals not always reflected in changeClassification.risk_surfaces:
  // a secret/credential surface, an introduced network/API call, a high-risk engineering route.
  const disqualifiers = [];
  if (riskSurfaces.length > 0) disqualifiers.push(`risk_surfaces: ${riskSurfaces.join(', ')}`);
  if (safetySecretSurfaceGate) disqualifiers.push('secret/credential safety surface');
  if ((networkContracts?.introduced_api_client_call_count ?? 0) > 0) disqualifiers.push('introduced network/API call');
  if (FAST_LANE_HIGH_RISK_ROUTES.has(engineeringJudgment?.route_type)) disqualifiers.push(`high-risk route: ${engineeringJudgment.route_type}`);
  const applicable = lowRisk && disqualifiers.length === 0;
  const reason = applicable
    ? `Fast lane engaged: route=${routeType ?? 'n/a'}, profile=${profile ?? 'n/a'}, no risk surfaces detected`
    : disqualifiers.length > 0
      ? `Fast lane declined: ${disqualifiers.join('; ')}`
      : `Fast lane declined: route=${routeType ?? 'n/a'} / profile=${profile ?? 'n/a'} is not low-risk`;
  return {
    applicable,
    route_type: routeType,
    profile,
    risk_surfaces: riskSurfaces,
    disqualifiers,
    source_file_count: fileGroups?.source?.count ?? 0,
    reason
  };
}

function buildFastLaneGate(fastLane) {
  return {
    id: 'gate:fast_lane',
    type: 'fast_lane_gate',
    label: 'Risk-Tiered Fast Lane',
    status: 'passed',
    required: false,
    waives: 'gate:agent_review',
    evaluation: fastLane,
    reason: fastLane.reason
  };
}

function buildAgentReviewGate(agentReviews, fileGroups, fastLane = null) {
  if (fastLane?.applicable) {
    return {
      id: 'gate:agent_review',
      type: 'agent_review_gate',
      label: 'Agent Review Gate',
      status: 'not_applicable',
      required: false,
      distinct_from: 'waiver',
      fast_lane: true,
      na_reason: fastLane.reason,
      reason: `Typed N/A via fast lane — ${fastLane.reason}. Low-risk change does not require staged agent review; human-review.json remains for final human judgment.`
    };
  }
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
  const checkpointUnmet = agentReviews.unmet_checkpoint_reviews ?? [];
  const requiredActions = buildAgentReviewRequiredActions(agentReviews, status, unmet);
  const minimalRecoveryPlan = buildAgentReviewMinimalRecoveryPlan(agentReviews, status, unmet);
  const reviewerIndependence = buildAgentReviewerIndependence(agentReviews);
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
        : `${unmet.length} PR-final and ${checkpointUnmet.length} checkpoint agent review role(s) are missing, stale, or blocking; run the listed checkpoint/review commands and record their provenance.`,
    reviewer_independence: reviewerIndependence,
    ...(reviewerIndependence.same_session_review_count > 0 ? {
      warnings: [
        `${reviewerIndependence.same_session_review_count} recorded review(s) declare reviewer_identity=same_session (${reviewerIndependence.same_session_reviews.join(', ')}); reviewer independence is not established. This is a warning only and does not change the gate status.`
      ]
    } : {}),
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
    minimal_recovery_plan: minimalRecoveryPlan,
    required_actions: requiredActions,
    unmet_required_reviews: unmet.slice(0, 20),
    unmet_checkpoint_reviews: checkpointUnmet.slice(0, 20)
  };
}

function buildAgentReviewerIndependence(agentReviews) {
  const sameSessionReviews = [];
  let unknownIdentityCount = 0;
  let recordedCount = 0;
  for (const stage of agentReviews?.stages ?? []) {
    for (const role of stage?.roles ?? []) {
      const provenance = role?.agent_provenance;
      if (!provenance) continue;
      recordedCount += 1;
      const relation = provenance.reviewer_identity?.relation ?? 'unknown';
      if (relation === 'same_session') {
        sameSessionReviews.push(`${stage.stage}:${role.role}`);
      } else if (relation === 'unknown') {
        unknownIdentityCount += 1;
      }
    }
  }
  return {
    schema_version: '0.1.0',
    enforcement: 'warning_only',
    recorded_review_count: recordedCount,
    same_session_review_count: sameSessionReviews.length,
    same_session_reviews: sameSessionReviews,
    unknown_identity_review_count: unknownIdentityCount
  };
}

function buildAgentReviewMinimalRecoveryPlan(agentReviews, status, unmet) {
  if (status === 'passed' || status === 'not_required') return null;
  const storyId = agentReviews.story_id ?? '<story-id>';
  const requiredStages = agentReviews.parallel_dispatch?.required_stages ?? [];
  const checkpointUnmet = agentReviews.unmet_checkpoint_reviews ?? [];
  const allUnmet = [
    ...unmet,
    ...checkpointUnmet
  ];
  const currentStage = requiredStages.find((stage) => stage.dispatch_state === 'current')
    ?? requiredStages.find((stage) => stage.status !== 'pass' || stage.prepared !== true)
    ?? null;
  const blockedLaterStages = requiredStages
    .filter((stage) => stage.dispatch_state === 'blocked_by_previous_stage')
    .map((stage) => ({
      stage: stage.stage,
      serial_index: stage.serial_index ?? null,
      roles: stage.roles ?? [],
      reason: 'blocked_by_serial_barrier'
    }));
  const roleLookup = buildAgentReviewRoleLookup(agentReviews);
  const deduped = dedupeAgentReviewRecoveryItems(allUnmet, roleLookup, storyId);
  const currentStageItems = currentStage
    ? deduped.filter((item) => item.stage === currentStage.stage)
    : deduped;
  const firstCommand = currentStageItems.find((item) => item.next_commands.length > 0)?.next_commands[0]
    ?? currentStage?.prepare_command
    ?? `vibepro review status . --id ${storyId}`;
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    status,
    source_blocker_count: allUnmet.length,
    deduped_blocker_count: deduped.length,
    first_command: firstCommand,
    current_stage: currentStage ? {
      stage: currentStage.stage,
      serial_index: currentStage.serial_index ?? null,
      status: currentStage.status ?? null,
      prepared: currentStage.prepared === true,
      roles: currentStage.roles ?? [],
      prepare_command: currentStage.prepare_command ?? null,
      dispatch_artifact: currentStage.dispatch_artifact ?? null
    } : null,
    current_stage_work: currentStageItems,
    later_stages_blocked: blockedLaterStages,
    rerun_command: `vibepro pr prepare . --story-id ${shellQuote(storyId)} --base ${shellQuote('<base-ref>')}`
  };
}

function buildAgentReviewRoleLookup(agentReviews) {
  const lookup = new Map();
  for (const stage of agentReviews.stages ?? []) {
    for (const role of stage.roles ?? []) {
      lookup.set(`${stage.stage}:${role.role}`, {
        ...role,
        stage: stage.stage
      });
    }
  }
  return lookup;
}

function dedupeAgentReviewRecoveryItems(items, roleLookup, storyId) {
  const byRole = new Map();
  for (const item of items) {
    if (!item?.stage || !item?.role) continue;
    const key = `${item.stage}:${item.role}`;
    const role = roleLookup.get(key) ?? {};
    const existing = byRole.get(key);
    const candidate = buildAgentReviewRecoveryItem(item, role, storyId);
    if (!existing || recoveryPriority(candidate.recovery_kind) > recoveryPriority(existing.recovery_kind)) {
      byRole.set(key, existing ? mergeAgentReviewRecoveryDetails(candidate, existing) : candidate);
    } else {
      byRole.set(key, {
        ...existing,
        details: [...new Set([...existing.details, ...candidate.details].filter(Boolean))]
      });
    }
  }
  return [...byRole.values()];
}

function mergeAgentReviewRecoveryDetails(primary, secondary) {
  return {
    ...primary,
    details: [...new Set([...(primary.details ?? []), ...(secondary.details ?? [])].filter(Boolean))]
  };
}

function buildAgentReviewRecoveryItem(item, role, storyId) {
  const lifecycle = role?.lifecycle ?? null;
  const lifecycleStatus = lifecycle?.latest?.close_reason === 'manual_shutdown'
    ? 'manual_shutdown'
    : lifecycle?.effective_status ?? lifecycle?.latest?.effective_status ?? null;
  const recoveryKind = classifyAgentReviewRecoveryKind(item, role, lifecycleStatus);
  const lifecycleRecovery = buildAgentReviewLifecycleRecovery({
    storyId,
    stage: item.stage,
    role: item.role,
    lifecycle,
    recoveryKind
  });
  return {
    stage: item.stage,
    role: item.role,
    status: item.status ?? role?.effective_status ?? 'missing',
    recovery_kind: recoveryKind,
    details: [item.detail, role?.stale_reason, role?.provenance_reason, role?.summary].filter(Boolean),
    artifact: role?.artifact ?? null,
    lifecycle: lifecycleRecovery,
    next_commands: buildAgentReviewRecoveryCommands({
      storyId,
      stage: item.stage,
      role: item.role,
      recoveryKind,
      lifecycleRecovery,
      contentBinding: role?.content_binding ?? null
    })
  };
}

function classifyAgentReviewRecoveryKind(item, role, lifecycleStatus) {
  if (lifecycleStatus === 'timed_out' || item.status === 'timed_out') return 'timed_out';
  if (lifecycleStatus === 'manual_shutdown' || item.status === 'manual_shutdown') return 'manual_shutdown';
  if (lifecycleStatus === 'running' || item.status === 'running') return 'running';
  if (role?.stale || item.status === 'stale' || role?.effective_status === 'stale') return 'stale';
  if (item.status === 'unverified_agent' || role?.effective_status === 'unverified_agent') return 'unverified_agent';
  if (item.status === 'missing' || role?.effective_status === 'missing') return 'missing';
  return item.status ?? role?.effective_status ?? 'needs_review';
}

function recoveryPriority(kind) {
  return {
    timed_out: 60,
    manual_shutdown: 55,
    running: 50,
    stale: 40,
    unverified_agent: 30,
    missing: 20
  }[kind] ?? 10;
}

function buildAgentReviewLifecycleRecovery({ storyId, stage, role, lifecycle, recoveryKind }) {
  const latest = lifecycle?.latest ?? null;
  if (!latest && !['timed_out', 'manual_shutdown', 'running'].includes(recoveryKind)) return null;
  const agentId = latest?.agent_id ?? null;
  const lifecycleId = latest?.lifecycle_id ?? null;
  const selector = agentId
    ? `--agent-id ${shellQuote(agentId)}`
    : `--lifecycle-id ${shellQuote(lifecycleId ?? '<lifecycle-id>')}`;
  const closeReason = recoveryKind === 'timed_out'
    ? 'timeout'
    : recoveryKind === 'manual_shutdown'
      ? 'manual_shutdown'
      : 'completed';
  const closeCommand = ['timed_out', 'manual_shutdown', 'running'].includes(recoveryKind)
    ? `vibepro review close . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(role)} ${selector} --close-reason ${shellQuote(closeReason)} --close-evidence ${shellQuote('<close-evidence>')}`
    : null;
  const replacementCommand = ['timed_out', 'manual_shutdown'].includes(recoveryKind)
    ? `vibepro review start . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(role)} --agent-system ${shellQuote(latest?.agent_system ?? '<codex|claude_code>')} --agent-id ${shellQuote('<replacement-agent-id>')} --agent-thread-id ${shellQuote('<replacement-agent-thread-id>')} --agent-session-id ${shellQuote('<replacement-agent-session-id>')} --timeout-ms 600000 --replacement-for ${shellQuote(lifecycleId ?? '<previous-lifecycle-id>')}`
    : null;
  return {
    status: lifecycle?.effective_status ?? latest?.effective_status ?? null,
    agent_id: agentId,
    lifecycle_id: lifecycleId,
    close_command: closeCommand,
    replacement_command: replacementCommand
  };
}

function buildAgentReviewRecoveryCommands({ storyId, stage, role, recoveryKind, lifecycleRecovery, contentBinding = null }) {
  const prepareCommand = `vibepro review prepare . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(role)}`;
  const startCommand = lifecycleRecovery?.replacement_command
    ?? `vibepro review start . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(role)} --agent-system ${shellQuote('<codex|claude_code>')} --agent-id ${shellQuote('<replacement-agent-id>')} --agent-thread-id ${shellQuote('<replacement-agent-thread-id>')} --agent-session-id ${shellQuote('<replacement-agent-session-id>')} --timeout-ms 600000`;
  const closeNewCommand = `vibepro review close . --id ${shellQuote(storyId)} --stage ${shellQuote(stage)} --role ${shellQuote(role)} --agent-id ${shellQuote('<replacement-agent-id>')} --close-reason completed --close-evidence ${shellQuote('<replacement-agent-close-evidence>')}`;
  const recordCommand = buildReviewRecordCommandTemplate(storyId, stage, role, { contentBinding, identity: 'replacement-agent' });
  if (['timed_out', 'manual_shutdown'].includes(recoveryKind)) {
    return [
      lifecycleRecovery?.close_command,
      prepareCommand,
      startCommand,
      closeNewCommand,
      recordCommand
    ].filter(Boolean);
  }
  if (recoveryKind === 'running') {
    return [
      lifecycleRecovery?.close_command,
      recordCommand
    ].filter(Boolean);
  }
  return [
    prepareCommand,
    startCommand,
    closeNewCommand,
    recordCommand
  ];
}

function buildAgentReviewRequiredActions(agentReviews, status, unmet) {
  if (status === 'passed' || status === 'not_required') return [];
  const requiredStages = agentReviews.parallel_dispatch?.required_stages ?? [];
  const checkpointUnmet = agentReviews.unmet_checkpoint_reviews ?? [];
  const allUnmet = [
    ...unmet,
    ...checkpointUnmet
  ];
  const actions = [];
  const currentStage = requiredStages.find((stage) => stage.dispatch_state === 'current')
    ?? requiredStages.find((stage) => stage.status !== 'pass' || stage.prepared !== true);
  if (currentStage) {
    actions.push(`Current Agent Review stage ${currentStage.serial_index ?? '?'}: run \`${currentStage.prepare_command}\` and use ${currentStage.dispatch_artifact}; dispatch only the listed ${currentStage.stage} role subagents in parallel, close/shutdown each returned subagent, then record every result with parallel_subagent provenance and --agent-closed. Do not dispatch later Agent Review stages in the same batch.`);
  }
  const currentStageUnmet = currentStage
    ? allUnmet.filter((item) => item.stage === currentStage.stage)
    : allUnmet;
  if (currentStageUnmet.length > 0) {
    const roleList = currentStageUnmet.slice(0, 12)
      .map((item) => `${item.stage}:${item.role}(${item.status}${item.detail ? `: ${item.detail}` : ''})`)
      .join(', ');
    actions.push(`Complete and record current-stage review results for: ${roleList}.`);
  }
  const blockedStages = requiredStages.filter((stage) => stage.dispatch_state === 'blocked_by_previous_stage');
  if (blockedStages.length > 0) {
    actions.push(`Later Agent Review stages are serial-barriered and must wait: ${blockedStages.map((stage) => `${stage.serial_index ?? '?'}:${stage.stage}`).join(', ')}. Rerun \`vibepro pr prepare\` after the current stage is closed and recorded to reveal the next dispatch stage.`);
  }
  actions.push('After closing review subagents and recording the current stage with parallel_subagent provenance and closed subagent lifecycle, run `vibepro review status . --id <story-id>` and `vibepro pr prepare . --story-id <story-id> --base <base-ref>` again.');
  return actions;
}

function buildReviewInspectionRequiredGate({ agentReviews = null, changeClassification = null, engineeringJudgment = null } = {}) {
  const highRisk = changeClassification?.profile === 'workflow_heavy'
    || ['security_trust', 'release_engineering', 'data_pipeline', 'business_system', 'api_platform', 'infra_ops'].includes(engineeringJudgment?.route_type)
    || ['api_contract', 'auth', 'security', 'database', 'persistence', 'runtime_behavior', 'deploy'].some((surface) => (changeClassification?.risk_surfaces ?? []).includes(surface));
  const recordedRoles = (agentReviews?.stages ?? [])
    .flatMap((stage) => (stage.roles ?? []).map((role) => ({ stage: stage.stage, ...role })))
    .filter((role) => role.artifact);
  const inspectedRoles = recordedRoles.map((role) => {
    const summary = role.inspection?.summary ?? null;
    const evidence = role.inspection?.evidence ?? null;
    const missing = [];
    if (highRisk && !summary) missing.push('inspection_summary');
    if (highRisk && !evidence) missing.push('inspection_evidence');
    return {
      stage: role.stage,
      role: role.role,
      status: role.effective_status ?? role.status ?? null,
      artifact: role.artifact,
      inspection_summary_present: Boolean(summary),
      inspection_evidence_present: Boolean(evidence),
      missing
    };
  });
  const missing = inspectedRoles.filter((role) => role.missing.length > 0);
  const status = missing.length === 0 ? 'passed' : 'needs_inspection';
  const storyId = agentReviews?.story_id ?? '<story-id>';
  return {
    id: 'gate:review_inspection_required',
    type: 'review_inspection_required_gate',
    label: 'Review Inspection Required Gate',
    status,
    required: true,
    high_risk: highRisk,
    recorded_review_count: inspectedRoles.length,
    missing_inspection_count: missing.length,
    inspected_roles: inspectedRoles,
    missing_inspections: missing,
    required_actions: missing.length === 0 ? [] : [
      `Record inspection summary and evidence for high-risk review role(s): ${missing.map((role) => `${role.stage}:${role.role}`).join(', ')}`,
      ...missing.map((role) => buildReviewRecordCommandTemplate(storyId, role.stage, role.role)),
      'Rerun `vibepro pr prepare` after current-bound inspection evidence is recorded'
    ],
    reason: status === 'passed'
      ? highRisk
        ? `${inspectedRoles.length} recorded high-risk review role(s) include required inspection fields, or no recorded high-risk review is present yet`
        : 'Review inspection evidence is not critical for this route profile'
      : `${missing.length} high-risk review role(s) are missing inspection summary or evidence`
  };
}

function buildDefinitionOfDoneGate({ fileGroups = {}, verificationEvidence = null, flowVerification = null, agentReviewGate = null } = {}) {
  const sourceCount = fileGroups?.source?.count ?? 0;
  const testCount = fileGroups?.tests?.count ?? 0;
  const required = sourceCount + testCount > 0;
  const currentPassingCommands = collectCurrentPassingVerificationEvidence(verificationEvidence);
  const passingFlow = getCurrentPassingFlowEvidence(flowVerification);
  const hasCurrentVerification = currentPassingCommands.length > 0 || Boolean(passingFlow);
  const agentReviewRequired = agentReviewGate?.required === true;
  const agentReviewUnresolved = agentReviewRequired && isUnresolvedGateStatus(agentReviewGate?.status);
  const definitionItems = [
    {
      id: 'current_head_verification',
      label: 'Current-head verification evidence',
      status: !required ? 'not_required' : hasCurrentVerification ? 'passed' : 'missing',
      evidence: [
        ...currentPassingCommands.map((command) => ({
          type: 'verification_command',
          kind: command.kind ?? null,
          command: command.command ?? null,
          summary: command.summary ?? null,
          artifact: command.artifact ?? verificationEvidence?.artifact ?? null
        })),
        ...(passingFlow ? [{
          type: 'flow_verification',
          status: passingFlow.status,
          artifact: passingFlow.artifact,
          run_id: passingFlow.run_id
        }] : [])
      ]
    },
    {
      id: 'agent_review_closure',
      label: 'Required Agent Review closed or not required',
      status: !required || !agentReviewRequired ? 'not_required' : agentReviewUnresolved ? 'missing' : 'passed',
      gate_status: agentReviewGate?.status ?? null
    }
  ];
  const missingItems = definitionItems.filter((item) => item.status === 'missing');
  const status = !required
    ? 'not_required'
    : missingItems.length === 0
      ? 'passed'
      : 'needs_evidence';
  return {
    id: 'gate:definition_of_done',
    type: 'definition_of_done_gate',
    label: 'Definition of Done Gate',
    status,
    required,
    source_file_count: sourceCount,
    test_file_count: testCount,
    definition_items: definitionItems,
    current_passing_verification_count: currentPassingCommands.length + (passingFlow ? 1 : 0),
    common_rationalizations_rejected: [
      'tests_pass_so_review_done',
      'small_change_no_spec_or_evidence',
      'manual_review_replaces_required_subagent',
      'server_logs_prove_user_perceived_behavior',
      'missing_path_probably_unaffected'
    ],
    red_flags: missingItems.map((item) => ({
      item: item.id,
      reason: item.id === 'current_head_verification'
        ? 'No current-head passing verification command or flow verification evidence was recorded'
        : 'Required Agent Review is still unresolved'
    })),
    required_actions: status === 'passed' || status === 'not_required' ? [] : [
      ...(!hasCurrentVerification ? ['Record at least one current-head passing verification evidence item with `vibepro verify record --status pass`, or a current passing `vibepro verify flow` artifact.'] : []),
      ...(agentReviewUnresolved ? ['Complete required Agent Review with parallel_subagent provenance and closed lifecycle evidence, then rerun `vibepro pr prepare`.'] : []),
      'Rerun `vibepro pr prepare` so Definition of Done is evaluated against the current git state.'
    ],
    reason: status === 'not_required'
      ? 'Docs-only or non-source change; Definition of Done source/test closure is not required'
      : status === 'passed'
        ? 'Current-head verification evidence exists and required Agent Review is closed or not required'
        : `Definition of Done is incomplete: ${missingItems.map((item) => item.label).join(', ')}`
  };
}

function collectCurrentPassingVerificationEvidence(verificationEvidence = null) {
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  return commands.filter((command) => (
    command.binding?.status === 'current'
    && isPassingVerificationStatus(command.status)
  ));
}

function getCurrentPassingFlowEvidence(flowVerification = null) {
  const status = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  const binding = flowVerification?.verification?.binding ?? flowVerification?.binding ?? null;
  const artifact = flowVerification?.artifact ?? flowVerification?.artifacts?.flow_verification_json ?? null;
  if (status !== 'pass' || binding?.status !== 'current') return null;
  if (!artifact || flowVerification?.missing_artifact === true) return null;
  if (!hasPassingRuntimeProbeEvidence(flowVerification)) return null;
  return {
    status,
    artifact,
    run_id: flowVerification?.verification?.run_id ?? flowVerification?.run_id ?? null
  };
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

function buildVerificationGates({ fileGroups, verificationCommands, e2eCommand, flowVerification, e2eCoverage, visualQaEvidence, verificationEvidence, bugPhysicsTriage = null, changeClassification = null }) {
  const unitCommand = verificationCommands.find((item) => item.kind === 'unit' || item.command.startsWith('npm test')) ?? null;
  const typecheckCommand = verificationCommands.find((item) => item.kind === 'typecheck' || /\b(type-?check|tsc)\b/.test(item.command)) ?? null;
  const gateOverride = buildBugPhysicsVerificationGateOverride(bugPhysicsTriage);
  const e2eRequired = gateOverride.e2e
    ? false
    : shouldRequireE2eGate({ fileGroups, e2eCommand, flowVerification, visualQaEvidence, changeClassification });
  const gateE2eCoverage = e2eRequired ? e2eCoverage : markE2eCoverageNotApplicable(e2eCoverage);
  const e2eGateStatus = e2eRequired ? resolveE2eGateStatus(e2eCommand, flowVerification, e2eCoverage) : 'not_required';
  const e2eReason = e2eRequired
    ? buildE2eGateReason(e2eCommand, flowVerification, e2eCoverage)
    : gateOverride.e2e?.reason ?? 'UI/E2E対象の差分ではないため、Unit / Integration証跡で完了判定する';
  return [
    gateOverride.unit ? buildTypedNaVerificationGate('gate:unit', 'Unit Gate', gateOverride.unit.reason) : {
      id: 'gate:unit',
      type: 'verification_gate',
      label: 'Unit Gate',
      status: unitCommand ? 'candidate' : 'missing',
      required: fileGroups.source.count > 0 || fileGroups.tests.count > 0,
      command: unitCommand?.command ?? 'npm test',
      reason: unitCommand?.reason ?? '受け入れ基準に対応するUnitテストを追加・実行する'
    },
    gateOverride.integration ? buildTypedNaVerificationGate('gate:integration', 'Integration Gate', gateOverride.integration.reason) : {
      id: 'gate:integration',
      type: 'verification_gate',
      label: 'Integration Gate',
      status: typecheckCommand || fileGroups.tests.count > 0 ? 'needs_evidence' : 'missing',
      required: fileGroups.source.count > 0,
      command: typecheckCommand?.command ?? 'npm test',
      reason: '最終出力経路や型境界を含む統合確認を実行する'
    },
    gateOverride.e2e ? buildTypedNaVerificationGate('gate:e2e', 'E2E Gate', e2eReason, {
      flow_verification: null,
      acceptance_e2e_coverage: gateE2eCoverage,
      artifact_expectation: null
    }) : {
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
  ].map((gate) => applyVerificationEvidence(gate, verificationEvidence, { changeClassification }));
}

function buildBugPhysicsVerificationGateOverride(triage) {
  const classes = new Set(triage?.classes ?? []);
  const override = {};
  if (classes.has('deployment')) {
    const reason = 'Typed N/A: deployment bug physics requires version-stamp propagation evidence; code correctness gates are not proof that the running session uses the expected artifact';
    override.unit = { reason };
    override.integration = { reason };
    override.e2e = { reason };
  } else if (classes.has('observability')) {
    override.e2e = {
      reason: 'Typed N/A: observability bug physics requires an authoritative signal source; single E2E proof exits the code-gate lane'
    };
  } else if (classes.has('timing')) {
    override.e2e = {
      reason: 'Typed N/A: timing bug physics requires violation-rate/SLO evidence; single-shot E2E green is not proof'
    };
  }
  return override;
}

function buildTypedNaVerificationGate(id, label, reason, extra = {}) {
  return {
    id,
    type: 'verification_gate',
    label,
    status: 'not_applicable',
    required: false,
    command: null,
    reason,
    distinct_from: 'waiver',
    na_reason: reason,
    selected_by: 'gate:bug_physics_triage',
    skip_evidence_binding: true,
    ...extra
  };
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

function shouldRequireE2eGate({ fileGroups, e2eCommand, flowVerification, visualQaEvidence = null, changeClassification = null }) {
  if (hasUiExperienceSourceChange(fileGroups)) return true;
  if (hasRuntimeE2eTestChange(fileGroups)) return true;
  if (fileGroups.repo_control.files.some(isE2eInfraPath)) return true;
  if (flowVerification) return true;
  if (visualQaEvidence && hasUiExperienceSourceChange(fileGroups)) return true;
  if (e2eCommand?.detected && changeClassificationRequiresRuntimeE2e(changeClassification)) return true;
  return false;
}

function hasRuntimeE2eTestChange(fileGroups) {
  const testItems = Array.isArray(fileGroups.tests.items)
    ? fileGroups.tests.items
    : fileGroups.tests.files.map((filePath) => ({ path: filePath, status: 'M' }));
  return testItems.some((item) => isE2eTestPath(item.path) && !isDeleteOnlyStatus(item.status));
}

function isDeleteOnlyStatus(status) {
  return String(status ?? '').startsWith('D');
}

function isE2eTestPath(filePath) {
  return filePath.startsWith('tests/e2e/')
    || filePath.startsWith('test/e2e/')
    || filePath.startsWith('e2e/');
}

function isE2eInfraPath(filePath) {
  return filePath.startsWith('e2e/')
    || /^playwright\.config\.[cm]?[jt]s$/.test(filePath);
}

function changeClassificationRequiresRuntimeE2e(changeClassification) {
  const profile = changeClassification?.profile ?? 'light';
  if (profile === 'ui_interaction' || profile === 'workflow_heavy') return true;
  const surfaces = new Set(changeClassification?.risk_surfaces ?? []);
  return [
    'frontend_interaction',
    'core_workflow_state',
    'service_orchestration',
    'queue_worker',
    'polling_retry'
  ].some((surface) => surfaces.has(surface));
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
    return /\.(css|scss|sass|less|html|vue|svelte|jsx|tsx)$/.test(file);
  });
}

function applyVerificationEvidence(gate, verificationEvidence, options = {}) {
  if (gate.skip_evidence_binding) return gate;
  const evidence = findVerificationEvidenceForGate(gate, verificationEvidence, options);
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

function findVerificationEvidenceForGate(gate, verificationEvidence, options = {}) {
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
  const reusableDecision = matches
    .map((item) => ({
      item,
      decision: buildEvidenceReuseDecision({ item, gate, changeClassification: options.changeClassification })
    }))
    .find(({ decision }) => decision.status === 'reusable');
  if (reusableDecision) {
    const { item, decision } = reusableDecision;
    return {
      ...item,
      binding: {
        ...item.binding,
        status: 'reused_low_risk',
        reason: decision.reason,
        scoped_reuse_decision: decision
      }
    };
  }
  const stale = matches[0];
  const decision = buildEvidenceReuseDecision({ item: stale, gate, changeClassification: options.changeClassification });
  return {
    kind: stale.kind,
    status: 'needs_evidence',
    command: stale.command,
    summary: decision.reason ?? stale.binding?.reason ?? 'verification evidence is not bound to the current git state',
    artifact: stale.artifact,
    executed_at: stale.executed_at,
    binding: {
      ...(stale.binding ?? {
        status: 'legacy',
        reason: 'legacy verification evidence is not bound to a git head'
      }),
      scoped_reuse_decision: decision
    }
  };
}

function canReuseLowRiskEvidence(item, changeClassification = null, options = {}) {
  return buildEvidenceReuseDecision({
    item,
    gate: options.gate ?? null,
    changeClassification
  }).status === 'reusable';
}

function canReuseLowRiskArtifactBinding(item, changeClassification = null, options = {}) {
  return canReuseLowRiskEvidence(item, changeClassification, options);
}

function gateForVerificationKind(kind) {
  if (['unit', 'test'].includes(kind)) return { id: 'gate:unit' };
  if (['integration', 'typecheck', 'build'].includes(kind)) return { id: 'gate:integration' };
  if (['e2e', 'flow'].includes(kind)) return { id: 'gate:e2e' };
  return null;
}

function buildEvidenceReuseDecision({ item, gate = null, changeClassification = null } = {}) {
  const policy = changeClassification?.evidence_reuse_policy ?? null;
  const changedSurfaceFiles = changeClassification?.changed_surface_files
    ?? policy?.scoped_invalidation?.changed_surface_files
    ?? {};
  const changedSurfaces = changeClassification?.changed_surfaces
    ?? policy?.scoped_invalidation?.changed_surfaces
    ?? [];
  const changedFiles = [...new Set(Object.values(changedSurfaceFiles).flat())];
  const base = {
    model: 'vibepro-scoped-evidence-invalidation-v1',
    gate_id: gate?.id ?? null,
    evidence_kind: item?.kind ?? null,
    changed_surfaces: changedSurfaces,
    changed_files: changedFiles,
    status: 'blocked',
    action: 'strict_current',
    reason: 'verification evidence must be current-bound'
  };
  if (changeClassification?.change_type !== 'low_risk_evidence_change' || policy?.allowed !== true) {
    return {
      ...base,
      reason: 'change is not eligible for scoped stale evidence reuse'
    };
  }
  if (!['pass', 'passed', 'success', 'ok'].includes(item?.status)) {
    return {
      ...base,
      reason: 'only passing verification evidence can be reused'
    };
  }
  if (item?.binding?.status !== 'stale') {
    return {
      ...base,
      reason: 'scoped reuse only applies to stale evidence after current evidence has been considered'
    };
  }
  const staleReason = item.binding?.reason ?? '';
  const staleBindingSupported = /dirty worktree fingerprint|recorded for|worktree status|working tree status|status fingerprint/i.test(staleReason);
  if (!staleBindingSupported) {
    return {
      ...base,
      reason: `stale binding reason is not supported for scoped reuse: ${staleReason || 'unknown'}`
    };
  }
  const testFiles = changedSurfaceFiles.tests ?? [];
  if (testFiles.length > 0) {
    return {
      ...base,
      status: 'blocked',
      action: 'full_rerun',
      affected_by: ['tests'],
      changed_files: testFiles,
      reason: `test files changed for ${gate?.id ?? item?.kind ?? 'verification'} evidence; rerun required: ${testFiles.join(', ')}`
    };
  }
  const conservativeSurfaces = [
    ...(policy.mode === 'small_source_low_risk_reuse' ? [] : ['runtime_source']),
    'repo_control',
    'other'
  ]
    .filter((surface) => (changedSurfaceFiles[surface] ?? []).length > 0);
  if (conservativeSurfaces.length > 0) {
    return {
      ...base,
      status: 'blocked',
      action: 'strict_current',
      affected_by: conservativeSurfaces,
      reason: `changed surfaces require current-bound evidence: ${conservativeSurfaces.join(', ')}`
    };
  }
  if (policy.mode === 'small_source_low_risk_reuse' && /recorded for/i.test(staleReason)) {
    return {
      ...base,
      status: 'blocked',
      action: 'strict_current',
      affected_by: ['runtime_source'],
      reason: 'small source reuse does not cross HEAD changes; record fresh evidence on the current head'
    };
  }
  const reusableSurfaces = changedSurfaces.length > 0 ? changedSurfaces : ['dirty_fingerprint'];
  return {
    ...base,
    status: 'reusable',
    action: 'reuse',
    affected_by: reusableSurfaces,
    reason: `scoped evidence reuse accepted for ${gate?.id ?? item?.kind ?? 'verification'} because changed surfaces do not affect runtime source or test set: ${reusableSurfaces.join(', ')}`
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
    const scenarioSuffix = (e2eCoverage.scenario_clause_count ?? 0) > 0
      ? `; scenario clauses covered: ${e2eCoverage.covered_scenario_clause_count}/${e2eCoverage.scenario_clause_count}`
      : '';
    return `Story E2E coverage passed: ${e2eCoverage.matched_files.join(', ')}${scenarioSuffix}`;
  }
  if ((e2eCoverage.matched_files?.length ?? 0) > 0 && (e2eCoverage.executable_matched_files?.length ?? 0) === 0) {
    return `Story E2E coverage needs evidence: matched files contain no executable assertions (${e2eCoverage.matched_files.join(', ')})`;
  }
  const missing = e2eCoverage.missing_acceptance_criteria ?? [];
  const missingScenarios = e2eCoverage.missing_scenario_clauses ?? [];
  const missingLabels = [
    ...missing.map((item) => item.id),
    ...missingScenarios.map((item) => item.id)
  ];
  const missingLabel = missingLabels.join(', ') || 'acceptance criteria or scenario clauses';
  const diagnosticSuffix = (e2eCoverage.coverage_diagnostics?.missing_acceptance_criteria?.length ?? 0) > 0
    ? '; coverage_diagnostics lists inspected files, candidate test blocks, and miss reasons; use an explicit executable coverage marker if inference is unsafe'
    : '';
  if ((e2eCoverage.matched_files?.length ?? 0) > 0) {
    return `Story E2E coverage needs evidence: ${missingLabel} must be covered by executable assertions in ${e2eCoverage.expected_file_patterns.join(' or ')}${diagnosticSuffix}`;
  }
  return `Story E2E coverage needs evidence: ${missingLabel} must be covered by ${e2eCoverage.expected_file_patterns.join(' or ')}${diagnosticSuffix}`;
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
  const structuredCount = requirement.summary?.structured_inherited_behavior_declaration_count ?? 0;
  const legacyCount = requirement.summary?.legacy_keyword_resolution_count ?? 0;
  const migrationSuffix = [
    structuredCount > 0 ? `${structuredCount}件の構造化inherited_behavior宣言` : null,
    legacyCount > 0 ? `${legacyCount}件の旧キーワード互換解決(deprecated)` : null
  ].filter(Boolean).join(' / ');
  const suffix = migrationSuffix ? ` (${migrationSuffix})` : '';
  if (requirement.status === 'contradicted') {
    return `${requirement.summary?.contradiction_count ?? 0}件の要件矛盾候補がある${suffix}`;
  }
  if (requirement.status === 'needs_review') {
    return `${requirement.summary?.scenario_gap_count ?? 0}件のStory未明示シナリオがある${suffix}`;
  }
  if (requirement.status === 'pass') {
    return `Story不変条件と変更コードの既知分岐に明確な矛盾は検出されていない${suffix}`;
  }
  return 'Story不変条件を抽出できなかったため適用外';
}

function buildRequirementStructuredEvidenceGuidance(requirement) {
  const firstGap = requirement?.scenario_gaps?.[0];
  const condition = firstGap?.evidence?.condition ?? '<branch condition>';
  const file = firstGap?.file ?? '<changed source path>';
  return {
    accepted_fields: [
      'inferred spec clause inherited_behavior.condition',
      'inferred spec clause inherited_behavior.classification',
      'inferred spec clause inherited_behavior.files'
    ],
    declaration_shape: {
      inherited_behavior: {
        condition,
        classification: 'existing|unchanged|inherited',
        files: [file]
      }
    },
    replacement_for_legacy_keywords: 'Do not rely on free-text inherited/existing/unchanged tokens; attach inherited_behavior to the inferred/spec clause that owns the scenario.'
  };
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
    risks.push(`Agent Review Gateが ${agentReviewGate.status}: required review roleが未解決`);
  }
  return risks;
}

function summarizePrGateReason(reason) {
  if (!reason) return null;
  return String(reason)
    .replace(/;\s*run the listed checkpoint\/review commands and record their provenance\.?/gi, '')
    .replace(/\brun the listed checkpoint\/review commands and record their provenance\.?/gi, 'review provenance is incomplete')
    .replace(/`[^`]*vibepro[^`]*`/gi, 'VibePro artifact workflow')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderPrGateSummary(gateDag) {
  const gates = gateDag.nodes.filter((node) => node.type === 'verification_gate');
  const storyGate = gateDag.nodes.find((node) => node.id === 'story');
  const architectureGate = gateDag.nodes.find((node) => node.id === 'architecture');
  const specGate = gateDag.nodes.find((node) => node.id === 'spec');
  const routeGates = [
    'gate:pr_route_classification',
    'gate:pr_body_contract',
    'gate:mirror_source_traceability',
    'gate:ci_status_or_waiver',
    'gate:vibepro_artifact_policy',
    'gate:split_resolution'
  ].map((id) => gateDag.nodes.find((node) => node.id === id)).filter(Boolean);
  const responsibilityAuthorityGate = gateDag.nodes.find((node) => node.id === 'gate:responsibility_authority');
  const requirementGate = gateDag.nodes.find((node) => node.id === 'gate:requirement');
  const agentReviewGate = gateDag.nodes.find((node) => node.id === 'gate:agent_review');
  const lines = [
    `- overall: ${gateDag.overall_status}`,
    `- acceptance criteria: ${gateDag.summary.acceptance_criteria_count}`,
    Array.isArray(gateDag.summary.suppressed_judgment_axes) && gateDag.summary.suppressed_judgment_axes.length > 0
      ? `- suppressed axis candidates: ${gateDag.summary.suppressed_judgment_axes.map((axis) => `${axis.axis}[${axis.precision_status}]:${axis.reason}`).join(' ; ')}`
      : null,
    storyGate
      ? `- ${storyGate.label}: ${storyGate.status} (${storyGate.required ? 'required' : 'optional'}) - ${storyGate.reason ?? storyGate.artifact ?? '-'}`
      : null,
    architectureGate
      ? `- ${architectureGate.label}: ${architectureGate.status} (${architectureGate.required ? 'required' : 'optional'}) - ${architectureGate.reason ?? '-'}`
      : null,
    specGate
      ? `- ${specGate.label}: ${specGate.status} (${specGate.required ? 'required' : 'optional'}) - ${specGate.reason ?? '-'}`
      : null,
    ...routeGates.map((gate) => {
      const required = gate.required ? 'required' : 'optional';
      const sections = Array.isArray(gate.required_sections) ? ` sections=${gate.required_sections.join(',')}` : '';
      return `- ${gate.label}: ${gate.status} (${required}) - ${gate.reason ?? '-'}${sections}`;
    }),
    responsibilityAuthorityGate
      ? `- ${responsibilityAuthorityGate.label}: ${responsibilityAuthorityGate.status} (${responsibilityAuthorityGate.required ? 'required' : 'optional'}) - ${responsibilityAuthorityGate.reason}`
      : null,
    requirementGate
      ? `- ${requirementGate.label}: ${requirementGate.status} (${requirementGate.required ? 'required' : 'optional'}) - ${requirementGate.reason}`
      : null,
    agentReviewGate
      ? `- ${agentReviewGate.label}: ${agentReviewGate.status} (${agentReviewGate.required ? 'required' : 'optional'}) - required review role status is incomplete`
      : null,
    ...gates.map((gate) => {
      const required = gate.required ? 'required' : 'optional';
      const detail = gate.evidence?.artifact
        ? `evidence: ${gate.evidence.artifact}`
        : (summarizePrGateReason(gate.reason) ?? '-');
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
    `- Policy Sources: ${summary.policy_ref_count ?? 0}`,
    `- Domain Contract Sources: ${summary.domain_contract_ref_count ?? 0}`,
    `- Responsibility Matches: ${summary.responsibility_authority_ref_count ?? 0}`,
    `- Responsibility Unknowns: ${summary.responsibility_authority_unregistered_count ?? 0}`
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
  const responsibilities = (requirement.responsibility_authority?.matched_responsibilities ?? []).slice(0, 5)
    .map((item) => `- Responsibility Authority: ${item.id} (${item.evidence_status})`)
    .join('\n');
  return [
    renderRequirementGateSummary(requirement),
    renderRequirementPrHint(requirement, language),
    sources,
    sourceRefs,
    invariants,
    gaps,
    contradictions,
    responsibilities
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
      ja: '- 次に見るもの: Story未明示シナリオを確認し、意図した既存挙動ならSpecの該当clauseへ `inherited_behavior: { condition, classification, files }` を追加、意図しないなら実装かテストを修正してください。',
      en: '- Review next: scenario gaps. If intended existing behavior, add `inherited_behavior: { condition, classification, files }` to the owning Spec clause; otherwise fix implementation or tests.'
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
  const warnings = collectReleaseDecisionWarningGates(gateDag);
  const warningLines = warnings.length > 0
    ? [
        `- release decision warnings: ${formatUnresolvedGateList(warnings)}`,
        ...warnings.flatMap((gate) => formatReleaseDecisionWarningDetails(gate))
      ]
    : [];
  if (unresolved.length === 0) {
    return [
      '- status: ready_for_review',
      '- completion: Gate証跡が揃っているため、VibePro上は完了扱い可能',
      ...warningLines
    ].join('\n');
  }

  return [
    '- status: blocked_by_gate',
    '- completion: 未完了Gateが残っているため、このPRはVibePro上の完了扱い不可',
    `- unresolved: ${formatUnresolvedGateList(unresolved)}`,
    ...warningLines,
    '- gate detail: see review-cockpit.html and gate-dag.json',
    '- guardrail: raw GitHub PR creation is not gate-preserving'
  ].join('\n');
}

function formatReleaseDecisionWarningDetails(gate) {
  const lines = [];
  if (gate.reason) lines.push(`- warning detail: ${gate.label ?? gate.id}: ${gate.reason}`);
  for (const action of gate.required_actions ?? []) {
    lines.push(`- warning action: ${action}`);
  }
  return lines;
}

function buildDecisionRecordGate(decisionRecords) {
  const decisions = Array.isArray(decisionRecords?.decisions) ? decisionRecords.decisions : [];
  const summary = decisionRecords?.summary ?? summarizeDecisionRecords(decisionRecords);
  const open = decisions.filter((decision) => decision.status === 'open');
  const secretExposure = decisions.filter((decision) => decision.type === 'secret_exposure');
  const status = open.length > 0 ? 'needs_review' : 'passed';
  return {
    id: 'gate:decision_record',
    type: 'decision_record_gate',
    label: 'Decision Record Gate',
    status,
    required: true,
    reason: status === 'passed'
      ? `Decision records are captured; total=${summary.total}, waivers=${summary.by_type.waiver ?? 0}, noise=${summary.by_type.noise ?? 0}, secret_exposure=${summary.by_type.secret_exposure ?? 0}`
      : `${open.length} decision record(s) are still open; classify as accepted/rejected/superseded before PR creation.`,
    artifact: decisionRecords?.artifact ?? null,
    summary,
    open_decisions: open.map((decision) => ({
      decision_id: decision.decision_id,
      type: decision.type,
      source: decision.source,
      summary: decision.summary
    })),
    secret_exposure_count: secretExposure.length
  };
}

function collectUnresolvedRequiredGates(gateDag) {
  return (gateDag?.nodes ?? [])
    .filter((node) => [
      'story',
      'story_source_integrity_gate',
      'engineering_judgment_spine_gate',
      'pr_scope_judgment_gate',
      'scope_boundary_gate',
      'pr_route_gate',
      'pr_body_contract_gate',
      'mirror_source_traceability_gate',
      'ci_status_or_waiver_gate',
      'vibepro_artifact_policy_gate',
      'split_resolution_gate',
      'managed_worktree_gate',
      'judgment_axis_gate',
      'security_regression_gate',
      'agent_evidence_lifecycle_gate',
      'safety_surface_gate',
      'deploy_verification_gate',
      'bug_physics_triage_gate',
      'bug_physics_profile_gate',
      'bug_physics_feedback_gate',
      'architecture_blueprint_gate',
      'architecture_gate',
      'spec_gate',
      'decision_record_gate',
      'evidence_adjudication_gate',
      'judgment_dag_adjudication_gate',
      'verification_gate',
      'requirement_gate',
      'responsibility_authority_gate',
      'design_ssot_reconciliation_gate',
      'senior_gap_judgment_gate',
      'failure_mode_coverage_gate',
      'path_surface_matrix_gate',
      'journey_context_gate',
      'design_diagrams_gate',
      'review_inspection_required_gate',
      'definition_of_done_gate',
      'visual_qa_gate',
      'design_quality_gate',
      'workflow_heavy_gate',
      'validation_sequencing_gate',
      'pr_freshness_gate',
      'artifact_consistency_gate',
      'agent_review_dispatch_batch_gate',
      'agent_review_dispatch_preflight_gate',
      'agent_review_prepare_gate',
      'agent_review_role_gate',
      'agent_review_record_gate',
      'agent_review_stage_join_gate',
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
      stale_artifact_details: node.stale_artifact_details,
      stale_artifact_groups: node.stale_artifact_groups,
      minimal_recovery_plan: node.minimal_recovery_plan,
      required_actions: node.required_actions,
      required_diagrams: node.required_diagrams,
      provided_diagrams: node.provided_diagrams,
      missing_diagrams: node.missing_diagrams,
      detection_reasons: node.detection_reasons,
      downstream_diagram_requirements: node.downstream_diagram_requirements,
      reason: node.reason
    }));
}

function collectReleaseDecisionWarningGates(gateDag) {
  return (gateDag?.nodes ?? [])
    .filter((node) => ['gate:managed_worktree', 'gate:design_input_judgment'].includes(node.id))
    .filter((node) => node.required !== true)
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

export function isUnresolvedGateStatus(status) {
  return [
    'candidate',
    'missing',
    'transient',
    'implicit',
    'inferred_empty',
    'needs_evidence',
    'needs_story',
    'needs_setup',
    'needs_review',
    'needs_inspection',
    'needs_split',
    'needs_rebase',
    'needs_changes',
    'needs_scope_correction',
    'contradicted',
    'missing_coverage',
    'partial_surface',
    'stale',
    'stale_evidence',
    'story_source_mismatch',
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
      if (gate.id === 'gate:visual_qa') return 'Visual QA Gate requires ready_for_review visual residual evidence. Run `vibepro verify visual . --id <story-id> --base-url <preview-url>` or `vibepro verify visual . --id <story-id> --current-dir <dir>` so `.vibepro/qa/<qa-id>/visual-residual.json` and `residual-analysis.md` are current-head bound.';
      if (gate.id === 'gate:story_source_integrity') return 'Story Source Integrity Gate requires the selected Story and resolved/changed Story document to match before Requirement and PR body evidence can be trusted.';
      if (gate.id === 'architecture') return 'Architecture Gate requires an ADR or explicit ADR-unnecessary decision in the Story.';
      if (gate.id === 'spec') return 'Spec Gate requires present/inferred Spec evidence without high-severity drift.';
      if (gate.id === 'story') return 'Story Gate requires a resolvable Story source.';
      if (gate.id === 'gate:scope_boundary') return 'Story Scope Boundary Gate requires changed files to match the story\'s declared --allowed-paths, or an accepted decision against `gate:scope_boundary`/`gate:split_resolution` for the out-of-scope files.';
      if (gate.id === 'gate:responsibility_authority') return 'Responsibility Authority Gate requires each matched cross-story responsibility to resolve to registered authority and current-head evidence, or an explicit decision for no_registered_authority.';
      if (gate.id === 'gate:design_ssot_reconciliation') return 'Design SSOT Reconciliation Gate requires root/child design docs to be linked, current enough, and free of deterministic supersession conflicts; review `.vibepro/pr/<story-id>/design-ssot-reconciliation.json`.';
      if (gate.id === 'gate:senior_gap_judgment') return 'Senior Gap Judgment Gate requires ideal/current/gap/decision/residual-risk evidence to be explicit; review `.vibepro/pr/<story-id>/senior-gap-judgment.json`.';
      if (gate.id === 'gate:requirement') return 'Requirement Gate requires scenario gaps/contradictions to be resolved in Story/Spec/Architecture; for intended existing behavior, add structured `inherited_behavior: { condition, classification, files }` to the owning Spec clause instead of relying on free-text inherited/existing keywords.';
      if (gate.id === 'gate:decision_record') return 'Decision Record Gate requires every needs_review, noise classification, waiver, and secret exposure decision to be recorded and closed in `vibepro decision record/status` artifacts.';
      if (gate.id === 'gate:evidence_adjudication') return 'Evidence Adjudication Gate requires an independent fresh-context subagent to judge, per acceptance criteria clause, whether the recorded evidence actually demonstrates the outcome. Run `vibepro adjudicate prepare`, dispatch the request to a fresh subagent, and record every clause verdict with `vibepro adjudicate record`; clauses judged not verifiable by automation need an accepted human decision record.';
      if (gate.id === 'gate:judgment_dag_adjudication') return 'Judgment DAG Adjudication Gate requires an independent fresh-context subagent to walk the senior-judgment checklist (spine subchecks, judgment axes, failure modes) against the actual change. Run `vibepro adjudicate prepare --judgment`, dispatch the request, and record every item verdict with `vibepro adjudicate record --judgment`; items judged as needing human judgment need an accepted decision record.';
      if (gate.id === 'gate:network_contract') return 'Network Contract Gate requires matching Next.js API routes and network-aware E2E evidence for new /api client calls.';
      if (gate.id === 'gate:journey_context') return 'Journey Context Gate requires UI changes to be checked against the latest Journey step, affected conflicts, and blocking open questions.';
      if (gate.id === 'gate:pr_freshness') return 'PR Freshness Gate requires `git fetch origin`, rebasing the PR branch onto the current base ref, rerunning verification evidence, and regenerating `vibepro pr prepare`.';
      if (gate.id === 'gate:pr_route_classification') return 'PR Route Classification Gate requires a route before VibePro can choose the correct body contract and evidence path.';
      if (gate.id === 'gate:pr_body_contract') return 'PR Body Contract Gate requires the PR text to expose the route-specific decision question, source of truth, gates, and waiver/evidence clauses.';
      if (gate.id === 'gate:managed_worktree') return 'Managed Worktree Gate requires running VibePro evidence, review, and PR creation commands from the recorded `vibepro execute start` managed_worktree.path, or an accepted `gate:managed_worktree` waiver decision.';
      if (gate.id === 'gate:mirror_source_traceability') return 'Mirror/Release Source Traceability Gate requires the source PR, source commit, or upstream ref to be cited before merge.';
      if (gate.id === 'gate:ci_status_or_waiver') return 'CI Status / Waiver Gate requires target CI, source CI inheritance, or an explicit waiver for mirror/release routes.';
      if (gate.id === 'gate:vibepro_artifact_policy') return 'VibePro Artifact Policy Gate requires an explicit decision for committed `.vibepro/` diagnostic artifacts.';
      if (gate.id === 'gate:split_resolution') return 'Split Resolution Gate requires the split/clean-branch recommendation to be resolved or explicitly justified.';
      if (gate.id === 'gate:managed_worktree') return 'Managed Worktree Gate requires running the command from the recorded managed worktree, updating that worktree to the current HEAD, or explicitly disabling managed_worktree.';
      if (gate.id?.startsWith('gate:workflow_') || gate.id === 'gate:production_path_matrix' || gate.id === 'gate:evidence_coverage' || gate.id === 'gate:release_confidence') {
        return `${gate.label ?? gate.id} requires workflow-heavy evidence: explicit scenario clauses, production path matrix coverage, and passing flow replay evidence.`;
      }
      if (gate.id?.startsWith('review:prepare:')) return `${gate.label ?? gate.id} requires running the listed \`vibepro review prepare\` command and using the generated review requests with permitted Codex/Claude Code subagents.`;
      if (gate.id?.startsWith('review:record:')) return `${gate.label ?? gate.id} requires recording the review result with \`vibepro review record --agent-closed\` for its effective freshness policy (content surface by default; current HEAD only for strict roles), current dirty fingerprint, and closed subagent lifecycle.`;
      if (gate.id?.startsWith('review:')) return `${gate.label ?? gate.id} requires completing the assigned review role.`;
      if (gate.id === 'gate:agent_review') return 'Agent Review Gate requires `vibepro review prepare` plus passing `vibepro review record --execution-mode parallel_subagent --agent-closed` results from permitted Codex/Claude Code subagents under each role\'s effective freshness policy (content surface by default; current HEAD only for strict roles), current dirty fingerprint, and closed subagent lifecycle.';
      if (gate.status === 'failed' || gate.status === 'contradicted') return `${gate.label ?? gate.id} requires a passing or non-contradicted state.`;
      return `${gate.label ?? gate.id} requires evidence before PR creation.`;
    })
    .join(' ');
}

export function buildGateOverride(gateDag, options, context = {}) {
  if (!gateDag || gateDag.overall_status === 'ready_for_review') return null;
  if (!options.allowNeedsVerification) return null;
  const unresolvedGates = collectPrReadinessBlockingItems(gateDag);
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
  if (gate.id === 'gate:story_source_integrity' && gate.status !== 'passed') return true;
  if (gate.id === 'architecture' && gate.status === 'needs_review') return true;
  if (gate.id === 'spec' && ['implicit', 'inferred_empty', 'needs_review'].includes(gate.status)) return true;
  if (gate.id === 'gate:e2e' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:visual_qa' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:design_diagrams' && gate.status !== 'satisfied') return true;
  if (gate.id === 'gate:design_quality' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:requirement' && ['needs_review', 'contradicted'].includes(gate.status)) return true;
  if (gate.id === 'gate:decision_record' && gate.status === 'needs_review') return true;
  if (gate.id === 'gate:evidence_adjudication' && !['passed', 'not_applicable'].includes(gate.status)) return true;
  if (gate.id === 'gate:judgment_dag_adjudication' && !['passed', 'not_applicable'].includes(gate.status)) return true;
  if (gate.id === 'gate:network_contract' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:journey_context' && !['passed', 'accepted_followup'].includes(gate.status)) return true;
  if (gate.id === 'gate:pr_freshness' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:artifact_consistency' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:failure_mode_coverage' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:path_surface_matrix' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:responsibility_authority' && !['passed', 'not_applicable'].includes(gate.status)) return true;
  if (gate.id === 'gate:review_inspection_required' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_scope_judgment' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:scope_boundary' && gate.status === 'needs_scope_correction') return true;
  if (gate.id === 'gate:common_judgment_spine' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_route_classification' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_body_contract' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:bug_physics_triage' && gate.status !== 'passed') return true;
  if (gate.type === 'bug_physics_profile_gate' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:bug_physics_contradiction_feedback' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:managed_worktree' && !['passed', 'bypassed', 'not_applicable', 'satisfied'].includes(gate.status)) return true;
  if (gate.id === 'gate:mirror_source_traceability' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:ci_status_or_waiver' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:vibepro_artifact_policy' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:split_resolution' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:managed_worktree' && gate.required && !['passed', 'bypassed', 'not_applicable', 'satisfied'].includes(gate.status)) return true;
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
    Object.entries(artifacts).map(([key, value]) => [key, value ? toWorkspaceRelative(repoRoot, value) : value])
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

function isExistingPullRequestCreateError(result) {
  const text = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  return /pull request/i.test(text) && /(already|exist)/i.test(text);
}

function parseExistingPullRequestFromList(stdout) {
  const trimmed = String(stdout ?? '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed[0] ?? null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeExistingPullRequest(pr) {
  return {
    number: Number.isInteger(pr?.number) ? pr.number : null,
    url: typeof pr?.url === 'string' && pr.url ? pr.url : null,
    state: typeof pr?.state === 'string' && pr.state ? pr.state : null,
    is_draft: typeof pr?.isDraft === 'boolean' ? pr.isDraft : null,
    base_ref_name: typeof pr?.baseRefName === 'string' && pr.baseRefName ? pr.baseRefName : null,
    head_ref_name: typeof pr?.headRefName === 'string' && pr.headRefName ? pr.headRefName : null,
    head_ref_oid: typeof pr?.headRefOid === 'string' && pr.headRefOid ? pr.headRefOid : null,
    merge_state_status: typeof pr?.mergeStateStatus === 'string' && pr.mergeStateStatus ? pr.mergeStateStatus : null
  };
}

function isMatchingHeadOid(actual, expected) {
  if (!actual || !expected) return false;
  return actual.toLowerCase() === expected.toLowerCase();
}

async function writePrCreateArtifacts(repoRoot, prepareResult, execution) {
  const prDir = path.dirname(prepareResult.artifacts.json);
  const jsonPath = path.join(prDir, 'pr-create.json');
  const reportPath = path.join(prDir, 'pr-create.html');
  await writeFile(jsonPath, `${JSON.stringify(execution, null, 2)}\n`);
  await writeFile(reportPath, renderPrCreateHtml(execution, {
    language: execution.output?.language ?? 'ja'
  }));
  const projectionStoryId = execution.story_id ?? execution.story?.story_id;
  if (execution.workspace_initialized && projectionStoryId) {
    await projectArtifact(repoRoot, 'pr', { storyId: projectionStoryId, content: execution });
  }

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

export async function resolveStory(repoRoot, config, storyId, options = {}) {
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

function findLatestStoryRunByPhase(manifest, storyId, phase) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  return runs.find((run) => run?.story_id === storyId && run.phase === phase) ?? null;
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
  if (!filePath) return '-';
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

async function git(repoRoot, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return stdout.trim();
}
