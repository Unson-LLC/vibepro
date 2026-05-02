import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { formatCounts, renderRefactoringDeltaCompact } from './refactoring-delta-reporter.js';
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

  const fileGroups = groupChangedFiles(git.changed_files);
  const scope = assessScope({
    changedFiles: git.changed_files,
    fileGroups,
    dirtyFiles: git.dirty_files,
    commits: git.commits,
    maxReviewableFiles: options.maxReviewableFiles ?? DEFAULT_MAX_REVIEWABLE_FILES
  });
  const latestStoryRun = findLatestStoryRun(manifest, story.story_id);
  const prContext = await buildPrContext(root, {
    story,
    taskContext,
    git,
    fileGroups,
    latestStoryRun
  });
  const suggestedBranch = options.branchName ?? buildBranchName(story);
  const nextCommands = buildNextCommands({
    baseRef: git.base_ref,
    currentBranch: git.current_branch,
    suggestedBranch,
    commits: git.commits,
    scope
  });
  const prBody = renderPrBody({
    story,
    taskContext,
    git,
    fileGroups,
    latestStoryRun,
    scope,
    prContext
  });
  const preparation = {
    schema_version: '0.1.0',
    story,
    created_at: new Date().toISOString(),
    workspace: {
      initialized: workspace.initialized,
      artifact_location: workspace.initialized ? 'repo' : 'temporary'
    },
    git,
    file_groups: fileGroups,
    scope,
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
  const reportPath = path.join(prDir, 'pr-prepare.md');
  const bodyPath = path.join(prDir, 'pr-body.md');
  const gateDagJsonPath = path.join(prDir, 'gate-dag.json');
  const gateDagReportPath = path.join(prDir, 'gate-dag.md');
  await writeFile(jsonPath, `${JSON.stringify(preparation, null, 2)}\n`);
  await writeFile(bodyPath, prBody);
  await writeFile(gateDagJsonPath, `${JSON.stringify(prContext.gate_dag, null, 2)}\n`);
  await writeFile(gateDagReportPath, renderGateDagReport(prContext.gate_dag));
  await writeFile(reportPath, renderPrepareReport({
    preparation,
    bodyPath: toWorkspaceRelative(root, bodyPath),
    gateDagPath: toWorkspaceRelative(root, gateDagReportPath)
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
      gate_dag_report: gateDagReportPath
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
    const needsCount = gateDag.summary?.needs_evidence_count ?? 0;
    throw new Error(
      `Pre-create gate check failed: gate_dag.overall_status === '${gateDag.overall_status}' ` +
      `(needs_evidence_count=${needsCount}). ` +
      `Provide evidence for required gates (Unit/Integration/E2E) or pass --allow-needs-verification to bypass.`
    );
  }

  const baseBranch = stripRemote(options.prBase ?? preparation.git.base_ref);
  const headBranch = options.headBranch ?? currentBranch;
  const title = options.title ?? buildPrTitle(preparation);
  const bodyFile = prepareResult.artifacts.pr_body;
  const warnings = [];
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

- report: ${toDisplayPath(result.artifacts.report)}
- pr_body: ${toDisplayPath(result.artifacts.pr_body)}
- gate_dag: ${toDisplayPath(result.artifacts.gate_dag)}
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
  const changedFiles = await getChangedFiles(repoRoot, baseRef, headRef);
  const commits = await getCommits(repoRoot, baseRef, headRef);
  const dirtyFiles = parseStatus(await gitOptional(repoRoot, ['status', '--porcelain']));
  return {
    current_branch: currentBranch || null,
    base_ref: baseRef,
    head_ref: headRef,
    changed_files: changedFiles,
    dirty_files: dirtyFiles,
    commits
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
    if (target.startsWith('docs/management/stories/')) groups.story_docs.push(file);
    else if (target.startsWith('docs/management/architecture/')) groups.architecture_docs.push(file);
    else if (target.startsWith('docs/features/specifications/')) groups.specifications.push(file);
    else if (target.startsWith('test/') || target.startsWith('tests/') || target.includes('/__tests__/') || /\.(test|spec)\.[jt]sx?$/.test(target)) groups.tests.push(file);
    else if (target.startsWith('src/')) groups.source.push(file);
    else if (target.startsWith('.vibepro/')) groups.vibepro_artifacts.push(file);
    else if (target.startsWith('.claude/') || ['AGENTS.md', 'CLAUDE.md', '.github/', 'package.json', 'package-lock.json'].some((prefix) => target === prefix || target.startsWith(prefix))) groups.repo_control.push(file);
    else groups.other.push(file);
  }

  return Object.fromEntries(
    Object.entries(groups).map(([key, value]) => [key, {
      count: value.length,
      files: value.map((file) => file.path)
    }])
  );
}

function assessScope({ changedFiles, fileGroups, dirtyFiles, commits, maxReviewableFiles }) {
  const reasons = [];
  if (changedFiles.length > maxReviewableFiles) {
    reasons.push(`差分が ${changedFiles.length} files あり、レビュー可能な目安 ${maxReviewableFiles} files を超えている`);
  }
  if (fileGroups.repo_control.count > 0) {
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

function buildNextCommands({ baseRef, currentBranch, suggestedBranch, commits, scope }) {
  if (scope.recommended_strategy === 'current_branch_pr') {
    return [
      `gh pr create --base ${stripRemote(baseRef)} --head ${currentBranch ?? '<current-branch>'} --fill`
    ];
  }

  const firstCommit = commits[0]?.sha ?? '<commit-sha>';
  return [
    `git switch -c ${suggestedBranch} ${baseRef}`,
    commits.length === 1
      ? `git cherry-pick ${firstCommit}`
      : `git cherry-pick <story-related-commit-sha>`,
    `gh pr create --base ${stripRemote(baseRef)} --head ${suggestedBranch} --body-file .vibepro/pr/<story-id>/pr-body.md`
  ];
}

function renderPrepareReport({ preparation, bodyPath, gateDagPath }) {
  const groups = Object.entries(preparation.file_groups)
    .filter(([, value]) => value.count > 0)
    .map(([key, value]) => `| ${key} | ${value.count} | ${value.files.slice(0, 8).join('<br>')}${value.files.length > 8 ? '<br>...' : ''} |`)
    .join('\n');
  const reasons = preparation.scope.reasons.length === 0
    ? '- なし'
    : preparation.scope.reasons.map((reason) => `- ${reason}`).join('\n');
  return `# VibePro PR Prepare

## Story

| 項目 | 内容 |
|------|------|
| Story ID | ${preparation.story.story_id} |
| Story | ${preparation.story.title} |
| View | ${preparation.story.view ?? '-'} |
| Period | ${preparation.story.period ?? '-'} |

## Git

| 項目 | 内容 |
|------|------|
| Base | ${preparation.git.base_ref} |
| Head | ${preparation.git.head_ref} |
| Current branch | ${preparation.git.current_branch ?? '-'} |
| Changed files | ${preparation.git.changed_files.length} |
| Commits | ${preparation.git.commits.length} |
| Dirty files | ${preparation.git.dirty_files.length} |
| Workspace | ${preparation.workspace.initialized ? 'initialized' : 'temporary artifacts'} |

## Scope判定

| 項目 | 内容 |
|------|------|
| Status | ${preparation.scope.status} |
| Recommended strategy | ${preparation.scope.recommended_strategy} |

### 理由

${reasons}

## 差分グループ

| Group | Count | Files |
|-------|-------|-------|
${groups || '| - | 0 | - |'}

## Commit

${preparation.git.commits.length === 0 ? '- なし' : preparation.git.commits.map((commit) => `- ${commit.sha} ${commit.message}`).join('\n')}

## Task / Handoff

${renderTaskContextReport(preparation.task_context)}

## PR本文ドラフト

- ${bodyPath}

## Gate DAG

- ${gateDagPath}
- overall: ${preparation.pr_context.gate_dag.overall_status}
- required gates: ${preparation.pr_context.gate_dag.summary.required_gate_count}
- gates needing evidence: ${preparation.pr_context.gate_dag.summary.needs_evidence_count}

## リファクタリング差分

${renderRefactoringDeltaCompact(preparation.pr_context.refactoring_delta)}

## 次コマンド

${preparation.next_commands.map((command) => `- \`${command}\``).join('\n')}
`;
}

function renderTaskContextReport(taskContext) {
  if (!taskContext) return '- task指定なし';
  return `| 項目 | 内容 |
|------|------|
| Task ID | ${taskContext.task.id} |
| Task | ${taskContext.task.title} |
| Priority | ${taskContext.task.priority ?? '-'} |
| Source | ${taskContext.task.source_type ?? '-'} |
| Handoff | ${taskContext.artifacts.handoff_json ?? '-'} |
| Plan | ${taskContext.artifacts.plan_json ?? '-'} |
| Briefing | ${taskContext.artifacts.briefing_json ?? '-'} |`;
}

function renderPrBody({ story, taskContext, git, fileGroups, latestStoryRun, scope, prContext }) {
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
  const taskSection = renderPrTaskSection(taskContext);
  const refactoringDeltaSection = renderPrRefactoringDelta(prContext.refactoring_delta);

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

## Gate DAG
${gateSummary}

${refactoringDeltaSection}

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

function formatPrDeltaStatus(status) {
  return {
    improved: '改善',
    removed: '解消',
    regressed: '悪化',
    new: '新規',
    unchanged: '変化なし'
  }[status] ?? status;
}

async function buildPrContext(repoRoot, { story, taskContext, git, fileGroups, latestStoryRun }) {
  const storyDocs = await readStoryDocs(repoRoot, fileGroups.story_docs.files);
  const primaryStory = pickPrimaryStory(storyDocs, story);
  const architectureDecision = resolveArchitectureDecision(primaryStory, fileGroups);
  const verificationCommands = buildVerificationCommands(fileGroups);
  const e2eCommand = await detectPlaywrightCommand(repoRoot);
  const latestEvidence = await readRunEvidenceIfExists(repoRoot, latestStoryRun);
  const context = {
    story_source: primaryStory,
    architecture_decision: architectureDecision,
    change_summary: buildChangeSummary(fileGroups),
    verification_commands: verificationCommands,
    review_points: buildReviewPoints(fileGroups, taskContext),
    refactoring_delta: latestEvidence?.refactoring_delta ?? null,
    risks: []
  };
  context.gate_dag = buildGateDag({
    story,
    storySource: primaryStory,
    architectureDecision,
    fileGroups,
    verificationCommands,
    e2eCommand
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
    title,
    requirement_id: frontmatter.id ?? frontmatter.requirement_id ?? null,
    requirement_title: frontmatter.requirement_title ?? frontmatter.title ?? title,
    requirement_url: frontmatter.url ?? null,
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
  for (const line of match[1].split('\n')) {
    const item = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/);
    if (!item) continue;
    result[item[1]] = item[2].replace(/^['"]|['"]$/g, '');
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
  return storyDocs.find((doc) => doc.path.includes(story.story_id))
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

function buildVerificationCommands(fileGroups) {
  const commands = [];
  if (fileGroups.tests.count > 0) {
    const testFiles = fileGroups.tests.files
      .filter((file) => /\.(test|spec)\.[jt]sx?$/.test(file))
      .slice(0, 6);
    if (testFiles.length > 0) {
      commands.push({
        command: `npm test -- --runTestsByPath ${testFiles.join(' ')} --runInBand`,
        reason: '変更に対応する対象テスト'
      });
    } else {
      commands.push({
        command: 'npm test',
        reason: 'テスト差分があるため'
      });
    }
  }
  if (fileGroups.source.count > 0) {
    commands.push({
      command: 'npm run typecheck',
      reason: 'TypeScript/型境界の確認'
    });
  }
  return commands;
}

function buildGateDag({ story, storySource, architectureDecision, fileGroups, verificationCommands, e2eCommand }) {
  const acceptanceCriteria = storySource.acceptance_criteria.length > 0
    ? storySource.acceptance_criteria
    : ['Storyの受け入れ基準を明文化する'];
  const gates = buildVerificationGates({ fileGroups, verificationCommands, e2eCommand });
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
      { from: node.id, to: 'gate:unit' },
      { from: node.id, to: 'gate:integration' },
      { from: node.id, to: 'gate:e2e' }
    ]),
    { from: 'code', to: 'gate:unit' },
    { from: 'gate:unit', to: 'gate:integration' },
    { from: 'gate:integration', to: 'gate:e2e' },
    { from: 'gate:e2e', to: 'pr' }
  ];

  const allNodes = [...nodes.slice(0, 4), ...acceptanceNodes, ...nodes.slice(4)];
  const requiredGates = gates.filter((gate) => gate.required);
  const needsEvidence = requiredGates.filter((gate) => ['missing', 'needs_evidence', 'needs_setup'].includes(gate.status));
  return {
    schema_version: '0.1.0',
    model: 'story-acceptance-verification-dag',
    overall_status: needsEvidence.length > 0 ? 'needs_verification' : 'ready_for_review',
    story_id: story.story_id,
    summary: {
      acceptance_criteria_count: acceptanceCriteria.length,
      required_gate_count: requiredGates.length,
      needs_evidence_count: needsEvidence.length
    },
    nodes: allNodes,
    edges
  };
}

function buildVerificationGates({ fileGroups, verificationCommands, e2eCommand }) {
  const unitCommand = verificationCommands.find((item) => item.command.startsWith('npm test')) ?? null;
  const typecheckCommand = verificationCommands.find((item) => item.command === 'npm run typecheck') ?? null;
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
      status: e2eCommand.detected ? 'needs_evidence' : 'needs_setup',
      required: fileGroups.source.count > 0,
      command: e2eCommand.command,
      reason: e2eCommand.reason,
      artifact_expectation: '.vibepro/verification/<run-id>/ にPlaywright CLIのログとスクリーンショットを残す'
    }
  ];
}

async function detectPlaywrightCommand(repoRoot) {
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
  const preferredNames = ['test:e2e', 'e2e', 'test:playwright', 'playwright'];
  const preferred = preferredNames.find((name) => scripts[name]);
  if (preferred) {
    return {
      detected: true,
      command: `npm run ${preferred}`,
      reason: `package.json の ${preferred} scriptでPlaywright E2Eを実行する`
    };
  }

  const scriptEntry = Object.entries(scripts).find(([, command]) => /\bplaywright\b/.test(command));
  if (scriptEntry) {
    return {
      detected: true,
      command: `npm run ${scriptEntry[0]}`,
      reason: `package.json の ${scriptEntry[0]} scriptでPlaywright E2Eを実行する`
    };
  }

  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {})
  };
  if (deps['@playwright/test'] || deps.playwright) {
    return {
      detected: true,
      command: 'npx playwright test',
      reason: 'Playwright依存があるためCLIでE2Eを実行する'
    };
  }

  return {
    detected: false,
    command: 'npx playwright test',
    reason: 'Playwright scriptが未検出のため、対象フローのE2Eを追加してCLIで確認する'
  };
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
  if (taskContext && !taskContext.artifacts.handoff_json) {
    risks.push('Task指定はあるがhandoff.jsonが見つからない');
  }
  if (fileGroups.tests.count === 0 && fileGroups.source.count > 0) {
    risks.push('ソース差分に対するテスト差分がない');
  }
  if (git.dirty_files.length > 0) {
    risks.push(`未コミット差分が ${git.dirty_files.length} files ある`);
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
  return risks;
}

function renderPrGateSummary(gateDag) {
  const gates = gateDag.nodes.filter((node) => node.type === 'verification_gate');
  const lines = [
    `- overall: ${gateDag.overall_status}`,
    `- acceptance criteria: ${gateDag.summary.acceptance_criteria_count}`,
    ...gates.map((gate) => {
      const required = gate.required ? 'required' : 'optional';
      return `- ${gate.label}: ${gate.status} (${required}) - \`${gate.command}\``;
    })
  ];
  return lines.join('\n');
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
  const reportPath = path.join(prDir, 'pr-create.md');
  await writeFile(jsonPath, `${JSON.stringify(execution, null, 2)}\n`);
  await writeFile(reportPath, renderPrCreateReport(execution));

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

