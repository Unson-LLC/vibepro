import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { formatCounts } from './refactoring-delta-reporter.js';
import { buildRequirementConsistency, renderRequirementGateSummary } from './requirement-consistency.js';
import { renderGateDagHtml, renderPrCreateHtml, renderPrPrepareHtml, renderSplitPlanHtml } from './html-report.js';
import { normalizeActiveStories } from './story-manager.js';
import { DEFAULT_BRAINBASE_STORIES, getWorkspaceDir, readManifest, toWorkspaceRelative, writeManifest } from './workspace.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_REVIEWABLE_FILES = 30;

export async function preparePullRequest(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const git = await collectGitState(root, options);
  const workspace = await readWorkspaceState(root);
  const story = resolveStory(workspace.config, options.storyId, {
    allowTransient: !workspace.initialized
  });
  const manifest = workspace.initialized
    ? await readManifest(root)
    : createTransientManifest();

  // DAG strict mode: task必須・target_files一致・handoff/execute artifacts存在を要求
  if (options.strict && !options.taskId) {
    throw new Error(
      'Strict mode requires --task. Run `vibepro task create --from-plan --id <story>` and ' +
      '`vibepro task brief|plan|handoff|execute` for the task before pr prepare/create.'
    );
  }

  const taskContext = workspace.initialized && options.taskId
    ? await loadPrTaskContext(root, story.story_id, options.taskId, options.groupId)
    : null;

  if (options.strict && taskContext) {
    await assertStrictTaskArtifacts(root, story.story_id, taskContext.task.id, taskContext.group?.id);
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
    commits: reviewGit.commits,
    maxReviewableFiles: options.maxReviewableFiles ?? DEFAULT_MAX_REVIEWABLE_FILES
  });
  const latestStoryRun = findLatestStoryRun(manifest, story.story_id);
  const verificationEvidence = workspace.initialized
    ? await readVerificationEvidenceIfExists(root, story.story_id)
    : null;
  const prContext = await buildPrContext(root, {
    story,
    taskContext,
    git: reviewGit,
    fileGroups,
    latestStoryRun,
    verificationEvidence
  });
  const suggestedBranch = options.branchName ?? buildBranchName(story);
  const splitPlan = await buildPrSplitPlan(root, {
    story,
    git: reviewGit,
    fileGroups,
    scope,
    prContext,
    suggestedBranch
  });
  const nextCommands = buildNextCommands({
    baseRef: git.base_ref,
    currentBranch: reviewGit.current_branch,
    suggestedBranch,
    commits: reviewGit.commits,
    scope,
    storyId: story.story_id,
    taskId: taskContext?.task?.id ?? options.taskId ?? null,
    groupId: taskContext?.group?.id ?? options.groupId ?? null
  });
  const prBody = renderPrBody({
    story,
    taskContext,
    git: reviewGit,
    fileGroups,
    latestStoryRun,
    scope,
    prContext,
    splitPlan
  });
  const preparation = {
    schema_version: '0.1.0',
    story,
    created_at: new Date().toISOString(),
    workspace: {
      initialized: workspace.initialized,
      artifact_location: workspace.initialized ? 'repo' : 'temporary'
    },
    git: reviewGit,
    file_groups: fileGroups,
    scope,
    split_plan: splitPlan,
    pr_context: prContext,
    task_context: taskContext,
    latest_story_run: latestStoryRun,
    suggested_branch: suggestedBranch,
    next_commands: nextCommands
  };

  const prRoot = workspace.initialized
    ? getWorkspaceDir(root)
    : await mkdtemp(path.join(os.tmpdir(), 'vibepro-pr-prepare-'));
  const prDir = path.join(prRoot, 'pr', story.story_id);
  await mkdir(prDir, { recursive: true });
  const jsonPath = path.join(prDir, 'pr-prepare.json');
  const reportPath = path.join(prDir, 'pr-prepare.html');
  const bodyPath = path.join(prDir, 'pr-body.md');
  const gateDagJsonPath = path.join(prDir, 'gate-dag.json');
  const gateDagReportPath = path.join(prDir, 'gate-dag.html');
  const splitPlanJsonPath = path.join(prDir, 'split-plan.json');
  const splitPlanReportPath = path.join(prDir, 'split-plan.html');
  await writeFile(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`);
  await writeFile(bodyPath, prBody);
  await writeFile(gateDagJsonPath, `${JSON.stringify(prContext.gate_dag, null, 2)}\n`);
  await writeFile(gateDagReportPath, renderGateDagHtml(prContext.gate_dag));
  await writeFile(splitPlanJsonPath, `${JSON.stringify(splitPlan, null, 2)}\n`);
  await writeFile(splitPlanReportPath, renderSplitPlanHtml(splitPlan));
  await writeFile(reportPath, renderPrPrepareHtml({
    preparation,
    bodyPath: toWorkspaceRelative(root, bodyPath),
    gateDagPath: toWorkspaceRelative(root, gateDagReportPath),
    splitPlanPath: toWorkspaceRelative(root, splitPlanReportPath)
  }));

  if (workspace.initialized) {
    manifest.pr_preparations = {
      ...(manifest.pr_preparations ?? {}),
      [story.story_id]: {
        latest_prepare: toWorkspaceRelative(root, jsonPath),
        latest_report: toWorkspaceRelative(root, reportPath),
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
    await writeManifest(root, manifest);
  }

  return {
    story,
    preparation,
    artifacts: {
      json: jsonPath,
      report: reportPath,
      pr_body: bodyPath,
      gate_dag: gateDagJsonPath,
      gate_dag_report: gateDagReportPath,
      split_plan: splitPlanJsonPath,
      split_plan_report: splitPlanReportPath
    }
  };
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
  if (gateDag && gateDag.overall_status !== 'ready_for_review' && !options.allowNeedsVerification) {
    const unresolved = collectUnresolvedRequiredGates(gateDag);
    throw new Error(
      `Pre-create gate check failed: gate_dag.overall_status === '${gateDag.overall_status}' ` +
      `(needs_evidence_count=${gateDag.summary?.needs_evidence_count ?? 0}). ` +
      `Unresolved gates: ${formatUnresolvedGateList(unresolved)}. ` +
      `Provide evidence for required gates (Unit/Integration/E2E) or pass ` +
      `--allow-needs-verification --verification-waiver <reason> to bypass with an auditable reason.`
    );
  }
  if (gateDag && gateDag.overall_status !== 'ready_for_review' && options.allowNeedsVerification && !options.verificationWaiver) {
    throw new Error(
      `Pre-create gate waiver missing: --allow-needs-verification requires ` +
      `--verification-waiver <reason> so the PR records why unresolved gates are acceptable.`
    );
  }

  const baseBranch = stripRemote(options.prBase ?? preparation.git.base_ref);
  const headBranch = options.headBranch ?? currentBranch;
  const title = options.title ?? buildPrTitle(preparation);
  const bodyFile = prepareResult.artifacts.pr_body;
  const warnings = [];
  const gateOverride = buildGateOverride(gateDag, options);
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
    gate_dag: gateDag ?? null,
    gate_override: gateOverride,
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
    const ghResult = await runCommand(root, ghCommand, options);
    execution.results.push(ghResult);
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
  return `# PR Prepare

| 項目 | 内容 |
|------|------|
| Story | ${preparation.story.story_id} |
| Base | ${preparation.git.base_ref} |
| Head | ${preparation.git.head_ref} |
| Current branch | ${preparation.git.current_branch ?? '-'} |
| Changed files | ${preparation.git.changed_files.length} |
| Commits | ${preparation.git.commits.length} |
| Scope | ${preparation.scope.status} |
| Recommended strategy | ${preparation.scope.recommended_strategy} |
| Task | ${preparation.task_context?.task?.id ?? '-'} |
| Workspace | ${preparation.workspace.initialized ? 'initialized' : 'temporary artifacts'} |

## Artifacts

- report_html: ${toDisplayPath(result.artifacts.report)}
- pr_body_markdown: ${toDisplayPath(result.artifacts.pr_body)}
- gate_dag_json: ${toDisplayPath(result.artifacts.gate_dag)}
- gate_dag_html: ${toDisplayPath(result.artifacts.gate_dag_report)}
- split_plan_json: ${toDisplayPath(result.artifacts.split_plan)}
- split_plan_html: ${toDisplayPath(result.artifacts.split_plan_report)}
- json: ${toDisplayPath(result.artifacts.json)}
`;
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
  const committedChangedFiles = await getChangedFiles(repoRoot, baseRef, headRef);
  const commits = await getCommits(repoRoot, baseRef, headRef);
  const dirtyFiles = parseStatus(await gitOptional(repoRoot, ['status', '--porcelain']));
  const changedFiles = mergeChangedAndDirtyFiles(committedChangedFiles, dirtyFiles);
  return {
    current_branch: currentBranch || null,
    base_ref: baseRef,
    head_ref: headRef,
    changed_files: changedFiles,
    dirty_files: dirtyFiles,
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
  const output = await gitOptional(repoRoot, ['log', '--oneline', `${baseRef}..${headRef}`]);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, ...messageParts] = line.split(' ');
      return { sha, message: messageParts.join(' ') };
    });
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

function groupChangedFiles(files) {
  const groups = {
    story_docs: [],
    architecture_docs: [],
    specifications: [],
    source: [],
    tests: [],
    repo_control: [],
    vibepro_artifacts: [],
    other: []
  };

  for (const file of files) {
    const target = file.path;
    if (target.startsWith('docs/management/stories/') || target.startsWith('docs/stories/')) groups.story_docs.push(file);
    else if (isArchitectureDocPath(target)) groups.architecture_docs.push(file);
    else if (isSpecificationDocPath(target)) groups.specifications.push(file);
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

function assessScope({ changedFiles, fileGroups, dirtyFiles, commits, maxReviewableFiles }) {
  const reasons = [];
  if (changedFiles.length > maxReviewableFiles) {
    reasons.push(`差分が ${changedFiles.length} files あり、レビュー可能な目安 ${maxReviewableFiles} files を超えている`);
  }
  if (hasMixedRepoControlChanges(fileGroups)) {
    reasons.push('repo制御ファイルやagent設定が差分に含まれている');
  }
  const nonWorkspaceDirty = dirtyFiles.filter((file) => !file.path.startsWith('.vibepro/'));
  if (nonWorkspaceDirty.length > 0) {
    reasons.push(`未コミット差分が ${nonWorkspaceDirty.length} files 残っている`);
  }
  if (commits.length > 1) {
    reasons.push(`baseからのcommitが ${commits.length} 件あり、Story外の変更混入を確認する必要がある`);
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
    fileGroups.source,
    fileGroups.other
  ];
  return nonRepoGroups.some((group) => group.count > 0);
}

function buildNextCommands({ baseRef, currentBranch, suggestedBranch, commits, scope, storyId, taskId = null, groupId = null }) {
  const prCreateCommand = [
    'npx vibepro pr create .',
    storyId ? `--story-id ${storyId}` : null,
    taskId ? `--task ${taskId}` : null,
    groupId ? `--group ${groupId}` : null,
    `--base ${baseRef}`
  ].filter(Boolean).join(' ');

  if (scope.recommended_strategy === 'current_branch_pr') {
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
    `${prCreateCommand} --head ${suggestedBranch}`
  ];
}

function renderPrBody({ story, taskContext, git, fileGroups, latestStoryRun, scope, prContext, splitPlan }) {
  const source = prContext.story_source;
  const changeSummary = prContext.change_summary.length === 0
    ? '- 差分なし'
    : prContext.change_summary.map((item) => `- ${item}`).join('\n');
  const acceptance = source.acceptance_criteria.length === 0
    ? '- Story文書から受け入れ基準を抽出できませんでした'
    : source.acceptance_criteria.map((item) => `- ${item}`).join('\n');
  const verification = prContext.verification_commands.length === 0
    ? '- [ ] 手動確認または対象テストを追記する'
    : prContext.verification_commands.map((item) => `- [ ] \`${item.command}\` - ${item.reason}`).join('\n');
  const reviewPoints = prContext.review_points.map((item) => `- ${item}`).join('\n');
  const risks = prContext.risks.length === 0
    ? '- 特記事項なし'
    : prContext.risks.map((item) => `- ${item}`).join('\n');
  const gateSummary = renderPrGateSummary(prContext.gate_dag);
  const gateEnforcement = renderPrGateEnforcement(prContext.gate_dag);
  const taskSection = renderPrTaskSection(taskContext);
  const refactoringDeltaSection = renderPrRefactoringDelta(prContext.refactoring_delta);
  const flowVerificationSection = renderPrFlowVerification(prContext.flow_verification);

  return `## 概要
- Story: ${story.story_id} ${story.title}
- VibePro scope: ${scope.status}
- PR strategy: ${scope.recommended_strategy}
- 変更ファイル: ${git.changed_files.length} files

## 背景・要求
- 正本: ${source.path ?? 'Story未検出'}
- 要求: ${source.requirement_title ?? source.title ?? story.title}
${source.requirement_id ? `- 要求ID: ${source.requirement_id}` : ''}
${source.requirement_url ? `- 要求URL: ${source.requirement_url}` : ''}
${source.background ? `- 背景: ${source.background}` : '- 背景: Story文書から抽出できませんでした'}

## 実装判断
- ADR: ${prContext.architecture_decision}
- Scope: ${scope.status}
${scope.reasons.length === 0 ? '- Scope理由: current branchのままPR化可能' : scope.reasons.map((reason) => `- Scope理由: ${reason}`).join('\n')}

${taskSection}

## 変更内容
${changeSummary}

## 差分分類
${Object.entries(fileGroups)
    .filter(([, value]) => value.count > 0)
    .map(([key, value]) => `- ${key}: ${value.count}`)
    .join('\n') || '- なし'}

## 受け入れ基準
${acceptance}

## 検証
${verification}

## 要件整合性
${renderRequirementPrSection(prContext.requirement_consistency)}

## Gate DAG
${gateSummary}

## Gate Enforcement
${gateEnforcement}

${flowVerificationSection}

${refactoringDeltaSection}

## 分割計画
${renderPrSplitSection(splitPlan)}

## レビュー観点
${reviewPoints || '- Story / ADR / Spec と実装差分が対応しているか'}

## リスク・確認事項
${risks}

## VibePro
- latest story run: ${latestStoryRun?.run_id ?? '-'}
- gate: ${latestStoryRun?.gate_status ?? '-'}
- PR strategy: ${scope.recommended_strategy}
`;
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
  const gateInfraFiles = repoControlFiles.filter(isGateInfraPath);
  const repoPolicyFiles = repoControlFiles.filter((file) => !gateInfraFiles.includes(file));

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
    title: 'Story / Spec / Architecture SSOT',
    category: 'requirements',
    recommendation: scope.status === 'reviewable' ? 'same_pr_allowed' : 'separate_pr',
    files: [
      ...fileGroups.story_docs.files,
      ...fileGroups.specifications.files,
      ...fileGroups.architecture_docs.files
    ],
    required_gates: ['Requirement Gate'],
    review_focus: [
      'Story / Spec / Architecture の正本が互いに矛盾していないか',
      '実装差分が要求の範囲を超えていないか'
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
    ...fileGroups.other.files,
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
      review_note: buildStackedGateReviewNote({ lane, gateMode, dependsOn })
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

function buildStackedGateReviewNote({ lane, gateMode, dependsOn }) {
  if (gateMode === 'cumulative_after_dependencies') {
    return `${lane.id} は単体PRだけで完了判定せず、${dependsOn.join(' -> ')} を取り込んだ累積状態でGateを確認する。`;
  }
  if (lane.id === 'runtime-behavior') {
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
  const primaryStory = pickPrimaryStory(storyDocs, story);
  const architectureDecision = resolveArchitectureDecision(primaryStory, fileGroups);
  const typecheckCommand = await detectTypecheckCommand(repoRoot);
  const testRunner = await detectTestRunner(repoRoot);
  const verificationCommands = buildVerificationCommands(fileGroups, { typecheckCommand, testRunner });
  const e2eCommand = await detectPlaywrightCommand(repoRoot, fileGroups);
  const latestEvidence = await readRunEvidenceIfExists(repoRoot, latestStoryRun);
  const latestFlowVerification = await readLatestFlowVerification(repoRoot, story.story_id);
  const requirementConsistency = await buildRequirementConsistency(repoRoot, {
    story,
    storySource: primaryStory,
    fileGroups
  });
  const context = {
    story_source: primaryStory,
    architecture_decision: architectureDecision,
    requirement_consistency: requirementConsistency,
    change_summary: buildChangeSummary(fileGroups),
    verification_commands: verificationCommands,
    review_points: buildReviewPoints(fileGroups, taskContext),
    refactoring_delta: latestEvidence?.refactoring_delta ?? null,
    flow_verification: latestFlowVerification,
    verification_evidence: verificationEvidence,
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
    verificationEvidence
  });
  context.risks = buildRisks({ git, fileGroups, latestStoryRun, gateDag: context.gate_dag, taskContext });
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

async function readLatestFlowVerification(repoRoot, storyId) {
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
  const runs = Array.isArray(manifest.flow_verification_runs) ? manifest.flow_verification_runs : [];
  const matching = runs.find((run) => run.story_id === storyId)
    ?? runs.find((run) => run.run_id === manifest.latest_flow_verification_run)
    ?? runs[0]
    ?? null;
  const artifact = matching?.artifacts?.flow_verification_json;
  if (!artifact) return matching;
  try {
    const verification = JSON.parse(await readFile(path.resolve(repoRoot, artifact), 'utf8'));
    return {
      ...matching,
      verification,
      artifact
    };
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
    background: extractSectionText(content, ['背景', '現状', '課題']),
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

function extractAcceptanceCriteria(content) {
  const section = extractRawSection(content, ['受け入れ基準', '完了定義', 'Acceptance Criteria']);
  const source = section ?? content;
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^-\s+\[[ xX]\]\s+/.test(line))
    .map((line) => line.replace(/^-\s+\[[ xX]\]\s+/, '').trim())
    .slice(0, 8);
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
  return `npm test -- --runTestsByPath ${testFiles.join(' ')} --runInBand`;
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
  verificationEvidence
}) {
  const acceptanceCriteria = storySource.acceptance_criteria.length > 0
    ? storySource.acceptance_criteria
    : ['Storyの受け入れ基準を明文化する'];
  const gates = buildVerificationGates({
    fileGroups,
    verificationCommands,
    e2eCommand,
    flowVerification,
    verificationEvidence
  });
  const requirementGate = {
    id: 'gate:requirement',
    type: 'requirement_gate',
    label: 'Requirement Gate',
    status: resolveRequirementGateStatus(requirementConsistency),
    required: fileGroups.source.count > 0 || fileGroups.story_docs.count > 0,
    reason: buildRequirementGateReason(requirementConsistency)
  };
  const nodes = [
    {
      id: 'story',
      type: 'story',
      label: `${story.story_id} ${story.title}`,
      status: storySource.path ? 'present' : 'transient',
      artifact: storySource.path
    },
    {
      id: 'architecture',
      type: 'architecture_gate',
      label: 'Architecture Gate',
      status: architectureDecision.startsWith('ADRあり') || architectureDecision.startsWith('ADR不要') ? 'satisfied' : 'needs_review',
      reason: architectureDecision
    },
    {
      id: 'spec',
      type: 'spec_gate',
      label: 'Spec Gate',
      status: fileGroups.specifications.count > 0 ? 'present' : 'implicit',
      reason: fileGroups.specifications.count > 0
        ? '仕様差分がある'
        : 'Story受け入れ基準を仕様として扱う'
    },
    {
      id: 'code',
      type: 'code_gate',
      label: 'Code Gate',
      status: fileGroups.source.count > 0 ? 'present' : 'not_required',
      files: fileGroups.source.files
    },
    requirementGate,
    ...gates,
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
    { from: 'code', to: 'gate:requirement' },
    { from: 'gate:requirement', to: 'gate:unit' },
    { from: 'gate:unit', to: 'gate:integration' },
    { from: 'gate:integration', to: 'gate:e2e' },
    { from: 'gate:e2e', to: 'pr' }
  ];

  const allNodes = [...nodes.slice(0, 4), ...acceptanceNodes, ...nodes.slice(4)];
  const requiredGates = [requirementGate, ...gates].filter((gate) => gate.required);
  const needsEvidence = requiredGates.filter((gate) => ['missing', 'needs_evidence', 'needs_setup', 'needs_review', 'contradicted', 'failed'].includes(gate.status));
  return {
    schema_version: '0.1.0',
    model: 'story-acceptance-verification-dag',
    overall_status: needsEvidence.length > 0 ? 'needs_verification' : 'ready_for_review',
    story_id: story.story_id,
    summary: {
      acceptance_criteria_count: acceptanceCriteria.length,
      required_gate_count: requiredGates.length,
      needs_evidence_count: needsEvidence.length,
      requirement_status: requirementGate.status
    },
    nodes: allNodes,
    edges
  };
}

function buildVerificationGates({ fileGroups, verificationCommands, e2eCommand, flowVerification, verificationEvidence }) {
  const unitCommand = verificationCommands.find((item) => item.kind === 'unit' || item.command.startsWith('npm test')) ?? null;
  const typecheckCommand = verificationCommands.find((item) => item.kind === 'typecheck' || /\b(type-?check|tsc)\b/.test(item.command)) ?? null;
  const e2eGateStatus = resolveE2eGateStatus(e2eCommand, flowVerification);
  const e2eReason = buildE2eGateReason(e2eCommand, flowVerification);
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
      required: fileGroups.source.count > 0,
      command: e2eCommand.command,
      reason: e2eReason,
      flow_verification: flowVerification ? summarizeFlowVerificationForGate(flowVerification) : null,
      artifact_expectation: '.vibepro/verification/<run-id>/ にPlaywright CLIのログとスクリーンショットを残す'
    }
  ].map((gate) => applyVerificationEvidence(gate, verificationEvidence));
}

