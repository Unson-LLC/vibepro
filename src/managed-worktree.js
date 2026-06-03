import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { MANIFEST_FILE, getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

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
      source_repo: root,
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
    try {
      await git(root, ['worktree', 'add', worktreePath, '-b', branch, baseRef]);
    } catch (error) {
      return buildUnavailableManagedWorktree({
        mode,
        root,
        worktreePath,
        branch,
        baseRef,
        createdFromSha,
        reason: normalizeErrorMessage(error)
      });
    }
  } else if (!isBranchMatch(existing.branch, branch)) {
    throw new Error(`managed worktree branch mismatch at ${worktreePath}: expected ${branch}, found ${existing.branch ?? 'detached'}`);
  }
  await copyWorkspaceControlFiles(root, worktreePath);
  await ensureManagedWorktreeGitExclude(worktreePath);

  const currentHeadSha = await gitOptional(worktreePath, ['rev-parse', 'HEAD']);
  const actualBranch = await gitOptional(worktreePath, ['branch', '--show-current']);
  const dirty = await collectDirty(worktreePath);
  return {
    mode,
    status: existing ? 'reused' : 'created',
    required: mode === 'required',
    source_repo: root,
    source_relative_path: toWorkspaceRelative(root, root),
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

export async function buildPendingManagedWorktree(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const mode = options.mode ?? await resolveManagedWorktreeMode(root);
  if (mode === 'disabled') {
    return {
      mode,
      status: 'disabled',
      required: false,
      source_repo: root,
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
  return {
    mode,
    status: 'missing',
    required: mode === 'required',
    source_repo: root,
    source_relative_path: toWorkspaceRelative(root, root),
    path: worktreePath,
    relative_path: toWorkspaceRelative(root, worktreePath),
    branch,
    actual_branch: null,
    branch_match: null,
    base_ref: baseRef,
    created_from_sha: createdFromSha || null,
    current_head_sha: null,
    dirty: null,
    dirty_fingerprint: null
  };
}

function buildUnavailableManagedWorktree({ mode, root, worktreePath, branch, baseRef, createdFromSha, reason }) {
  return {
    mode,
    status: 'unavailable',
    required: mode === 'required',
    source_repo: root,
    source_relative_path: toWorkspaceRelative(root, root),
    path: worktreePath,
    relative_path: toWorkspaceRelative(root, worktreePath),
    branch,
    actual_branch: null,
    branch_match: false,
    base_ref: baseRef,
    created_from_sha: createdFromSha || null,
    current_head_sha: null,
    dirty: null,
    dirty_fingerprint: null,
    failure_reason: reason
  };
}

export async function refreshManagedWorktree(repoRoot, managedWorktree) {
  if (!managedWorktree?.path || managedWorktree.mode === 'disabled') return managedWorktree ?? null;
  const root = path.resolve(repoRoot);
  const worktreePath = path.resolve(managedWorktree.path);
  const existing = await findWorktree(root, worktreePath);
  const currentHeadSha = await gitOptional(worktreePath, ['rev-parse', 'HEAD']);
  if (currentHeadSha || existing) await ensureManagedWorktreeGitExclude(worktreePath);
  const actualBranch = await gitOptional(worktreePath, ['branch', '--show-current']) || existing?.branch || null;
  const dirty = await collectDirty(worktreePath);
  const exists = Boolean(currentHeadSha || existing);
  const branchMatch = isBranchMatch(actualBranch, managedWorktree.branch);
  const availableStatus = ['created', 'reused'].includes(managedWorktree.status)
    ? managedWorktree.status
    : 'available';
  const missingStatus = managedWorktree.status === 'unavailable' && managedWorktree.failure_reason
    ? 'unavailable'
    : 'missing';
  return {
    ...managedWorktree,
    status: exists ? branchMatch ? availableStatus : 'branch_mismatch' : missingStatus,
    actual_branch: actualBranch,
    branch_match: branchMatch,
    current_head_sha: currentHeadSha || managedWorktree.current_head_sha || null,
    dirty: dirty.dirty,
    dirty_fingerprint: dirty.fingerprint
  };
}

export function buildManagedWorktreeCommands(commands, managedWorktree, options = {}) {
  if (!isManagedWorktreeCommandSafe(managedWorktree, options)) return commands;
  return Object.fromEntries(Object.entries(commands).map(([key, command]) => [
    key,
    `cd ${shellQuote(managedWorktree.path)} && ${command}`
  ]));
}

export function isManagedWorktreeCommandSafe(managedWorktree, options = {}) {
  if (!managedWorktree?.path || managedWorktree.mode === 'disabled') return false;
  if (!['created', 'reused', 'available'].includes(managedWorktree.status)) return false;
  if (managedWorktree.branch_match === false) return false;
  if (options.expectedHeadSha && managedWorktree.current_head_sha && managedWorktree.current_head_sha !== options.expectedHeadSha) return false;
  return true;
}

export async function evaluateManagedWorktreeCommandContext(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = options.storyId;
  if (!storyId) {
    const mode = await resolveManagedWorktreeMode(root);
    const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
    const actualRoot = await canonicalPath(root);
    return {
      status: mode === 'required' ? 'blocked' : mode === 'preferred' ? 'needs_review' : 'not_applicable',
      mode,
      required: mode === 'required',
      reason: mode === 'disabled'
        ? 'managed worktree mode is disabled'
        : 'story id is required to evaluate managed worktree locality before protected commands',
      command_name: options.commandName ?? null,
      repo_root: root,
      actual_root: actualRoot,
      expected_root: null,
      expected_head_sha: options.expectedHeadSha ?? currentHeadSha ?? null,
      current_head_sha: currentHeadSha,
      managed_worktree: null
    };
  }
  const state = await readManagedExecutionState(root, storyId);
  const configuredMode = await resolveManagedWorktreeModeForState(root, state);
  if (!state?.managed_worktree) {
    const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
    const actualRoot = await canonicalPath(root);
    return {
      status: configuredMode === 'required' ? 'blocked' : configuredMode === 'preferred' ? 'needs_review' : 'not_applicable',
      mode: configuredMode,
      required: configuredMode === 'required',
      reason: configuredMode === 'disabled'
        ? 'managed worktree mode is disabled'
        : 'no managed worktree execution state is recorded for this checkout; run vibepro execute start before managed worktree protected commands',
      command_name: options.commandName ?? null,
      repo_root: root,
      actual_root: actualRoot,
      expected_root: null,
      expected_head_sha: options.expectedHeadSha ?? currentHeadSha ?? null,
      current_head_sha: currentHeadSha,
      managed_worktree: null
    };
  }
  if (configuredMode === 'disabled') {
    return {
      status: 'not_applicable',
      mode: configuredMode,
      required: false,
      reason: 'managed worktree mode is disabled',
      command_name: options.commandName ?? null,
      repo_root: root,
      actual_root: await canonicalPath(root),
      expected_root: null,
      expected_head_sha: null,
      current_head_sha: await gitOptional(root, ['rev-parse', 'HEAD']),
      managed_worktree: {
        ...state.managed_worktree,
        mode: configuredMode,
        required: false
      }
    };
  }
  const managedWorktree = {
    ...await refreshManagedWorktree(root, state.managed_worktree).catch(() => state.managed_worktree),
    mode: configuredMode,
    required: configuredMode === 'required'
  };
  const actualRoot = await canonicalPath(root);
  const expectedRoot = managedWorktree.path ? await canonicalPath(managedWorktree.path) : null;
  const localityMatches = Boolean(expectedRoot && actualRoot === expectedRoot);
  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  const expectedHeadSha = options.expectedHeadSha ?? currentHeadSha ?? null;
  const headMatches = !expectedHeadSha || !managedWorktree.current_head_sha || managedWorktree.current_head_sha === expectedHeadSha;
  const branchMatches = managedWorktree.branch_match !== false;
  const status = localityMatches && branchMatches && headMatches ? 'satisfied' : configuredMode === 'required' ? 'blocked' : 'needs_review';
  return {
    status,
    mode: configuredMode,
    required: configuredMode === 'required',
    reason: buildManagedWorktreeContextReason({
      commandName: options.commandName,
      localityMatches,
      branchMatches,
      headMatches,
      expectedHeadSha,
      currentHeadSha,
      actualRoot,
      expectedRoot,
      managedWorktree
    }),
    command_name: options.commandName ?? null,
    repo_root: root,
    actual_root: actualRoot,
    expected_root: expectedRoot,
    expected_head_sha: expectedHeadSha,
    current_head_sha: currentHeadSha,
    managed_worktree: managedWorktree
  };
}

export async function readManagedExecutionState(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  const localState = await readExecutionState(root, storyId);
  if (localState?.managed_worktree) return localState;
  const linkedState = await findLinkedExecutionState(root, storyId);
  return linkedState ?? localState;
}

async function resolveManagedWorktreeModeForState(root, state) {
  const sourceRepo = state?.managed_worktree?.source_repo;
  if (sourceRepo) {
    return resolveManagedWorktreeMode(sourceRepo);
  }
  return resolveManagedWorktreeMode(root);
}

export async function assertManagedWorktreeCommandAllowed(repoRoot, options = {}) {
  const context = await evaluateManagedWorktreeCommandContext(repoRoot, options);
  if (context.status === 'blocked') {
    throw new Error(`managed worktree required for ${options.commandName ?? 'this command'}: ${context.reason}`);
  }
  return context;
}

export function buildManagedWorktreeCommandWarning(context) {
  if (context?.status !== 'needs_review') return null;
  const binding = buildManagedWorktreeCommandBinding(context);
  return {
    id: 'managed_worktree_locality',
    status: binding.status,
    mode: binding.mode,
    required: false,
    command_name: binding.command_name,
    reason: binding.reason,
    action: 'Run the command from the recorded VibePro managed worktree, update the managed worktree to the current HEAD, or explicitly disable managed_worktree for this repository.',
    repo_root: binding.repo_root,
    actual_root: binding.actual_root,
    expected_root: binding.expected_root,
    expected_head_sha: binding.expected_head_sha,
    current_head_sha: binding.current_head_sha,
    managed_worktree: binding.managed_worktree
  };
}

export function buildManagedWorktreeCommandBinding(context) {
  if (!context || context.status === 'not_applicable') return null;
  return {
    status: context.status,
    mode: context.mode,
    required: context.required === true,
    command_name: context.command_name ?? null,
    reason: context.reason ?? null,
    repo_root: context.repo_root ?? null,
    actual_root: context.actual_root ?? null,
    expected_root: context.expected_root ?? null,
    expected_head_sha: context.expected_head_sha ?? null,
    current_head_sha: context.current_head_sha ?? null,
    managed_worktree: context.managed_worktree ? {
      source_repo: context.managed_worktree.source_repo ?? null,
      path: context.managed_worktree.path ?? null,
      branch: context.managed_worktree.branch ?? null,
      actual_branch: context.managed_worktree.actual_branch ?? null,
      current_head_sha: context.managed_worktree.current_head_sha ?? null,
      dirty: context.managed_worktree.dirty ?? null,
      dirty_fingerprint: context.managed_worktree.dirty_fingerprint ?? null
    } : null
  };
}

export function buildExecutionDag({ managedWorktree, completedPhases = [], completionStatus = 'not_prepared', expectedHeadSha = null }) {
  const hasWorktree = Boolean(managedWorktree?.path && managedWorktree.mode !== 'disabled');
  const worktreeAvailable = ['created', 'reused', 'available'].includes(managedWorktree?.status);
  const branchBound = worktreeAvailable && managedWorktree.branch && managedWorktree.branch_match !== false;
  const headBound = branchBound
    && (!expectedHeadSha || !managedWorktree.current_head_sha || managedWorktree.current_head_sha === expectedHeadSha);
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
          : managedWorktree?.mode === 'required'
            ? 'blocked'
            : 'needs_evidence',
      required: managedWorktree?.mode === 'required',
      reason: managedWorktree?.mode === 'disabled'
        ? 'managed worktree mode is disabled'
        : worktreeAvailable
          ? 'VibePro managed worktree is available'
          : managedWorktree?.status === 'branch_mismatch'
            ? 'VibePro managed worktree branch does not match the recorded branch'
            : managedWorktree?.status === 'unavailable'
              ? `VibePro managed worktree could not be created: ${managedWorktree.failure_reason ?? 'unknown error'}`
            : 'VibePro managed worktree is missing',
      evidence: hasWorktree ? {
        path: managedWorktree.path,
        branch: managedWorktree.branch,
        actual_branch: managedWorktree.actual_branch ?? null,
        failure_reason: managedWorktree.failure_reason ?? null
      } : null
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
      id: 'head_bound',
      status: managedWorktree?.mode === 'disabled'
        ? 'not_applicable'
        : headBound
          ? 'passed'
          : managedWorktree?.mode === 'required'
            ? 'blocked'
            : 'needs_evidence',
      required: managedWorktree?.mode === 'required',
      reason: headBound
        ? 'managed worktree HEAD matches the current execution HEAD'
        : hasWorktree && expectedHeadSha && managedWorktree.current_head_sha
          ? 'managed worktree HEAD does not match the current execution HEAD'
          : 'managed worktree HEAD binding is not recorded',
      evidence: hasWorktree ? {
        head_sha: managedWorktree.current_head_sha,
        expected_head_sha: expectedHeadSha
      } : null
    },
    {
      id: 'implementation_started',
      status: branchBound || managedWorktree?.mode === 'disabled' ? 'passed' : 'pending',
      required: false,
      reason: branchBound
        ? 'managed branch is ready for implementation work'
        : managedWorktree?.mode === 'disabled'
          ? 'implementation starts in the current checkout because managed worktree mode is disabled'
          : 'implementation has not started in a bound managed branch yet'
    },
    {
      id: 'implementation_complete',
      status: completedPhases.length > 0 || ['ready_for_pr_create', 'pr_created'].includes(completionStatus) ? 'passed' : 'pending',
      required: false,
      reason: completedPhases.length > 0 || ['ready_for_pr_create', 'pr_created'].includes(completionStatus)
        ? 'implementation has produced PR preparation or verification evidence'
        : 'implementation completion evidence has not been recorded yet'
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
    },
    {
      id: 'merge_ready',
      status: 'not_applicable',
      required: false,
      reason: 'execute merge enforcement is outside this MVP implementation scope'
    },
    {
      id: 'merged_or_closed',
      status: 'not_applicable',
      required: false,
      reason: 'merge or close tracking is outside this MVP implementation scope'
    },
    {
      id: 'worktree_cleaned',
      status: 'not_applicable',
      required: false,
      reason: 'managed worktree cleanup is outside this MVP implementation scope'
    }
  ];
  return {
    schema_version: '0.1.0',
    nodes,
    edges: [
      ['story_selected', 'worktree_created'],
      ['worktree_created', 'branch_bound'],
      ['branch_bound', 'head_bound'],
      ['head_bound', 'implementation_started'],
      ['implementation_started', 'implementation_complete'],
      ['implementation_complete', 'verification_recorded'],
      ['verification_recorded', 'agent_review_recorded'],
      ['agent_review_recorded', 'pr_prepare_ready'],
      ['pr_prepare_ready', 'pr_created'],
      ['pr_created', 'merge_ready'],
      ['merge_ready', 'merged_or_closed'],
      ['merged_or_closed', 'worktree_cleaned']
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

async function readExecutionState(repoRoot, storyId) {
  const filePath = path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'state.json');
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      const backupPath = `${filePath}.corrupt-${Date.now()}-${process.pid}.bak`;
      await rename(filePath, backupPath);
      throw new Error(`execution state JSON is corrupt: ${toWorkspaceRelative(repoRoot, filePath)}. Moved it to ${toWorkspaceRelative(repoRoot, backupPath)}.`);
    }
    throw error;
  }
}

async function findLinkedExecutionState(repoRoot, storyId) {
  const root = path.resolve(repoRoot);
  const rootRealpath = await canonicalPath(root);
  const output = await gitOptional(root, ['worktree', 'list', '--porcelain']);
  if (!output) return null;
  for (const item of parseWorktreeList(output)) {
    const candidateRoot = path.resolve(item.path);
    if (await canonicalPath(candidateRoot) === rootRealpath) continue;
    const candidate = await readExecutionState(candidateRoot, storyId);
    if (!candidate?.managed_worktree?.path) continue;
    const managedPath = await canonicalPath(candidate.managed_worktree.path);
    const sourceRepo = candidate.managed_worktree.source_repo
      ? await canonicalPath(candidate.managed_worktree.source_repo)
      : null;
    if (managedPath === rootRealpath || sourceRepo === rootRealpath) return candidate;
  }
  return null;
}

function buildManagedWorktreeContextReason({
  commandName,
  localityMatches,
  branchMatches,
  headMatches,
  expectedHeadSha,
  currentHeadSha,
  actualRoot,
  expectedRoot,
  managedWorktree
}) {
  const label = commandName ?? 'command';
  if (localityMatches && branchMatches && headMatches) {
    return `${label} is running inside the recorded managed worktree`;
  }
  const issues = [];
  if (!localityMatches) issues.push(`repo root ${actualRoot} is not recorded managed worktree ${expectedRoot ?? '-'}`);
  if (!branchMatches) issues.push(`managed branch mismatch: expected ${managedWorktree?.branch ?? '-'}, found ${managedWorktree?.actual_branch ?? '-'}`);
  if (!headMatches) issues.push(`managed worktree HEAD ${managedWorktree?.current_head_sha ?? '-'} does not match expected HEAD ${expectedHeadSha ?? currentHeadSha ?? '-'}`);
  return issues.join('; ');
}

async function copyWorkspaceControlFiles(repoRoot, worktreePath) {
  const targetDir = getWorkspaceDir(worktreePath);
  await mkdir(targetDir, { recursive: true });
  await copyWorkspaceJsonFile(repoRoot, targetDir, 'config.json', { required: true });
  await copyWorkspaceJsonFile(repoRoot, targetDir, MANIFEST_FILE, { required: true });
}

async function copyWorkspaceJsonFile(repoRoot, targetDir, fileName, options = {}) {
  const source = path.join(getWorkspaceDir(repoRoot), fileName);
  try {
    const parsed = JSON.parse(await readFile(source, 'utf8'));
    await writeFile(path.join(targetDir, fileName), `${JSON.stringify(parsed, null, 2)}\n`);
  } catch (error) {
    if (error.code === 'ENOENT' && !options.required) return;
    throw error;
  }
}

async function ensureManagedWorktreeGitExclude(worktreePath) {
  const excludePathText = await gitOptional(worktreePath, ['rev-parse', '--git-path', 'info/exclude']);
  if (!excludePathText) return;
  const excludePath = path.isAbsolute(excludePathText)
    ? excludePathText
    : path.resolve(worktreePath, excludePathText);
  await mkdir(path.dirname(excludePath), { recursive: true });
  const required = [
    '# VibePro managed worktree control files',
    '/.vibepro/config.json',
    `/.vibepro/${MANIFEST_FILE}`,
    '/.vibepro/executions/'
  ];

  let existing = '';
  try {
    existing = await readFile(excludePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const missing = required.filter((line) => !existing.includes(line));
  if (missing.length === 0) return;
  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n` : '';
  await writeFile(excludePath, `${prefix}${missing.join('\n')}\n`);
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

function normalizeErrorMessage(error) {
  const message = error?.stderr || error?.message || String(error);
  return message.trim().split('\n').filter(Boolean).slice(-1)[0] ?? 'unknown error';
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
