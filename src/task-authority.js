import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { assertArtifactWritePath, preflightArtifactProjectionWrites, preflightArtifactWrites, resolveArtifactRoute, writeArtifactProjections } from './artifact-routing.js';
import { toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);
const DOCUMENT_FIELDS = new Set(['schema_version', 'story_id', 'tasks']);
const TASK_FIELDS = new Set(['task_id', 'story_id', 'title', 'allowed_paths', 'acceptance_criteria', 'depends_on', 'status']);

export async function bindTaskAuthority(repoRoot, { storyId, inputPath }) {
  const root = path.resolve(repoRoot);
  if (!storyId) throw new Error('task bind requires --id <story-id>');
  if (!inputPath) throw new Error('task bind requires --input <tracked-json>');
  const input = await resolveTrackedInput(root, inputPath);
  const bytes = await readFile(input.absolutePath);
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`task bind input must be valid JSON: ${error.message}`);
  }
  const tasks = validateAuthorityInput(document, storyId);
  const authority = {
    schema_version: '0.1.0',
    story_id: storyId,
    authority: { status: 'accepted', scope: 'story' },
    provenance: {
      input_path: input.relativePath,
      input_sha256: createHash('sha256').update(bytes).digest('hex')
    },
    tasks
  };
  const route = await resolveArtifactRoute(root, 'task_plan', { storyId });
  const canonicalJsonPath = canonicalTaskJsonPath(root, route, storyId);
  const json = `${JSON.stringify(authority, null, 2)}\n`;
  const markdown = renderAcceptedAuthority(authority);
  await preflightArtifactWrites(root, route, {
    additionalPaths: route.canonical.relative_path.endsWith('.json')
      ? []
      : [toWorkspaceRelative(root, canonicalJsonPath)]
  });
  const markdownPath = route.canonical.relative_path.endsWith('.json')
    ? null
    : await assertArtifactWritePath(root, route.canonical.relative_path);
  await preflightArtifactProjectionWrites(root, route, route.canonical.relative_path.endsWith('.json') ? json : markdown);
  await mkdir(path.dirname(canonicalJsonPath), { recursive: true });
  await writeFile(canonicalJsonPath, json);
  if (route.canonical.relative_path.endsWith('.json')) {
    await writeArtifactProjections(root, route, json);
  } else {
    await mkdir(path.dirname(markdownPath), { recursive: true });
    await writeFile(markdownPath, markdown);
    await writeArtifactProjections(root, route, markdown);
  }
  return {
    authority,
    artifacts: {
      canonical_json: canonicalJsonPath,
      canonical_task_plan: route.canonical.absolute_path
    }
  };
}

export async function readTaskAuthorities(repoRoot, storyId, storySource = null) {
  const humanPath = storySource?.path
    ? path.join(repoRoot, path.dirname(storySource.path), '06_tasks.md')
    : null;
  const human = humanPath
    ? await readHumanTaskAuthority(repoRoot, humanPath)
    : emptyAuthority('human_authored');

  const route = await resolveArtifactRoute(repoRoot, 'task_plan', { storyId });
  const canonicalJsonPath = canonicalTaskJsonPath(repoRoot, route, storyId);
  const accepted = await readAcceptedTaskAuthority(repoRoot, canonicalJsonPath);
  const proposalPath = accepted.present
    ? await findLatestDiagnosticProposal(repoRoot, storyId)
    : route.canonical.absolute_path;
  const generated = proposalPath
    ? await readGeneratedTaskAuthority(repoRoot, proposalPath)
    : emptyAuthority('generated_proposal');
  return { human, accepted, generated };
}

export async function assertSelectedTaskAccepted(repoRoot, storyId, taskId) {
  if (!taskId) return null;
  const route = await resolveArtifactRoute(repoRoot, 'task_plan', { storyId });
  const accepted = await readAcceptedTaskAuthority(repoRoot, canonicalTaskJsonPath(repoRoot, route, storyId));
  if (!accepted.present) {
    throw new Error(`task ${taskId} is not in accepted authority for ${storyId}; run vibepro task bind ${repoRoot} --id ${storyId} --input <tracked-json>`);
  }
  const selected = accepted.tasks.find((task) => task.id === taskId);
  if (!selected) {
    throw new Error(`task ${taskId} is not in accepted authority for ${storyId}; accepted tasks: ${accepted.tasks.map((task) => task.id).join(', ') || 'none'}`);
  }
  return { accepted, selected };
}

function canonicalTaskJsonPath(repoRoot, route, storyId) {
  if (route.canonical.relative_path.endsWith('.json')) return route.canonical.absolute_path;
  return path.join(path.resolve(repoRoot), '.vibepro', 'stories', storyId, 'tasks', 'tasks.json');
}

async function resolveTrackedInput(repoRoot, inputPath) {
  const absolutePath = path.resolve(repoRoot, inputPath);
  const relativePath = toWorkspaceRelative(repoRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('task bind input must be inside the repository');
  }
  if (path.extname(relativePath).toLowerCase() !== '.json') {
    throw new Error('task bind input must be a tracked JSON file');
  }
  const resolvedRoot = await realpath(repoRoot);
  const resolvedInput = await realpath(absolutePath).catch(() => null);
  if (!resolvedInput || (resolvedInput !== resolvedRoot && !resolvedInput.startsWith(`${resolvedRoot}${path.sep}`))) {
    throw new Error('task bind input must resolve inside the repository');
  }
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relativePath], { cwd: repoRoot });
  } catch {
    throw new Error(`task bind input must be tracked by git: ${relativePath}`);
  }
  return { absolutePath, relativePath };
}

