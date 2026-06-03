import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);
const VALID_MODES = new Set(['required', 'preferred', 'disabled']);

export async function resolveManagedWorktreeMode(repoRoot) {
  const config = await readConfig(repoRoot);
  const mode = config?.execution?.managed_worktree ?? 'disabled';
  return VALID_MODES.has(mode) ? mode : 'disabled';
}

export async function ensureManagedWorktree(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const mode = options.mode ?? await resolveManagedWorktreeMode(root);
  if (mode === 'disabled') {
    return {
      mode,
      status: 'disabled',
      required: false,
      path: null,
      branch: null,
      base_ref: options.baseRef ?? null,
      created_from_sha: null,
      current_head_sha: null,
      dirty: null,
      dirty_fingerprint: null
    };
  }

  const storyId = options.storyId;
  if (!storyId) throw new Error('managed worktree requires storyId');
  const baseRef = options.baseRef ?? 'HEAD';
  const createdFromSha = await gitOptional(root, ['rev-parse', baseRef]);
  const shortId = buildShortId(storyId, createdFromSha || baseRef);
  const worktreePath = path.resolve(options.worktreePath ?? path.join(root, '.worktrees', 'vibepro', `${storyId}-${shortId}`));
  const branch = options.branchName ?? `vibepro/${storyId}-${shortId}`;
  const existing = await findWorktree(root, worktreePath);

  if (!existing) {
    await mkdir(path.dirname(worktreePath), { recursive: true });
    await git(root, ['worktree', 'add', worktreePath, '-b', branch, baseRef]);
    await copyWorkspaceConfig(root, worktreePath);
  } else if (!isBranchMatch(existing.branch, branch)) {
    throw new Error(`managed worktree branch mismatch at ${worktreePath}: expected ${branch}, found ${existing.branch ?? 'detached'}`);
  }

  const currentHeadSha = await gitOptional(worktreePath, ['rev-parse', 'HEAD']);
  const actualBranch = await gitOptional(worktreePath, ['branch', '--show-current']);
  const dirty = await collectDirty(worktreePath);
  return {
    mode,
    status: existing ? 'reused' : 'created',
    required: mode === 'required',
    path: worktreePath,
    relative_path: toWorkspaceRelative(root, worktreePath),
    branch,
    actual_branch: actualBranch || existing?.branch || null,
    branch_match: isBranchMatch(actualBranch || existing?.branch, branch),
    base_ref: baseRef,
    created_from_sha: createdFromSha || null,
    current_head_sha: currentHeadSha || null,
    dirty: dirty.dirty,
    dirty_fingerprint: dirty.fingerprint
  };
}

export async function refreshManagedWorktree(repoRoot, managedWorktree) {
  if (!managedWorktree?.path || managedWorktree.mode === 'disabled') return managedWorktree ?? null;
  const root = path.resolve(repoRoot);
  const worktreePath = path.resolve(managedWorktree.path);
  const existing = await findWorktree(root, worktreePath);
  const currentHeadSha = await gitOptional(worktreePath, ['rev-parse', 'HEAD']);
  const actualBranch = await gitOptional(worktreePath, ['branch', '--show-current']) || existing?.branch || null;
  const dirty = await collectDirty(worktreePath);
  const exists = Boolean(currentHeadSha || existing);
  const branchMatch = isBranchMatch(actualBranch, managedWorktree.branch);
  const availableStatus = ['created', 'reused'].includes(managedWorktree.status)
    ? managedWorktree.status
    : 'available';
  return {
    ...managedWorktree,
    status: exists ? branchMatch ? availableStatus : 'branch_mismatch' : 'missing',
    actual_branch: actualBranch,
    branch_match: branchMatch,
    current_head_sha: currentHeadSha || managedWorktree.current_head_sha || null,
    dirty: dirty.dirty,
    dirty_fingerprint: dirty.fingerprint
  };
}

export function buildManagedWorktreeCommands(commands, managedWorktree) {
  if (!managedWorktree?.path || managedWorktree.mode === 'disabled') return commands;
  return Object.fromEntries(Object.entries(commands).map(([key, command]) => [
    key,
    `cd ${shellQuote(managedWorktree.path)} && ${command}`
  ]));
}

