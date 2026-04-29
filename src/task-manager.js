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
  const context = await loadTaskContext(root, options.storyId);
  const task = findTask(context.tasks, options.taskId);
  const group = options.groupId ? findTargetGroup(task, options.groupId) : null;
  const briefing = buildTaskBriefing({
    story: context.story,
    sourceRun: context.taskState.source_run,
    task,
    group
  });
  const briefDir = group
    ? path.join(getWorkspaceDir(root), 'stories', context.story.story_id, 'tasks', safeSegment(task.id), 'groups', safeSegment(group.id))
    : path.join(getWorkspaceDir(root), 'stories', context.story.story_id, 'tasks', safeSegment(task.id));
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

function safeSegment(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid path segment: ${value}`);
  }
  return value;
}