function validateAuthorityInput(document, storyId) {
  if (!document || Array.isArray(document) || typeof document !== 'object') throw new Error('task bind input must be an object');
  if (document.source_run || document.authority?.status === 'generated_proposal') throw new Error('diagnostic proposal cannot be bound as accepted authority');
  const unknownDocumentFields = Object.keys(document).filter((key) => !DOCUMENT_FIELDS.has(key));
  if (unknownDocumentFields.length > 0) throw new Error(`unknown task authority field: ${unknownDocumentFields.join(', ')}`);
  if (document.schema_version !== '0.1.0') throw new Error('task bind schema_version must be 0.1.0');
  if (document.story_id !== storyId) throw new Error(`task bind story_id must exactly match ${storyId}`);
  if (!Array.isArray(document.tasks) || document.tasks.length === 0) throw new Error('task bind requires a nonempty tasks array');
  const ids = new Set();
  return document.tasks.map((task, index) => {
    if (!task || Array.isArray(task) || typeof task !== 'object') throw new Error(`task at index ${index} must be an object`);
    const unknown = Object.keys(task).filter((key) => !TASK_FIELDS.has(key));
    if (unknown.length > 0) throw new Error(`unknown task field: ${unknown.join(', ')}`);
    if (task.source_type) throw new Error('diagnostic proposal task cannot be bound as accepted authority');
    const taskId = String(task.task_id ?? '').trim();
    if (!taskId) throw new Error(`task_id must be nonempty at index ${index}`);
    if (ids.has(taskId)) throw new Error(`duplicate task_id: ${taskId}`);
    ids.add(taskId);
    if (task.story_id !== storyId) throw new Error(`task ${taskId} story_id must exactly match ${storyId}`);
    if (!Array.isArray(task.allowed_paths) || task.allowed_paths.length === 0) throw new Error(`task ${taskId} allowed_paths must be nonempty`);
    const allowedPaths = [...new Set(task.allowed_paths.map((value) => validateAllowedPath(value, taskId)))].sort();
    return {
      task_id: taskId,
      story_id: storyId,
      ...(task.title == null ? {} : { title: String(task.title) }),
      allowed_paths: allowedPaths,
      ...(task.acceptance_criteria == null ? {} : { acceptance_criteria: validateStringArray(task.acceptance_criteria, `${taskId} acceptance_criteria`) }),
      ...(task.depends_on == null ? {} : { depends_on: validateStringArray(task.depends_on, `${taskId} depends_on`) }),
      ...(task.status == null ? {} : { status: String(task.status) })
    };
  }).sort((a, b) => a.task_id.localeCompare(b.task_id));
}

function validateAllowedPath(value, taskId) {
  const candidate = String(value ?? '').trim().replaceAll('\\', '/');
  const normalized = path.posix.normalize(candidate);
  if (!candidate || path.posix.isAbsolute(candidate) || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`task ${taskId} allowed_paths must stay inside the repository`);
  }
  return normalized;
}

function validateStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => !String(item ?? '').trim())) throw new Error(`${label} must be an array of nonempty strings`);
  return value.map((item) => String(item).trim());
}

async function readAcceptedTaskAuthority(repoRoot, filePath) {
  let document;
  try {
    document = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return emptyAuthority('accepted');
    throw error;
  }
  if (document.authority?.status !== 'accepted') return emptyAuthority('accepted');
  const tasks = (document.tasks ?? []).map((task) => ({
    id: task.task_id ?? null,
    story_id: task.story_id ?? null,
    status: task.status ?? 'accepted',
    allowed_paths: task.allowed_paths ?? [],
    acceptance_criteria: task.acceptance_criteria ?? []
  }));
  return {
    authority: 'accepted',
    path: toWorkspaceRelative(repoRoot, filePath),
    present: true,
    task_count: tasks.length,
    status_counts: countStatuses(tasks),
    provenance: document.provenance ?? null,
    tasks
  };
}

async function findLatestDiagnosticProposal(repoRoot, storyId) {
  const diagnosticsDir = path.join(repoRoot, '.vibepro', 'stories', storyId, 'diagnostics');
  let entries;
  try {
    entries = await readdir(diagnosticsDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const candidate = path.join(diagnosticsDir, entry.name, 'tasks.json');
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

function renderAcceptedAuthority(authority) {
  return `# VibePro 受理済みTask Authority\n\n- Story ID: ${authority.story_id}\n- Authority: accepted\n- Input: ${authority.provenance.input_path}\n- SHA-256: ${authority.provenance.input_sha256}\n\n| Task ID | Allowed paths | Status |\n|---|---|---|\n${authority.tasks.map((task) => `| ${task.task_id} | ${task.allowed_paths.join(', ')} | ${task.status ?? 'accepted'} |`).join('\n')}\n`;
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
