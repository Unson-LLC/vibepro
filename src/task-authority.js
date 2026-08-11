import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveArtifactRoute } from './artifact-routing.js';
import { toWorkspaceRelative } from './workspace.js';

export async function readTaskAuthorities(repoRoot, storyId, storySource = null) {
  const humanPath = storySource?.path
    ? path.join(repoRoot, path.dirname(storySource.path), '06_tasks.md')
    : null;
  const human = humanPath
    ? await readHumanTaskAuthority(repoRoot, humanPath)
    : emptyAuthority('human_authored');

  const route = await resolveArtifactRoute(repoRoot, 'task_plan', { storyId });
  const generated = await readGeneratedTaskAuthority(repoRoot, route.canonical.absolute_path);
  return { human, generated };
}

async function readHumanTaskAuthority(repoRoot, filePath) {
  let content = null;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyAuthority('human_authored');
    throw error;
  }
  const tasks = parseHumanTaskTable(content);
  return {
    authority: 'human_authored',
    path: toWorkspaceRelative(repoRoot, filePath),
    present: true,
    task_count: tasks.length,
    status_counts: countStatuses(tasks),
    tasks
  };
}

async function readGeneratedTaskAuthority(repoRoot, filePath) {
  let content = null;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return emptyAuthority('generated_proposal');
    throw error;
  }
  const tasks = content.trimStart().startsWith('{')
    ? parseGeneratedJson(content)
    : parseTaskTable(content).map((task) => ({
        id: task.id,
        status: task.status,
        execution_policy: task.execution_policy ?? null,
        mutates_repository: task.mutates_repository ?? null
      }));
  return {
    authority: 'generated_proposal',
    path: toWorkspaceRelative(repoRoot, filePath),
    present: true,
    task_count: tasks.length,
    status_counts: countStatuses(tasks),
    execution_policies: unique(tasks.map((task) => task.execution_policy).filter(Boolean)),
    mutates_repository: unique(tasks.map((task) => task.mutates_repository).filter((value) => value !== null)),
    tasks
  };
}

function parseGeneratedJson(content) {
  const document = JSON.parse(content);
  return (document.tasks ?? []).map((task) => ({
    id: task.id ?? null,
    status: task.status ?? 'unknown',
    execution_policy: task.execution_policy ?? null,
    mutates_repository: typeof task.mutates_repository === 'boolean' ? task.mutates_repository : null
  }));
}

function parseHumanTaskTable(content) {
  return parseTaskTable(content).map(({ id, status }) => ({ id, status }));
}

function parseTaskTable(content) {
  const rows = String(content ?? '').split(/\r?\n/)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 2);
  const headerIndex = rows.findIndex((cells) => (
    /^(task|id|タスク)$/i.test(cells[0])
    && /^(status|状態)$/i.test(cells.at(-1))
  ));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((cell) => cell.toLowerCase());
  const statusIndex = headers.length - 1;
  const policyIndex = headers.findIndex((header) => header === 'execution_policy');
  const mutatesIndex = headers.findIndex((header) => header === 'mutates_repository');
  return rows.slice(headerIndex + 1)
    .filter((cells) => !cells.every((cell) => /^-+$/.test(cell)))
    .filter((cells) => cells[0] && cells[statusIndex])
    .map((cells) => ({
      id: cells[0],
      status: cells[statusIndex].toLowerCase(),
      execution_policy: policyIndex >= 0 ? cells[policyIndex] || null : null,
      mutates_repository: mutatesIndex >= 0 && /^(true|false)$/i.test(cells[mutatesIndex])
        ? cells[mutatesIndex].toLowerCase() === 'true'
        : null
    }));
}

function countStatuses(tasks) {
  const counts = {};
  for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
  return counts;
}

function unique(values) {
  return [...new Set(values)];
}

function emptyAuthority(authority) {
  return {
    authority,
    path: null,
    present: false,
    task_count: 0,
    status_counts: {},
    ...(authority === 'generated_proposal' ? { execution_policies: [], mutates_repository: [] } : {}),
    tasks: []
  };
}
