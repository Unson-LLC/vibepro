import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { assertArtifactWritePath, preflightArtifactWrites, resolveArtifactRoute, writeArtifactProjections } from './artifact-routing.js';

export async function createStoryTasks(repoRoot, { story, evidence, runId, gateStatus }) {
  const root = path.resolve(repoRoot);
  const tasksDir = path.join(getWorkspaceDir(root), 'stories', story.story_id, 'tasks');

  const canonicalTasksJsonPath = path.join(tasksDir, 'tasks.json');
  const existingTaskState = await readTaskStateIfExists(canonicalTasksJsonPath);
  const taskState = buildStoryTaskState({ story, evidence, runId, gateStatus, existingTaskState });
  const outputDir = shouldPreserveCanonicalTasks(existingTaskState)
    ? path.join(getWorkspaceDir(root), 'stories', story.story_id, 'diagnostics', safeRunId(runId))
    : tasksDir;
  const tasksJsonPath = path.join(outputDir, 'tasks.json');
  const taskPlanRoute = await resolveArtifactRoute(root, 'task_plan', { storyId: story.story_id });
  const canonicalTaskPlan = taskPlanRoute.canonical.relative_path;
  if (outputDir === tasksDir) {
    await preflightArtifactWrites(root, taskPlanRoute, {
      additionalPaths: [toWorkspaceRelative(root, path.join(tasksDir, 'tasks.json'))]
    });
  }
  await mkdir(outputDir, { recursive: true });
  const tasksMarkdownPath = outputDir === tasksDir
    ? await assertArtifactWritePath(root, canonicalTaskPlan)
    : path.join(outputDir, 'tasks.md');

  await writeFile(tasksJsonPath, `${JSON.stringify(taskState, null, 2)}\n`);
  await mkdir(path.dirname(tasksMarkdownPath), { recursive: true });
  const markdown = renderStoryTasks(taskState);
  await writeFile(tasksMarkdownPath, markdown);
  if (outputDir === tasksDir) await writeArtifactProjections(root, taskPlanRoute, markdown);

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

export function buildStoryTaskState({ story, evidence, runId, gateStatus, existingTaskState = null }) {
  const actionCandidates = Array.isArray(evidence.action_candidates) ? evidence.action_candidates : [];
  const findings = Array.isArray(evidence.findings) ? evidence.findings : [];
  const actionFindingIds = new Set(actionCandidates.map((candidate) => candidate.finding_id));
  const activeTasks = [
    ...findings
      .filter((finding) => !actionFindingIds.has(finding.id))
      .filter((finding) => shouldCreateFindingTask(finding))
      .flatMap((finding) => buildFindingTasks({ finding, evidence })),
    ...actionCandidates.map((candidate) => buildActionTask(candidate))
  ];
  const tasks = applyCompletionStatus({
    activeTasks,
    existingTaskState,
    currentSourceIds: new Set([
      ...findings.map((finding) => finding.id),
      ...actionCandidates.map((candidate) => candidate.id)
    ]),
    runId
  })
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
  if (finding.id === 'VP-DB-001') {
    return buildDatabaseFindingTasks({ finding, evidence });
  }
  return [buildFindingTask({
    finding,
    targetFiles: resolveFindingTargetFiles(finding, evidence),
    priority: severityToPriority(finding.severity),
    order: resolveFindingOrder(finding),
    gateEffect: null
  })];
}

function buildDatabaseFindingTasks({ finding, evidence }) {
  const hits = (evidence.database_access?.unbounded_find_many ?? [])
    .filter((hit) => hit.gate_effect !== 'info');
  const groups = groupBy(hits, (hit) => resolveDatabaseTaskGroup(hit.file));
  return Object.values(groups).map((group, index) => {
    const targetFiles = uniqueFiles(group.hits.map((hit) => hit.file));
    return buildFindingTask({
      finding,
      id: `VP-TASK-DB-001-${group.id.toUpperCase().replace(/-/g, '_')}`,
      title: `${finding.title}（${group.title}）`,
      targetFiles,
      priority: severityToPriority(finding.severity),
      order: 55 + index,
      gateEffect: null,
      targetGroups: [{
        id: group.id,
        title: group.title,
        target_count: targetFiles.length,
        target_files: targetFiles
      }],
      recommendedStrategy: {
        id: 'add-query-boundary',
        reason: 'route/domain単位でtake/skip/cursorまたは集計API分離を入れ、挙動差分を小さくする。'
      },
      acceptanceCriteria: [
        `${group.title} の公開APIまたはユーザー操作に紐づく一覧取得に take/skip/cursor 等の上限がある。`,
        '再診断でこのgroupの未ページング候補が減っている。'
      ]
    });
  });
}

function resolveDatabaseTaskGroup(file) {
  if (file.startsWith('src/app/api/') || file.startsWith('app/api/')) {
    const apiPath = file.replace(/^src\/app\/api\//, '').replace(/^app\/api\//, '');
    const segments = apiPath.split('/').filter(Boolean);
    const first = normalizeRouteSegment(segments[0] ?? 'api');
    const second = normalizeRouteSegment(segments[1] ?? '');
    if (first === 'admin' && second) return { id: `api-admin-${second}`, title: `Admin API / ${second}` };
    if (first === 'analytics' && second) return { id: 'api-analytics', title: 'Analytics API' };
    if (first === 'v1' && second) return { id: `api-v1-${second}`, title: `v1 API / ${second}` };
    if (first === 'projects') return { id: 'api-projects', title: 'Projects API' };
    return { id: `api-${first}`, title: `API / ${first}` };
  }
  if (file.startsWith('src/lib/services/')) {
    const servicePath = file.replace(/^src\/lib\/services\//, '');
    const [first] = servicePath.split('/').filter(Boolean);
    if (first && servicePath.includes('/')) return { id: `services-${slugify(first)}`, title: `Services / ${first}` };
    return { id: 'services-core', title: 'Services / core' };
  }
  return { id: 'runtime-other', title: 'Runtime other' };
}

function normalizeRouteSegment(segment) {
  return slugify(segment.replace(/^\[(.+)\]$/, '$1'));
}

function slugify(value) {
  return String(value || 'unknown')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function groupBy(items, keyFn) {
  const groups = {};
  for (const item of items) {
    const key = keyFn(item);
    const id = typeof key === 'string' ? key : key.id;
    const title = typeof key === 'string' ? key : key.title;
    groups[id] ??= { id, title, hits: [] };
    groups[id].hits.push(item);
  }
  return groups;
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

function buildFindingTask({
  finding,
  id = null,
  title = null,
  targetFiles = [],
  priority,
  order,
  gateEffect,
  targetGroups = [],
  recommendedStrategy = null,
  acceptanceCriteria = null
}) {
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
    target_groups: targetGroups,
    read_first_files: targetFiles.map((file) => ({
      file,
      reason: `検出事項 ${finding.id} の確認対象`
    })),
    recommended_strategy: recommendedStrategy ?? {
      id: 'manual-review',
      reason: finding.recommendation
    },
    implementation_steps: [{
      id: 'review-finding',
      title: '検出内容を確認する',
      detail: finding.detail
    }],
    acceptance_criteria: acceptanceCriteria ?? [finding.recommendation],
    graph_context: finding.graph_context ?? null,
    pre_fix_briefing: null
  };
}

function applyCompletionStatus({ activeTasks, existingTaskState, currentSourceIds, runId }) {
  const activeTaskIds = new Set(activeTasks.map((task) => task.id));
  const completedTasks = (existingTaskState?.tasks ?? [])
    .filter((task) => !activeTaskIds.has(task.id))
    .filter((task) => task.source_type !== 'story_plan_candidate')
    .filter((task) => task.source_id && !currentSourceIds.has(task.source_id))
    .map((task) => ({
      ...task,
      status: 'done',
      completed_at: new Date().toISOString(),
      completion_evidence: {
        run_id: runId,
        reason: `source ${task.source_id} was not detected in the latest diagnosis`
      }
    }));
  return [...activeTasks, ...completedTasks];
}

function shouldCreateFindingTask(finding) {
  if (['VP-DB-001', 'VP-PERF-001'].includes(finding.id)) return true;
  return ['Critical', 'High'].includes(finding.severity);
}

function resolveFindingTargetFiles(finding, evidence) {
  if (Array.isArray(finding.target_files) && finding.target_files.length > 0) {
    return uniqueFiles(finding.target_files);
  }
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
  if (finding.id === 'VP-DB-001') {
    return uniqueFiles((evidence.database_access?.unbounded_find_many ?? [])
      .filter((hit) => hit.gate_effect !== 'info')
      .map((hit) => hit.file));
  }
  if (finding.id === 'VP-PERF-001') {
    return uniqueFiles((evidence.local_dev?.heavy_dev_scripts ?? [])
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
  if (finding.id === 'VP-PERF-001') return 45;
  if (finding.id === 'VP-DB-001') return 55;
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