function applyVerificationEvidence(gate, verificationEvidence) {
  const evidence = findVerificationEvidenceForGate(gate, verificationEvidence);
  if (!evidence) return gate;
  const status = normalizeVerificationEvidenceStatus(evidence.status);
  const artifact = evidence.artifact ?? verificationEvidence?.artifact ?? null;
  const summary = evidence.summary ?? evidence.reason ?? evidence.status ?? 'verification evidence recorded';
  return {
    ...gate,
    status,
    command: evidence.command ?? gate.command,
    reason: artifact ? `${summary}; evidence: ${artifact}` : summary,
    evidence: {
      kind: evidence.kind ?? null,
      status: evidence.status ?? null,
      summary,
      artifact,
      executed_at: evidence.executed_at ?? null
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
  return matches.find((item) => ['fail', 'failed', 'error'].includes(item.status))
    ?? matches.find((item) => ['pass', 'passed', 'success', 'ok'].includes(item.status))
    ?? matches[0];
}

function normalizeVerificationEvidenceStatus(status) {
  if (['pass', 'passed', 'success', 'ok'].includes(status)) return 'passed';
  if (['fail', 'failed', 'error'].includes(status)) return 'failed';
  if (status === 'needs_setup') return 'needs_setup';
  return 'needs_evidence';
}

function resolveE2eGateStatus(e2eCommand, flowVerification) {
  const status = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  if (status === 'pass') return 'passed';
  if (status === 'fail') return 'failed';
  if (status === 'needs_setup') return 'needs_setup';
  if (status === 'skipped') return 'needs_evidence';
  if (e2eCommand.reliable_exit === false) return 'needs_setup';
  return e2eCommand.detected ? 'needs_evidence' : 'needs_setup';
}

function buildE2eGateReason(e2eCommand, flowVerification) {
  const status = flowVerification?.verification?.status ?? flowVerification?.status ?? null;
  const runId = flowVerification?.verification?.run_id ?? flowVerification?.run_id ?? null;
  const artifact = flowVerification?.artifact ?? flowVerification?.artifacts?.flow_verification_json ?? null;
  if (status === 'pass') {
    return `Flow Verification passed${runId ? ` (${runId})` : ''}${artifact ? `: ${artifact}` : ''}`;
  }
  if (status === 'fail') {
    return `Flow Verification failed${runId ? ` (${runId})` : ''}${artifact ? `: ${artifact}` : ''}`;
  }
  if (status === 'needs_setup') {
    return `Flow Verification needs setup${runId ? ` (${runId})` : ''}: ${flowVerification?.verification?.reason ?? flowVerification?.reason ?? e2eCommand.reason}`;
  }
  if (status === 'skipped') {
    return `Flow Verification skipped${runId ? ` (${runId})` : ''}; runnable non-mutating probes are required for PR evidence.`;
  }
  return e2eCommand.reason;
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
  if (fileGroups.architecture_docs.count === 0) points.push('ADRなしで既存設計の範囲に収まっているか');
  if (fileGroups.source.count > 0) points.push(`主要ソース差分: ${formatFileList(fileGroups.source.files)}`);
  if (fileGroups.tests.count > 0) points.push(`テスト差分: ${formatFileList(fileGroups.tests.files)}`);
  return points;
}

function buildRisks({ git, fileGroups, latestStoryRun, gateDag, taskContext = null }) {
  const risks = [];
  const dirtyFiles = git.dirty_files.filter((file) => !isWorkspaceArtifactPath(file.path));
  if (taskContext && !taskContext.artifacts.handoff_json) {
    risks.push('Task指定はあるがhandoff.jsonが見つからない');
  }
  if (fileGroups.tests.count === 0 && fileGroups.source.count > 0) {
    risks.push('ソース差分に対するテスト差分がない');
  }
  if (dirtyFiles.length > 0) {
    risks.push(`未コミット差分が ${dirtyFiles.length} files ある`);
  }
  if (fileGroups.repo_control.count > 0) {
    risks.push('repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする');
  }
  if (latestStoryRun?.gate_status && !['pass', 'ok'].includes(latestStoryRun.gate_status)) {
    risks.push(`最新診断gateが ${latestStoryRun.gate_status}`);
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
  return risks;
}

function renderPrGateSummary(gateDag) {
  const gates = gateDag.nodes.filter((node) => node.type === 'verification_gate');
  const requirementGate = gateDag.nodes.find((node) => node.id === 'gate:requirement');
  const lines = [
    `- overall: ${gateDag.overall_status}`,
    `- acceptance criteria: ${gateDag.summary.acceptance_criteria_count}`,
    requirementGate
      ? `- ${requirementGate.label}: ${requirementGate.status} (${requirementGate.required ? 'required' : 'optional'}) - ${requirementGate.reason}`
      : null,
    ...gates.map((gate) => {
      const required = gate.required ? 'required' : 'optional';
      return `- ${gate.label}: ${gate.status} (${required}) - \`${gate.command}\``;
    })
  ].filter(Boolean);
  return lines.join('\n');
}

function renderRequirementPrSection(requirement) {
  if (!requirement) return '- Requirement Consistency未生成';
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
    sources,
    sourceRefs,
    invariants,
    gaps,
    contradictions
  ].filter(Boolean).join('\n');
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
    '- required action: 対象Gateの証跡を追加するか、`vibepro pr create --allow-needs-verification --verification-waiver <reason>` で理由付きwaiverを記録する',
    '- guardrail: 生の `gh pr create` はVibePro Gateを通らないため、PR作成経路として使わない'
  ].join('\n');
}

function collectUnresolvedRequiredGates(gateDag) {
  return (gateDag?.nodes ?? [])
    .filter((node) => node.type === 'verification_gate' || node.type === 'requirement_gate')
    .filter((node) => node.required)
    .filter((node) => ['candidate', 'missing', 'needs_evidence', 'needs_setup', 'needs_review', 'contradicted', 'failed'].includes(node.status))
    .map((node) => ({
      id: node.id,
      label: node.label,
      status: node.status,
      command: node.command,
      reason: node.reason
    }));
}

function formatUnresolvedGateList(gates) {
  if (!gates || gates.length === 0) return 'none';
  return gates
    .map((gate) => `${gate.label ?? gate.id}:${gate.status}`)
    .join(', ');
}

function buildGateOverride(gateDag, options) {
  if (!gateDag || gateDag.overall_status === 'ready_for_review') return null;
  if (!options.allowNeedsVerification) return null;
  return {
    allowed: true,
    reason: options.verificationWaiver,
    unresolved_gates: collectUnresolvedRequiredGates(gateDag),
    overall_status: gateDag.overall_status,
    recorded_at: new Date().toISOString()
  };
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
  return `${preparation.story.story_id} ${preparation.story.title}`;
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
  await writeFile(reportPath, renderPrCreateHtml(execution));

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

function resolveStory(config, storyId, options = {}) {
  const stories = normalizeActiveStories(config.brainbase?.stories);
  const targetStoryId = storyId ?? config.brainbase?.current_story_id ?? null;
  const story = targetStoryId
    ? stories.find((item) => item.story_id === targetStoryId)
    : stories[0];
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

async function git(repoRoot, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  return stdout.trim();
}
