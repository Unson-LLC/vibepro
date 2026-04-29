import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getStoryStatus } from './story-manager.js';
import { readStoryTasks } from './story-task-generator.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export async function listTasks(repoRoot, options = {}) {
  const context = await loadTaskContext(repoRoot, options.storyId);
  return {
    story: context.story,
    source_run: context.taskState.source_run,
    tasks: context.tasks
  };
}

export async function showTask(repoRoot, options = {}) {
  const context = await loadTaskContext(repoRoot, options.storyId);
  const task = findTask(context.tasks, options.taskId);
  return {
    story: context.story,
    source_run: context.taskState.source_run,
    task
  };
}

export async function createTaskBrief(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const { context, task, group } = await resolveTaskSelection(root, options);
  const briefing = buildTaskBriefing({
    story: context.story,
    sourceRun: context.taskState.source_run,
    task,
    group
  });
  const briefDir = getTaskArtifactDir(root, context.story.story_id, task.id, group?.id);
  await mkdir(briefDir, { recursive: true });
  const jsonPath = path.join(briefDir, 'briefing.json');
  const markdownPath = path.join(briefDir, 'briefing.md');
  await writeFile(jsonPath, `${JSON.stringify(briefing, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskBriefing(briefing));
  return {
    story: context.story,
    task,
    group,
    briefing,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export async function createTaskPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const { context, task, group } = await resolveTaskSelection(root, options);
  const briefing = buildTaskBriefing({
    story: context.story,
    sourceRun: context.taskState.source_run,
    task,
    group
  });
  const plan = buildTaskPlan({ briefing });
  const planDir = getTaskArtifactDir(root, context.story.story_id, task.id, group?.id);
  await mkdir(planDir, { recursive: true });
  const jsonPath = path.join(planDir, 'plan.json');
  const markdownPath = path.join(planDir, 'plan.md');
  await writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskPlan(plan));
  return {
    story: context.story,
    task,
    group,
    plan,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export async function createTaskHandoff(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const briefingResult = await createTaskBrief(root, options);
  const planResult = await createTaskPlan(root, options);
  const handoff = buildTaskHandoff({
    briefing: briefingResult.briefing,
    plan: planResult.plan,
    briefingArtifacts: briefingResult.artifacts,
    planArtifacts: planResult.artifacts
  });
  const handoffDir = getTaskArtifactDir(root, handoff.story.story_id, handoff.task.id, handoff.group?.id);
  await mkdir(handoffDir, { recursive: true });
  const jsonPath = path.join(handoffDir, 'handoff.json');
  const markdownPath = path.join(handoffDir, 'handoff.md');
  await writeFile(jsonPath, `${JSON.stringify(handoff, null, 2)}\n`);
  await writeFile(markdownPath, renderTaskHandoff(handoff));
  return {
    story: briefingResult.story,
    task: briefingResult.task,
    group: briefingResult.group,
    handoff,
    artifacts: {
      json: toWorkspaceRelative(root, jsonPath),
      markdown: toWorkspaceRelative(root, markdownPath)
    }
  };
}

export function renderTaskList(result) {
  const tasks = Array.isArray(result.tasks) ? result.tasks : [];
  return `# Story Tasks

| 項目 | 内容 |
|------|------|
| Story ID | ${result.story?.story_id ?? '-'} |
| Story | ${result.story?.title ?? '-'} |
| Run ID | ${result.source_run?.run_id ?? '-'} |
| Gate | ${result.source_run?.gate_status ?? '-'} |
| タスク数 | ${tasks.length} |

| ID | 優先度 | 対象 | グループ | 状態 | タイトル |
|----|--------|------|----------|------|----------|
${tasks.length === 0 ? '| - | - | - | - | - | - |' : tasks.map((task) => `| ${task.id} | ${task.priority} | ${task.target_count ?? task.target_files?.length ?? 0}件 | ${formatTargetGroups(task.target_groups)} | ${task.status} | ${task.title} |`).join('\n')}
`;
}

export function renderTaskShow(result) {
  const task = result.task;
  return `# Story Task

| 項目 | 内容 |
|------|------|
| Story ID | ${result.story?.story_id ?? '-'} |
| Story | ${result.story?.title ?? '-'} |
| Run ID | ${result.source_run?.run_id ?? '-'} |
| Task ID | ${task.id} |
| Title | ${task.title} |
| Priority | ${task.priority} |
| Status | ${task.status} |
| Execution | ${task.execution_policy} / mutates_repository=${task.mutates_repository} |
| Strategy | ${task.recommended_strategy?.id ?? '-'} |

## Target Files

${formatList(task.target_files)}

## Target Routes

${formatRoutes(task.target_routes)}

## Target Groups

${formatGroups(task.target_groups)}

## Read First

${formatReadFirst(task.read_first_files)}

## Acceptance Criteria

${formatList(task.acceptance_criteria)}
`;
}

export function renderTaskBriefing(briefing) {
  return `# 修正前ブリーフィング

## 前提

- Story: ${briefing.story.title} (${briefing.story.story_id})
- Run ID: ${briefing.source_run?.run_id ?? '-'}
- Task: ${briefing.task.id} - ${briefing.task.title}
- Group: ${briefing.group?.id ?? '-'}
- Execution: ${briefing.execution_policy} / mutates_repository=${briefing.mutates_repository}

## ガードレール

${briefing.guardrails.map((item) => `- ${item}`).join('\n')}

## 対象route

${formatRoutes(briefing.target_routes)}

## 対象ファイル

${formatList(briefing.target_files)}

## 先に読むファイル

${formatReadFirst(briefing.read_first_files)}

## graphify文脈

- impact_score: ${briefing.graph_context?.impact_score ?? '-'}
- matched_route_count: ${briefing.graph_context?.matched_route_count ?? '-'}
- matched_node_count: ${briefing.graph_context?.matched_node_count ?? '-'}
- related_edge_count: ${briefing.graph_context?.related_edge_count ?? '-'}
- affected_communities: ${formatCommunities(briefing.graph_context?.affected_communities)}
- hub_nodes: ${formatHubNodes(briefing.graph_context?.hub_nodes)}

## 推奨方針

- ${briefing.recommended_strategy?.id ?? '-'}: ${briefing.recommended_strategy?.reason ?? '-'}

## 実装手順候補

${briefing.implementation_steps.length === 0 ? '- なし' : briefing.implementation_steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')}

## 完了条件

${formatList(briefing.acceptance_criteria)}
`;
}

export function renderTaskPlan(plan) {
  return `# 実装修正計画

## 前提

- Story: ${plan.story.title} (${plan.story.story_id})
- Run ID: ${plan.source_run?.run_id ?? '-'}
- Task: ${plan.task.id} - ${plan.task.title}
- Group: ${plan.group?.id ?? '-'}
- このplanは修正可能な作業計画
- CLI自身は対象リポジトリのコードを変更しない

## 実行境界

- plan_allows_repository_changes: ${plan.execution.plan_allows_repository_changes}
- cli_mutates_repository: ${plan.execution.cli_mutates_repository}

## 変更対象ファイル

${formatList(plan.target_files)}

## 先に読むファイル

${formatReadFirst(plan.read_first_files)}

## 推奨修正方針

- ${plan.recommended_strategy?.id ?? '-'}: ${plan.recommended_strategy?.reason ?? '-'}

## 実装ステップ

${plan.implementation_steps.length === 0 ? '- なし' : plan.implementation_steps.map((step, index) => `${index + 1}. ${step.title}: ${step.detail}`).join('\n')}

## 検証コマンド候補

${plan.verification_commands.map((item) => `- \`${item.command}\`: ${item.reason}`).join('\n')}

## 完了条件

${formatList(plan.acceptance_criteria)}

## ロールバック観点

${formatList(plan.rollback_considerations)}

## ガードレール

${formatList(plan.guardrails)}
`;
}

export function renderTaskHandoff(handoff) {
  return `# 実装依頼パッケージ

## 前提

- Story: ${handoff.story.title} (${handoff.story.story_id})
- Run ID: ${handoff.source_run?.run_id ?? '-'}
- Task: ${handoff.task.id} - ${handoff.task.title}
- Group: ${handoff.group?.id ?? '-'}
- VibeProは実装を実行しない
- 修正はhandoffを受けた人間/AIが行う

## 参照成果物

- briefing.json: ${handoff.references.briefing_json}
- briefing.md: ${handoff.references.briefing_markdown}
- plan.json: ${handoff.references.plan_json}
- plan.md: ${handoff.references.plan_markdown}

## plan要約

- 方針: ${handoff.plan_summary.recommended_strategy?.id ?? '-'} - ${handoff.plan_summary.recommended_strategy?.reason ?? '-'}
- 変更対象: ${handoff.plan_summary.target_file_count}ファイル
- 検証コマンド: ${handoff.plan_summary.verification_command_count}件

## 変更対象ファイル

${formatList(handoff.target_files)}

## 対象route

${formatRoutesWithProtection(handoff.target_routes)}

## 現在の保護判定

- route_statuses: ${formatObjectSummary(handoff.current_protection.route_statuses)}
- risk_hints: ${formatObjectSummary(handoff.current_protection.risk_hints)}

## 期待する修正後シグナル

${formatList(handoff.expected_fix_signals)}

## 実行環境前提

${formatList(handoff.environment_assumptions)}

## 先に読むファイル

${formatReadFirst(handoff.read_first_files)}

## 実装者への指示

${formatList(handoff.implementation_instructions)}

## 禁止事項

${formatList(handoff.prohibited_actions)}

## 検証コマンド

${handoff.verification_commands.map((item) => `- \`${item.command}\`: ${item.reason}`).join('\n')}

## 完了報告テンプレート

${handoff.completion_report_template.map((item) => `- ${item}`).join('\n')}
`;
}

async function loadTaskContext(repoRoot, storyId = null) {
  const root = path.resolve(repoRoot);
  const status = await getStoryStatus(root, storyId);
  const taskState = await readStoryTasks(root, status.artifacts?.story_tasks_json);
  const tasks = Array.isArray(taskState.tasks) ? taskState.tasks : [];
  return {
    story: status.story,
    latestRun: status.latestRun,
    taskState,
    tasks
  };
}

async function resolveTaskSelection(repoRoot, options = {}) {
  const context = await loadTaskContext(repoRoot, options.storyId);
  const task = findTask(context.tasks, options.taskId);
  const group = options.groupId ? findTargetGroup(task, options.groupId) : null;
  return { context, task, group };
}

function buildTaskBriefing({ story, sourceRun, task, group }) {
  const targetRoutes = group ? group.routes ?? [] : task.target_routes ?? [];
  const targetFiles = group ? group.target_files ?? [] : task.target_files ?? [];
  const readFirstFiles = resolveBriefReadFirstFiles({ targetFiles, group, task });
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'pre_fix_briefing',
    story,
    source_run: sourceRun,
    task: {
      id: task.id,
      title: task.title,
      priority: task.priority,
      finding_id: task.finding_id,
      source_type: task.source_type,
      source_id: task.source_id
    },
    group: group ? {
      id: group.id,
      title: group.title,
      route_count: group.route_count,
      classification: group.classification
    } : null,
    execution_policy: task.execution_policy,
    mutates_repository: false,
    guardrails: [
      'このCLIは対象リポジトリのコードを修正しない',
      '修正に入る前の作業指示と確認対象だけを生成する',
      '実装時は対象route、対象ファイル、完了条件を再確認する'
    ],
    target_routes: targetRoutes,
    target_files: targetFiles,
    read_first_files: readFirstFiles,
    graph_context: task.graph_context ?? null,
    pre_fix_briefing: task.pre_fix_briefing ?? null,
    recommended_strategy: group?.recommended_strategy ?? task.recommended_strategy ?? null,
    implementation_steps: task.implementation_steps ?? [],
    acceptance_criteria: group?.acceptance_criteria ?? task.acceptance_criteria ?? []
  };
}

function buildTaskPlan({ briefing }) {
  const suffix = briefing.group?.id ? `${briefing.task.id}-${briefing.group.id}` : briefing.task.id;
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'implementation_plan',
    story: briefing.story,
    source_run: briefing.source_run,
    task: briefing.task,
    group: briefing.group,
    execution: {
      plan_allows_repository_changes: true,
      cli_mutates_repository: false,
      note: 'このplanは修正可能な作業計画。ただしCLI自身は対象リポジトリのコードを変更しない。'
    },
    target_routes: briefing.target_routes,
    target_files: briefing.target_files,
    read_first_files: briefing.read_first_files,
    recommended_strategy: briefing.recommended_strategy,
    implementation_steps: briefing.implementation_steps,
    verification_commands: buildVerificationCommands(suffix),
    acceptance_criteria: briefing.acceptance_criteria,
    rollback_considerations: [
      '対象ファイル単位で差分を確認し、対象グループ外の変更が混ざっていないか確認する',
      '認証境界を変更する場合は、public API と webhook API を巻き込んでいないか確認する',
      '診断再実行後に新しいCritical/Highが増えた場合は、変更を戻せる粒度でコミットを分ける'
    ],
    guardrails: [
      'このplanは修正可能な作業計画',
      'CLI自身は対象リポジトリのコードを変更しない',
      '実装修正は人間またはAIエージェントが別操作として行う',
      '修正後はVibePro診断を再実行して完了条件を確認する'
    ],
    source_briefing: {
      mode: briefing.mode,
      generated_at: briefing.generated_at
    }
  };
}

function buildTaskHandoff({ briefing, plan, briefingArtifacts, planArtifacts }) {
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'implementation_handoff',
    story: plan.story,
    source_run: plan.source_run,
    task: plan.task,
    group: plan.group,
    execution: {
      vibepro_mutates_repository: false,
      recipient_may_mutate_repository: true,
      note: 'VibeProは実装を実行しない。修正はhandoffを受けた人間/AIが行う。'
    },
    references: {
      briefing_json: briefingArtifacts.json,
      briefing_markdown: briefingArtifacts.markdown,
      plan_json: planArtifacts.json,
      plan_markdown: planArtifacts.markdown
    },
    plan_summary: {
      recommended_strategy: plan.recommended_strategy,
      target_file_count: plan.target_files.length,
      verification_command_count: plan.verification_commands.length,
      acceptance_criteria_count: plan.acceptance_criteria.length
    },
    target_routes: plan.target_routes,
    target_files: plan.target_files,
    read_first_files: plan.read_first_files,
    current_protection: summarizeCurrentProtection(plan.target_routes),
    expected_fix_signals: [
      '対象routeのprotection_statusがprotected_by_routeまたはprotected_by_middlewareになる',
      '対象routeからprivileged_route_unprotectedが消える',
      'VibePro診断で対象タスクの完了条件を満たす'
    ],
    environment_assumptions: [
      '対象リポジトリのルートで実行する',
      'VibePro CLIがPATHにない場合は npx vibepro を使う',
      'npm test と npm run lint は対象リポジトリのpackage.jsonに定義されている場合に実行する'
    ],
    implementation_instructions: buildImplementationInstructions({ briefing, plan, planArtifacts }),
    prohibited_actions: [
      '対象グループ外のファイルを同じ作業で変更しない',
      'VibeProの生成物を根拠なく手編集しない',
      'public API と webhook API を巻き込む認証境界変更を行わない',
      '検証コマンドを省略したまま完了扱いにしない'
    ],
    verification_commands: plan.verification_commands,
    completion_report_template: [
      '変更したファイル',
      '採用した修正方針',
      '実行した検証コマンドと結果',
      '未解決のリスクまたは次に見るべき点'
    ],
    guardrails: [
      'VibeProは実装を実行しない',
      '修正はhandoffを受けた人間/AIが行う',
      'handoffは実装前の依頼パッケージであり、対象コードの変更結果ではない'
    ]
  };
}

function buildImplementationInstructions({ briefing, plan, planArtifacts }) {
  return [
    `${planArtifacts.markdown} を読み、対象ファイルと完了条件を確認する`,
    '先に読むファイルを確認し、既存の認証境界とgraphify文脈を把握する',
    `${plan.recommended_strategy?.id ?? 'recommended strategy'} 方針に沿って対象ファイルを修正する`,
    '修正後に検証コマンドを実行し、完了条件を満たすことを確認する',
    `${briefing.task.id}${briefing.group?.id ? ` / ${briefing.group.id}` : ''} の範囲だけを完了報告する`
  ];
}

function buildVerificationCommands(suffix) {
  return [
    {
      command: 'npm test',
      reason: '対象リポジトリの既存テストを確認する'
    },
    {
      command: 'npm run lint',
      reason: 'lintが定義されている場合に静的チェックを確認する'
    },
    {
      command: `npx vibepro diagnose . --run-id verify-${suffix}`,
      reason: 'VibePro診断で対象タスクの検出事項が改善したか確認する'
    }
  ];
}

function summarizeCurrentProtection(routes = []) {
  const routeStatuses = {};
  const riskHints = {};
  for (const route of routes) {
    const status = route.protection_status ?? 'unknown';
    routeStatuses[status] = (routeStatuses[status] ?? 0) + 1;
    for (const hint of route.risk_hints ?? []) {
      riskHints[hint] = (riskHints[hint] ?? 0) + 1;
    }
  }
  return {
    route_statuses: routeStatuses,
    risk_hints: riskHints,
    routes: routes.map((route) => ({
      route_path: route.route_path,
      file: route.file,
      methods: route.methods ?? [],
      protection_status: route.protection_status ?? 'unknown',
      protection_evidence: route.protection_evidence ?? [],
      risk_hints: route.risk_hints ?? []
    }))
  };
}

function resolveBriefReadFirstFiles({ targetFiles, group, task }) {
  const selected = [];
  const seen = new Set();
  const add = (item) => {
    if (!item?.file || seen.has(item.file)) return;
    seen.add(item.file);
    selected.push(item);
  };
  for (const item of group?.read_first_files ?? []) add(item);
  for (const file of targetFiles) {
    add({ file, reason: group ? `対象グループ ${group.id} の修正候補` : `対象タスク ${task.id} の修正候補` });
  }
  for (const item of task.read_first_files ?? []) {
    if (group && item.reason?.startsWith('対象API route:')) continue;
    add(item);
  }
  return selected;
}

function getTaskArtifactDir(repoRoot, storyId, taskId, groupId = null) {
  const baseDir = path.join(getWorkspaceDir(repoRoot), 'stories', safeSegment(storyId), 'tasks', safeSegment(taskId));
  return groupId ? path.join(baseDir, 'groups', safeSegment(groupId)) : baseDir;
}

function findTask(tasks, taskId) {
  if (!taskId) throw new Error('--task is required');
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  return task;
}

function findTargetGroup(task, groupId) {
  const group = (task.target_groups ?? []).find((item) => item.id === groupId);
  if (!group) throw new Error(`Target group not found: ${groupId}`);
  return group;
}

function formatTargetGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '-';
  return groups.map((group) => `${group.id}(${group.route_count})`).join(', ');
}

function formatGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '- なし';
  return groups.map((group) => `- ${group.id}: ${group.title ?? group.id} (${group.route_count}件)`).join('\n');
}

function formatRoutes(routes = []) {
  if (!Array.isArray(routes) || routes.length === 0) return '- なし';
  return routes.map((route) => `- ${route.route_path} (${route.methods?.join(', ') || '-'}) - ${route.file}`).join('\n');
}

function formatRoutesWithProtection(routes = []) {
  if (!Array.isArray(routes) || routes.length === 0) return '- なし';
  return routes.map((route) => [
    `- ${route.route_path} (${route.methods?.join(', ') || '-'}) - ${route.file}`,
    `  - protection=${route.protection_status ?? 'unknown'}, evidence=${route.protection_evidence?.join(', ') || '-'}, risk=${route.risk_hints?.join(', ') || '-'}`
  ].join('\n')).join('\n');
}

function formatReadFirst(files = []) {
  if (!Array.isArray(files) || files.length === 0) return '- なし';
  return files.map((item) => `- ${item.file}${item.reason ? `: ${item.reason}` : ''}`).join('\n');
}

function formatList(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '- なし';
  return items.map((item) => `- ${item}`).join('\n');
}

function formatCommunities(communities = []) {
  if (!Array.isArray(communities) || communities.length === 0) return '-';
  return communities.map((community) => `${community.id}(route:${community.route_count}, node:${community.node_count}, edge:${community.edge_count})`).join(', ');
}

function formatHubNodes(nodes = []) {
  if (!Array.isArray(nodes) || nodes.length === 0) return '-';
  return nodes.map((node) => node.id ?? node.label ?? '-').join(', ');
}

function formatObjectSummary(value = {}) {
  const entries = Object.entries(value);
  if (entries.length === 0) return '-';
  return entries.map(([key, count]) => `${key}:${count}`).join(', ');
}

function safeSegment(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }
  return value;
}