function renderPrCreateReport(execution) {
  const commands = execution.commands.map((command) => `- \`${command}\``).join('\n');
  const results = execution.results.length === 0
    ? '- dry-run'
    : execution.results.map((item) => [
      `- \`${item.command}\`: exit=${item.exit_code}`,
      item.stdout ? `  - stdout: ${item.stdout}` : null,
      item.stderr ? `  - stderr: ${item.stderr}` : null
    ].filter(Boolean).join('\n')).join('\n');
  const warnings = execution.warnings.length === 0
    ? '- なし'
    : execution.warnings.map((item) => `- ${item}`).join('\n');
  return `# VibePro PR Create

## Summary

| 項目 | 内容 |
|------|------|
| Story | ${execution.story.story_id} |
| Task | ${execution.task_context?.task?.id ?? '-'} |
| Base | ${execution.base} |
| Head | ${execution.head} |
| Title | ${execution.title} |
| Dry run | ${execution.dry_run} |
| PR URL | ${execution.pr_url ?? '-'} |

## Commands

${commands}

## Results

${results}

## Warnings

${warnings}
`;
}

function renderGateDagReport(gateDag) {
  const nodes = gateDag.nodes
    .map((node) => `| ${node.id} | ${node.type} | ${node.status ?? '-'} | ${node.label ?? node.reason ?? '-'} |`)
    .join('\n');
  const edges = gateDag.edges
    .map((edge) => `- ${edge.from} -> ${edge.to}`)
    .join('\n');
  return `# VibePro Gate DAG

| 項目 | 内容 |
|------|------|
| Story | ${gateDag.story_id} |
| Model | ${gateDag.model} |
| Overall | ${gateDag.overall_status} |
| Acceptance Criteria | ${gateDag.summary.acceptance_criteria_count} |
| Required Gates | ${gateDag.summary.required_gate_count} |
| Needs Evidence | ${gateDag.summary.needs_evidence_count} |

## Nodes

| ID | Type | Status | Label |
|----|------|--------|-------|
${nodes}

## Edges

${edges}
`;
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
