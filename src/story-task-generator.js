import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export async function createStoryTasks(repoRoot, { story, evidence, runId, gateStatus }) {
  const root = path.resolve(repoRoot);
  const tasksDir = path.join(getWorkspaceDir(root), 'stories', story.story_id, 'tasks');

  const taskState = buildStoryTaskState({ story, evidence, runId, gateStatus });
  const canonicalTasksJsonPath = path.join(tasksDir, 'tasks.json');
  const existingTaskState = await readTaskStateIfExists(canonicalTasksJsonPath);
  const outputDir = shouldPreserveCanonicalTasks(existingTaskState)
    ? path.join(getWorkspaceDir(root), 'stories', story.story_id, 'diagnostics', safeRunId(runId))
    : tasksDir;
  await mkdir(outputDir, { recursive: true });

  const tasksJsonPath = path.join(outputDir, 'tasks.json');
  const tasksMarkdownPath = path.join(outputDir, 'tasks.md');

  await writeFile(tasksJsonPath, `${JSON.stringify(taskState, null, 2)}\n`);
  await writeFile(tasksMarkdownPath, renderStoryTasks(taskState));

  return {
    taskState,
    artifacts: {
      story_tasks_json: toWorkspaceRelative(root, tasksJsonPath),
      story_tasks_markdown: toWorkspaceRelative(root, tasksMarkdownPath)
    }
  };
}