export function buildExecutionDag({ managedWorktree, completedPhases = [], completionStatus = 'not_prepared' }) {
  const hasWorktree = Boolean(managedWorktree?.path && managedWorktree.mode !== 'disabled');
  const worktreeAvailable = ['created', 'reused', 'available'].includes(managedWorktree?.status);
  const branchBound = hasWorktree && managedWorktree.branch && managedWorktree.branch_match !== false;
  const nodes = [
    {
      id: 'story_selected',
      status: 'passed',
      required: true,
      reason: 'Story id is bound to this execution state'
    },
    {
      id: 'worktree_created',
      status: managedWorktree?.mode === 'disabled'
        ? 'not_applicable'
        : worktreeAvailable
          ? 'passed'
          : 'blocked',
      required: managedWorktree?.mode === 'required',
      reason: managedWorktree?.mode === 'disabled'
        ? 'managed worktree mode is disabled'
        : worktreeAvailable
          ? 'VibePro managed worktree is available'
          : managedWorktree?.status === 'branch_mismatch'
            ? 'VibePro managed worktree branch does not match the recorded branch'
            : 'VibePro managed worktree is missing',
      evidence: hasWorktree ? { path: managedWorktree.path, branch: managedWorktree.branch, actual_branch: managedWorktree.actual_branch ?? null } : null
    },
    {
      id: 'branch_bound',
      status: branchBound ? 'passed' : managedWorktree?.mode === 'disabled' ? 'not_applicable' : 'needs_evidence',
      required: managedWorktree?.mode === 'required',
      reason: branchBound
        ? 'managed branch is recorded and matches the worktree branch'
        : hasWorktree && managedWorktree.branch_match === false
          ? 'managed branch does not match the worktree branch'
          : 'no managed branch recorded',
      evidence: hasWorktree ? { branch: managedWorktree.branch, actual_branch: managedWorktree.actual_branch ?? null, head_sha: managedWorktree.current_head_sha } : null
    },
    {
      id: 'verification_recorded',
      status: completedPhases.includes('verify') ? 'passed' : 'pending',
      required: false,
      reason: completedPhases.includes('verify') ? 'verification evidence exists' : 'verification evidence has not been recorded yet'
    },
    {
      id: 'agent_review_recorded',
      status: completedPhases.includes('agent_review') ? 'passed' : 'pending',
      required: false,
      reason: completedPhases.includes('agent_review') ? 'required agent review evidence is complete' : 'agent review is not complete yet'
    },
    {
      id: 'pr_prepare_ready',
      status: completedPhases.includes('ready_for_pr_create') ? 'passed' : 'pending',
      required: true,
      reason: completedPhases.includes('ready_for_pr_create') ? 'Gate DAG is ready for PR creation' : 'PR prepare is not ready yet'
    },
    {
      id: 'pr_created',
      status: completionStatus === 'pr_created' ? 'passed' : 'pending',
      required: true,
      reason: completionStatus === 'pr_created' ? 'PR URL is recorded' : 'PR has not been created yet'
    }
  ];
  return {
    schema_version: '0.1.0',
    nodes,
    edges: [
      ['story_selected', 'worktree_created'],
      ['worktree_created', 'branch_bound'],
      ['branch_bound', 'verification_recorded'],
      ['verification_recorded', 'agent_review_recorded'],
      ['agent_review_recorded', 'pr_prepare_ready'],
      ['pr_prepare_ready', 'pr_created']
    ].map(([from, to]) => ({ from, to }))
  };
}

async function readConfig(repoRoot) {
  try {
    return JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function copyWorkspaceConfig(repoRoot, worktreePath) {
  const source = path.join(getWorkspaceDir(repoRoot), 'config.json');
  const targetDir = getWorkspaceDir(worktreePath);
  await mkdir(targetDir, { recursive: true });
  const config = JSON.parse(await readFile(source, 'utf8'));
  await writeFile(path.join(targetDir, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
}

async function findWorktree(repoRoot, worktreePath) {
  const output = await gitOptional(repoRoot, ['worktree', 'list', '--porcelain']);
  if (!output) return null;
  const normalized = await canonicalPath(worktreePath);
  for (const item of parseWorktreeList(output)) {
    const itemRealpath = await canonicalPath(item.path);
    if (item.path === path.resolve(worktreePath) || item.path === normalized || itemRealpath === normalized) {
      return { ...item, realpath: itemRealpath };
    }
  }
  return null;
}

function parseWorktreeList(output) {
  const entries = [];
  let current = null;
  for (const line of output.split('\n')) {
    if (!line.trim()) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      const worktreePath = line.slice('worktree '.length);
      current = { path: path.resolve(worktreePath), realpath: path.resolve(worktreePath), branch: null, head: null };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    if (line.startsWith('branch ')) current.branch = normalizeBranchName(line.slice('branch '.length));
  }
  if (current) entries.push(current);
  return entries;
}

async function canonicalPath(filePath) {
  const resolved = path.resolve(filePath);
  try {
    return path.resolve(await realpath(resolved));
  } catch {
    return resolved;
  }
}

async function collectDirty(repoRoot) {
  const status = await gitOptional(repoRoot, ['status', '--porcelain', '-uall']);
  const lines = status ? status.split('\n').filter(Boolean) : [];
  return {
    dirty: lines.length > 0,
    fingerprint: lines.length === 0 ? 'clean' : lines.join('\n')
  };
}

function buildShortId(storyId, seed) {
  const text = `${storyId}:${seed}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

function normalizeBranchName(branch) {
  if (!branch) return null;
  return branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch;
}

function isBranchMatch(actual, expected) {
  if (!expected) return true;
  return normalizeBranchName(actual) === normalizeBranchName(expected);
}

async function git(repoRoot, args) {
  await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

function shellQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
