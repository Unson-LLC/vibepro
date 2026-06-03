import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { readDecisionRecordsIfExists } from './decision-records.js';
import { resolveManagedWorktreeMode } from './managed-worktree.js';
import { getWorkspaceDir } from './workspace.js';

const execFileAsync = promisify(execFile);

export async function buildManagedWorktreeGate(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId;
  const state = storyId ? await readBoundExecutionState(root, storyId) : null;
  let managedWorktree = state?.managed_worktree ?? null;
  if (managedWorktree?.path) {
    managedWorktree = {
      ...managedWorktree,
      current_head_sha: await gitOptional(managedWorktree.path, ['rev-parse', 'HEAD']) ?? managedWorktree.current_head_sha ?? null
    };
  }
  const mode = await resolveManagedWorktreeMode(managedWorktree?.source_repo ?? root);
  const expectedPath = managedWorktree?.path ? path.resolve(managedWorktree.path) : null;
  const currentPath = root;
  const insideManagedWorktree = expectedPath ? isSameOrInside(currentPath, expectedPath) : false;
  const decisionRecords = options.decisionRecords
    ?? (storyId ? await readDecisionRecordsIfExists(root, storyId) : null);
  const bypass = findAcceptedManagedWorktreeBypass(decisionRecords);
  const missingReason = expectedPath
    ? `current repo ${formatPath(currentPath)} is outside VibePro managed worktree ${formatPath(expectedPath)}`
    : 'VibePro managed worktree execution state is missing';

  if (mode === 'disabled') {
    return {
      id: 'gate:managed_worktree',
      type: 'managed_worktree_gate',
      label: 'Managed Worktree Gate',
      status: 'not_applicable',
      required: false,
      mode,
      current_repo: currentPath,
      managed_worktree_path: expectedPath,
      reason: 'managed worktree mode is disabled'
    };
  }

  if (bypass) {
    return {
      id: 'gate:managed_worktree',
      type: 'managed_worktree_gate',
      label: 'Managed Worktree Gate',
      status: 'bypassed',
      required: mode === 'required',
      mode,
      current_repo: currentPath,
      managed_worktree_path: expectedPath,
      branch: managedWorktree?.branch ?? null,
      current_head_sha: managedWorktree?.current_head_sha ?? null,
      managed_worktree: managedWorktree,
      decision_id: bypass.decision_id,
      reason: `accepted bypass decision recorded: ${bypass.reason ?? bypass.summary ?? bypass.decision_id}`
    };
  }

  if (insideManagedWorktree) {
    return {
      id: 'gate:managed_worktree',
      type: 'managed_worktree_gate',
      label: 'Managed Worktree Gate',
      status: 'passed',
      required: mode === 'required',
      mode,
      current_repo: currentPath,
      managed_worktree_path: expectedPath,
      branch: managedWorktree?.branch ?? null,
      current_head_sha: managedWorktree?.current_head_sha ?? null,
      managed_worktree: managedWorktree,
      reason: 'command is running inside the VibePro managed worktree'
    };
  }

  return {
    id: 'gate:managed_worktree',
    type: 'managed_worktree_gate',
    label: 'Managed Worktree Gate',
    status: mode === 'required' ? 'block' : 'needs_review',
    required: mode === 'required',
    mode,
    current_repo: currentPath,
    managed_worktree_path: expectedPath,
    branch: managedWorktree?.branch ?? null,
    current_head_sha: managedWorktree?.current_head_sha ?? null,
    managed_worktree: managedWorktree,
    reason: missingReason
  };
}

export async function assertManagedWorktreeCommandAllowed(repoRoot, options = {}) {
  const gate = await buildManagedWorktreeGate(repoRoot, options);
  if (gate.mode !== 'required' || ['passed', 'bypassed'].includes(gate.status)) {
    return gate;
  }
  const commandName = options.commandName ?? 'command';
  throw new Error(
    `${commandName} is blocked by gate:managed_worktree. ${gate.reason}. ` +
    'Run the command from `vibepro execute start` managed_worktree.path or record an accepted waiver with ' +
    '`vibepro decision record --type waiver --source gate:managed_worktree --reason <reason>`.'
  );
}

export function formatManagedWorktreePrStatus(gate) {
  if (!gate) return 'unknown';
  if (gate.status === 'passed') return 'passed';
  if (gate.status === 'bypassed') return 'bypassed';
  if (gate.status === 'not_applicable') return 'disabled';
  if (gate.status === 'block') return 'needs_review';
  return gate.status ?? 'unknown';
}

async function readExecutionStateIfExists(repoRoot, storyId) {
  try {
    return JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'state.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readBoundExecutionState(repoRoot, storyId) {
  const localState = await readExecutionStateIfExists(repoRoot, storyId);
  if (localState?.managed_worktree) return localState;

  const worktrees = await listGitWorktrees(repoRoot);
  for (const worktreePath of worktrees) {
    if (path.resolve(worktreePath) === path.resolve(repoRoot)) continue;
    const state = await readExecutionStateIfExists(worktreePath, storyId);
    const managedPath = state?.managed_worktree?.path ? path.resolve(state.managed_worktree.path) : null;
    if (managedPath && isSameOrInside(path.resolve(repoRoot), managedPath)) return state;
  }
  return null;
}

async function listGitWorktrees(repoRoot) {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return stdout
      .split('\n')
      .map((line) => line.startsWith('worktree ') ? line.slice('worktree '.length) : null)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8'
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function findAcceptedManagedWorktreeBypass(decisionRecords) {
  const decisions = Array.isArray(decisionRecords?.decisions) ? decisionRecords.decisions : [];
  return decisions.find((decision) => decision
    && decision.type === 'waiver'
    && decision.status === 'accepted'
    && decision.source === 'gate:managed_worktree') ?? null;
}

function isSameOrInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function formatPath(filePath) {
  if (!filePath) return '-';
  return filePath;
}