async function readTaskStateIfExists(tasksJsonPath) {
  try {
    return JSON.parse(await readFile(tasksJsonPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function shouldPreserveCanonicalTasks(taskState) {
  if (!taskState) return false;
  if (taskState.source_run?.run_id === 'story-plan') return true;
  return (taskState.tasks ?? []).some((task) => task.source_type === 'story_plan_candidate');
}

function safeRunId(runId) {
  return String(runId ?? 'diagnosis-run').replace(/[\\/]/g, '_');
}

export async function readStoryTasks(repoRoot, artifactPath) {
  if (!artifactPath) return emptyStoryTaskState();
  try {
    return JSON.parse(await readFile(path.resolve(repoRoot, artifactPath), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStoryTaskState();
    throw error;
  }
}

export function buildStoryTaskState({ story, evidence, runId, gateStatus }) {
  const actionCandidates = Array.isArray(evidence.action_candidates) ? evidence.action_candidates : [];
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
  const actionFindingIds = new Set(actionCandidates.map((candidate) => candidate.finding_id));
  const tasks = [
    ...findings
      .filter((finding) => !actionFindingIds.has(finding.id))
      .filter((finding) => shouldCreateFindingTask(finding))
      .flatMap((finding) => buildFindingTasks({ finding, evidence })),
    ...actionCandidates.map((candidate) => buildActionTask(candidate))
  ]
    .sort(compareTasks)
    .map((task, index) => ({
      ...task,
      order: task.order ?? ((index + 1) * 10)
    }));

  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    story,
    source_run: {
      run_id: runId,
      gate_status: gateStatus ?? evidence.gates?.[0]?.status ?? 'unknown'
    },
    tasks
  };
}

export function renderStoryTasks(taskState) {
  const tasks = Array.isArray(taskState.tasks) ? taskState.tasks : [];
  return `# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | ${taskState.story?.title ?? '-'} |
| Story ID | ${taskState.story?.story_id ?? '-'} |
| Run ID | ${taskState.source_run?.run_id ?? '-'} |
| Gate | ${taskState.source_run?.gate_status ?? '-'} |
| タスク数 | ${tasks.length} |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
${tasks.length === 0 ? '| - | - | - | - | - | - |' : tasks.map((task) => `| ${task.id} | ${task.finding_id ?? '-'} | ${task.priority} | ${task.target_count ?? task.target_files.length}件 | ${task.recommended_strategy?.id ?? '-'} | ${task.status} |`).join('\n')}

${tasks.map(renderTaskDetail).join('\n\n')}`;
}

function renderTaskDetail(task) {
  return `## ${task.id}: ${task.title}

- Source: ${task.source_type} / ${task.source_id}
- Execution: ${task.execution_policy} / mutates_repository=${task.mutates_repository}
- Target files: ${task.target_files.length === 0 ? '-' : task.target_files.join(', ')}
- Target groups: ${formatTargetGroups(task.target_groups)}
- Read first: ${task.read_first_files.length === 0 ? '-' : task.read_first_files.map((item) => item.file).join(', ')}
- Recommended strategy: ${task.recommended_strategy?.id ?? '-'}

完了条件:
${task.acceptance_criteria.length === 0 ? '- 診断結果を確認する' : task.acceptance_criteria.map((item) => `- ${item}`).join('\n')}`;
}

function buildActionTask(candidate) {
  const plan = candidate.implementation_plan ?? {};
  const targetRoutes = plan.pre_fix_briefing?.target_routes ?? [];
  const targetFiles = uniqueFiles(targetRoutes.length > 0
    ? targetRoutes.map((route) => route.file)
    : [
        ...(candidate.target_files ?? []),
        ...(candidate.route_examples ?? []).map((route) => route.file)
      ]);
  const targetGroups = buildTargetGroups({ targetRoutes, candidate, plan });
  return {
    id: candidate.id.replace('VP-ACTION-', 'VP-TASK-'),
    source_type: 'action_candidate',
    source_id: candidate.id,
    finding_id: candidate.finding_id,
    title: candidate.title,
    priority: normalizePriority(plan.priority ?? severityToPriority(candidate.severity)),
    status: 'todo',
    order: resolveActionOrder(candidate),
    execution_policy: candidate.execution_policy ?? 'proposal_only',
    mutates_repository: Boolean(candidate.mutates_repository),
    target_count: targetRoutes.length > 0 ? targetRoutes.length : candidate.target_count ?? targetFiles.length,
    target_files: targetFiles,
    target_routes: targetRoutes,
    target_groups: targetGroups,
    read_first_files: plan.read_first_files ?? [],
    recommended_strategy: plan.pre_fix_briefing?.recommended_strategy ?? null,
    implementation_steps: plan.steps ?? [],
    acceptance_criteria: plan.acceptance_criteria ?? [],
    graph_context: candidate.graph_context ?? null,
    pre_fix_briefing: plan.pre_fix_briefing ?? null
  };
}

function buildFindingTasks({ finding, evidence }) {
  if (finding.id === 'VP-STATIC-002') {
    return buildSecretFindingTasks({ finding, evidence });
  }
  return [buildFindingTask({
    finding,
    targetFiles: resolveFindingTargetFiles(finding, evidence),
    priority: severityToPriority(finding.severity),
    order: resolveFindingOrder(finding),
    gateEffect: null
  })];
}

function buildSecretFindingTasks({ finding, evidence }) {
  const blockFiles = resolveSecretTargetFiles(evidence, 'block');
  const reviewFiles = resolveSecretTargetFiles(evidence, 'review');
  return [
    blockFiles.length > 0 ? buildFindingTask({
      finding,
      id: 'VP-TASK-STATIC-002-BLOCK',
      title: `${finding.title}（即時対応）`,
      targetFiles: blockFiles,
      priority: 'critical',
      order: 10,
      gateEffect: 'block'
    }) : null,
    reviewFiles.length > 0 ? buildFindingTask({
      finding,
      id: 'VP-TASK-STATIC-002-REVIEW',
      title: `${finding.title}（要確認）`,
      targetFiles: reviewFiles,
      priority: 'high',
      order: 15,
      gateEffect: 'review'
    }) : null
  ].filter(Boolean);
}

function buildFindingTask({ finding, id = null, title = null, targetFiles = [], priority, order, gateEffect }) {
  return {
    id: id ?? finding.id.replace('VP-', 'VP-TASK-'),
    source_type: 'finding',
    source_id: finding.id,
    finding_id: finding.id,
    title: title ?? finding.title,
    priority,
    status: 'todo',
    order,
    gate_effect: gateEffect,
    execution_policy: 'proposal_only',
    mutates_repository: false,
    target_count: targetFiles.length,
    target_files: targetFiles,
    target_routes: [],
    target_groups: [],
    read_first_files: targetFiles.map((file) => ({
      file,
      reason: `検出事項 ${finding.id} の確認対象`
    })),
    recommended_strategy: {
      id: 'manual-review',
      reason: finding.recommendation
    },
    implementation_steps: [{
      id: 'review-finding',
      title: '検出内容を確認する',
      detail: finding.detail
    }],
    acceptance_criteria: [finding.recommendation],
    graph_context: finding.graph_context ?? null,
    pre_fix_briefing: null
  };
}

function shouldCreateFindingTask(finding) {
  return ['Critical', 'High'].includes(finding.severity);
}

function resolveFindingTargetFiles(finding, evidence) {
  if (finding.id === 'VP-STATIC-002') {
    return uniqueFiles([
      ...resolveSecretTargetFiles(evidence, 'block'),
      ...resolveSecretTargetFiles(evidence, 'review')
    ]);
  }
  if (finding.id === 'VP-STATIC-003') {
    return uniqueFiles((evidence.static_site?.xss_risk_hits ?? [])
      .filter((hit) => hit.gate_effect !== 'info')
      .map((hit) => hit.file));
  }
  if (finding.id === 'VP-SEC-004') {
    return uniqueFiles((evidence.code_quality?.authorization_order_risks ?? [])
      .filter((hit) => hit.gate_effect !== 'info')
      .map((hit) => hit.file));
  }
  if (finding.id === 'VP-DRY-001') {
    return uniqueFiles((evidence.code_quality?.duplicate_query_shapes ?? [])
      .filter((hit) => hit.gate_effect !== 'info')
      .flatMap((hit) => hit.files ?? []));
  }
  if (finding.id === 'VP-ARCH-001') {
    return uniqueFiles((evidence.code_quality?.responsibility_hotspots ?? [])
      .filter((hit) => hit.gate_effect !== 'info')
      .map((hit) => hit.file));
  }
  return [];
}

function resolveSecretTargetFiles(evidence, gateEffect) {
  return uniqueFiles((evidence.static_site?.secret_hits ?? [])
    .filter((hit) => hit.gate_effect === gateEffect)
    .map((hit) => hit.file));
}

function buildTargetGroups({ targetRoutes, candidate, plan }) {
  if (!Array.isArray(targetRoutes) || targetRoutes.length === 0) return [];
  const groups = new Map();
  for (const route of targetRoutes) {
    const id = resolveRouteGroupId(route);
    const current = groups.get(id) ?? {
      id,
      title: resolveRouteGroupTitle(id),
      classification: route.classification ?? 'unknown',
      route_count: 0,
      target_files: [],
      routes: [],
      recommended_strategy: plan.pre_fix_briefing?.recommended_strategy ?? null,
      read_first_files: [],
      acceptance_criteria: plan.acceptance_criteria ?? []
    };
    current.route_count += 1;
    current.target_files = uniqueFiles([...current.target_files, route.file]);
    current.routes.push(route);
    groups.set(id, current);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    read_first_files: selectGroupReadFirstFiles(group, plan.read_first_files ?? [])
  }));
}

function resolveRouteGroupId(route) {
  const segments = (route.route_path ?? '')
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== 'api' && !/^\[.+\]$/.test(segment));
  if (segments[0] === 'admin') {
    return segments[1] || 'admin';
  }
  if (segments[0] === 'batch-jobs') return 'batch-jobs';
  if (segments[0] === 'companies') return 'companies';
  if (segments[0] === 'pdf-compress') return 'pdf-compress';
  if (segments[0] === 'v1' && segments[1]) return `v1-${segments[1]}`;
  if (segments[0] === 'debug') return segments.slice(0, 2).join('-');
  return segments.slice(0, 2).join('-') || route.classification || 'unknown';
}

function resolveRouteGroupTitle(id) {
  return id
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function selectGroupReadFirstFiles(group, readFirstFiles) {
  const files = new Set(group.target_files);
  return (readFirstFiles ?? []).filter((item) => files.has(item.file));
}

function formatTargetGroups(groups = []) {
  if (!Array.isArray(groups) || groups.length === 0) return '-';
  return groups.map((group) => `${group.id}(${group.route_count})`).join(', ');
}

function compareTasks(a, b) {
  return resolveTaskSort(a) - resolveTaskSort(b) || a.id.localeCompare(b.id);
}

function resolveTaskSort(task) {
  if (task.order != null) return task.order;
  const priorityOrder = { critical: 10, high: 50, medium: 80, low: 100 };
  return priorityOrder[task.priority] ?? 100;
}

function resolveFindingOrder(finding) {
  if (finding.id === 'VP-STATIC-002') return 10;
  if (finding.severity === 'Critical') return 10;
  if (finding.severity === 'High') return 50;
  return 100;
}

function resolveActionOrder(candidate) {
  if (candidate.id === 'VP-ACTION-API-002') return 20;
  if (candidate.id === 'VP-ACTION-API-003') return 30;
  if (candidate.id === 'VP-ACTION-API-001') return 40;
  if (candidate.id === 'VP-ACTION-DRY-001') return 60;
  if (candidate.id === 'VP-ACTION-ARCH-001') return 70;
  return 60;
}

function severityToPriority(severity) {
  const values = {
    Critical: 'critical',
    High: 'high',
    Medium: 'medium',
    Low: 'low'
  };
  return values[severity] ?? 'medium';
}

function normalizePriority(priority) {
  if (priority === 'critical') return 'critical';
  if (priority === 'high') return 'high';
  if (priority === 'medium') return 'medium';
  if (priority === 'low') return 'low';
  return 'medium';
}

function uniqueFiles(files) {
  return [...new Set((files ?? []).filter(Boolean))];
}

function emptyStoryTaskState() {
  return {
    schema_version: '0.1.0',
    generated_at: null,
    story: null,
    source_run: null,
    tasks: []
  };
}
