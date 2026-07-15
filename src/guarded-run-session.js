import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { startExecution as defaultStartExecution } from './execution-state.js';
import { resolveGitIdentity as defaultResolveGitIdentity } from './git-identity.js';
import { evaluateGateReadiness as defaultReadGateReadiness } from './pr-manager.js';
import { getWorkspaceDir } from './workspace.js';

export const GUARDED_RUN_SCHEMA_VERSION = '0.1.0';
export const GUARDED_RUN_TARGET = 'pr_ready';
export const GUARDED_AUTONOMY_MODE = 'guarded';

const STORY_ID_PATTERN = /^story-[a-z0-9][a-z0-9._-]*$/;
const RUN_ID_PATTERN = /^run-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const STATUS_VALUES = new Set([
  'running',
  'waiting_for_human',
  'waiting_for_runtime',
  'blocked',
  'failed',
  'cancelled',
  'pr_ready'
]);
const RECOVERABLE_STATUSES = new Set([
  'waiting_for_human',
  'waiting_for_runtime',
  'blocked',
  'failed'
]);
const AUTHORITY_KINDS = new Set(['managed', 'repository', 'source_fallback']);
const DEPENDENCY_KEYS = new Set([
  'now',
  'randomBytes',
  'startExecution',
  'readGateReadiness',
  'artifactIo',
  'resolveGitIdentity'
]);
const ARTIFACT_IO_KEYS = new Set(['readFile', 'writeFile', 'rename', 'mkdir', 'readdir', 'rm']);

const defaultArtifactIo = { readFile, writeFile, rename, mkdir, readdir, rm };

export class GuardedRunError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'GuardedRunError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      status: 'error',
      stop_reason: {
        code: this.code,
        message: this.message,
        details: this.details
      }
    };
  }
}

export function createGuardedRunSession(dependencies = {}) {
  assertClosedKeys(dependencies, DEPENDENCY_KEYS, 'guarded Run dependency');
  assertClosedKeys(dependencies.artifactIo ?? {}, ARTIFACT_IO_KEYS, 'guarded Run artifact I/O dependency');
  const deps = {
    now: dependencies.now ?? (() => new Date()),
    randomBytes: dependencies.randomBytes ?? nodeRandomBytes,
    startExecution: dependencies.startExecution ?? defaultStartExecution,
    readGateReadiness: dependencies.readGateReadiness ?? defaultReadGateReadiness,
    resolveGitIdentity: dependencies.resolveGitIdentity ?? defaultResolveGitIdentity,
    artifactIo: { ...defaultArtifactIo, ...(dependencies.artifactIo ?? {}) }
  };

  return {
    run: (repoRoot, options = {}) => createRun(deps, repoRoot, options),
    status: (repoRoot, options = {}) => readRun(deps, repoRoot, options),
    watch: (repoRoot, options = {}) => watchRun(deps, repoRoot, options),
    resume: (repoRoot, options = {}) => resumeRun(deps, repoRoot, options),
    cancel: (repoRoot, options = {}) => cancelRun(deps, repoRoot, options),
    transition: (repoRoot, options = {}) => transitionRun(deps, repoRoot, options)
  };
}

export function isGuardedRunError(error) {
  return error instanceof GuardedRunError;
}

export function renderGuardedRunSummary(state) {
  const stop = state.stop_reason
    ? `${state.stop_reason.code}: ${state.stop_reason.message}`
    : 'none';
  const binding = state.execution_context
    ? `${state.execution_context.authority_kind} ${state.execution_context.root_realpath} @ ${state.current_head_sha}`
    : 'unknown';
  const transitions = state.transitions
    .map((item) => `  ${item.sequence}. ${item.from ?? 'created'} -> ${item.to} (${item.reason}) at ${item.timestamp}`)
    .join('\n');
  return `# VibePro Guarded Run\n\n- run_id: ${state.run_id}\n- story_id: ${state.story_id}\n- target: ${state.target}\n- autonomy: ${state.autonomy_mode}\n- status: ${state.status}\n- stop_reason: ${stop}\n- binding: ${binding}\n- attempt: ${state.attempt}\n- iteration: ${state.iteration}\n\n## Transitions\n\n${transitions || '  none'}\n`;
}

function shellQuoteCommandArg(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

export function renderGuardedRunError(error, options = {}) {
  const details = error.details ?? {};
  const repoRoot = options.repoRoot ?? '.';
  const lines = [
    '# VibePro Guarded Run Error',
    '',
    `- code: ${error.code}`,
    `- message: ${error.message}`
  ];
  for (const [label, key] of [
    ['run_id', 'run_id'],
    ['story_id', 'story_id'],
    ['artifact', 'artifact'],
    ['authority_artifact', 'authority_artifact'],
    ['mirror_artifact', 'mirror_artifact'],
    ['quarantine_artifact', 'quarantine_artifact'],
    ['lock_artifact', 'lock_artifact'],
    ['legacy_artifact', 'legacy_artifact']
  ]) {
    if (details[key]) lines.push(`- ${label}: ${details[key]}`);
  }
  if (Array.isArray(details.rejected_candidates)) {
    for (const candidate of details.rejected_candidates) {
      lines.push(`- rejected_candidate: ${candidate.run_id} (${candidate.code}) ${candidate.artifact}`);
    }
  }
  if (error.code === 'linked_copy_sync_failed' && details.story_id && details.run_id) {
    lines.push(`- next_action: vibepro execute watch ${shellQuoteCommandArg(repoRoot)} --story-id ${details.story_id} --run-id ${details.run_id} --repair-linked-copy`);
  }
  if (error.code === 'run_selection_blocked') {
    lines.push('- next_action: rerun with --run-id <validated-run-id> after inspecting the rejected candidates');
  }
  return `${lines.join('\n')}\n`;
}

async function createRun(deps, repoRoot, options) {
  if (options.runId != null) {
    const suppliedRunId = requireRunId(options.runId);
    throw contractError('run_id_not_allowed', 'execute run generates its Run id; --run-id is not accepted.', {
      run_id: suppliedRunId,
      command: 'execute run'
    });
  }
  const storyId = requireStoryId(options.storyId);
  const caller = await resolveIdentity(deps, repoRoot, 'worktree_mismatch');
  await assertRegisteredStory(deps, caller.root_realpath, storyId);
  const initialLegacy = await readLegacyState(deps, caller.root_realpath, storyId);
  const lockRoot = await resolveCreationLockRoot(deps, caller, initialLegacy);
  const lockPath = getCreationLockPath(lockRoot, storyId);
  await deps.artifactIo.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await deps.artifactIo.mkdir(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw contractError('run_creation_locked', 'Another guarded Run is being created for this Story.', {
        lock_artifact: lockPath
      });
    }
    throw error;
  }

  try {
    let legacy = await readLegacyState(deps, caller.root_realpath, storyId);
    let binding;
    if (legacy) {
      binding = await resolveCreationBinding(deps, caller, legacy);
    } else {
      try {
        const bootstrap = await deps.startExecution(caller.root_realpath, {
          storyId,
          target: options.legacyTarget ?? 'pr_create',
          baseRef: options.baseRef,
          branchName: options.branchName,
          worktreePath: options.worktreePath
        });
        legacy = bootstrap?.state ?? await readLegacyState(deps, caller.root_realpath, storyId);
      } catch (error) {
        const partial = await readLegacyState(deps, caller.root_realpath, storyId);
        if (!partial) throw error;
        throw contractError('legacy_bootstrap_partial', 'Legacy execution bootstrap committed partially and Run creation stopped.', {
          artifact: getLegacyStatePath(caller.root_realpath, storyId),
          cause: error.message
        });
      }
      if (!legacy) throw new Error('execute start returned without a legacy execution state');
      binding = await resolveCreationBinding(deps, caller, legacy, { newlyBootstrapped: true });
    }

    const createdAt = toIso(deps.now());
    const runId = generateRunId(createdAt, deps.randomBytes);
    const state = buildInitialState({ storyId, runId, createdAt, binding });
    const authorityFile = getRunStatePath(binding.authority.root_realpath, storyId, runId);
    const mirrorFile = binding.mirror
      ? getRunStatePath(binding.mirror.root_realpath, storyId, runId)
      : null;
    await persistAuthorityThenMirror(deps, state, authorityFile, mirrorFile);
    return state;
  } finally {
    await deps.artifactIo.rm(lockPath, { recursive: true, force: true });
  }
}

async function resolveCreationLockRoot(deps, caller, legacy) {
  const managed = legacy?.managed_worktree;
  if (!managed
      || managed.mode === 'disabled'
      || managed.status === 'disabled'
      || isManagedUnavailable(managed)) {
    return resolveRepositorySharedLockRoot(caller);
  }
  if (!managed.path) return resolveRepositorySharedLockRoot(caller);
  const authority = await resolveIdentity(deps, managed.path, 'worktree_unavailable');
  const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
  assertAllowedCaller(caller, authority, source);
  return resolveRepositorySharedLockRoot(source);
}

function resolveRepositorySharedLockRoot(identity) {
  if (!identity.git_common_dir_realpath) {
    throw contractError('worktree_mismatch', 'Git identity does not expose a repository-shared common directory.', {
      root_realpath: identity.root_realpath
    });
  }
  return identity.git_common_dir_realpath;
}

async function readRun(deps, repoRoot, options) {
  const loaded = await loadSelectedRun(deps, repoRoot, options);
  return loaded.state;
}

async function watchRun(deps, repoRoot, options) {
  if (!options.repairLinkedCopy) return readRun(deps, repoRoot, options);
  const selected = await locateSelectedRun(deps, repoRoot, options);
  const raw = await readRequiredFile(deps, selected.authorityFile, 'run_not_found', 'Guarded Run was not found.', {
    run_id: selected.runId
  });
  const parsed = await parseAndMaybeQuarantine(deps, raw, selected.authorityFile);
  const canonical = migrateRunState(parsed).state;
  await validateAuthorityBinding(deps, selected.caller, canonical, selected.authorityIdentity, {
    storyId: selected.storyId,
    runId: selected.runId,
    expectedAuthorityKind: selected.expectedAuthorityKind
  });
  if (canonical.execution_context.authority_kind !== 'managed' || !selected.mirrorFile) {
    throw contractError('linked_copy_not_configured', 'This guarded Run has no linked mirror.', {
      run_id: canonical.run_id,
      authority_artifact: selected.authorityFile
    });
  }
  await writeRawAtomic(deps, selected.mirrorFile, raw);
  return readRun(deps, repoRoot, options);
}

async function resumeRun(deps, repoRoot, options) {
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: true });
  if (loaded.state.status === 'cancelled' || loaded.state.status === 'pr_ready') {
    throw contractError('terminal_state', `Run is already terminal: ${loaded.state.status}.`, {
      run_id: loaded.state.run_id,
      status: loaded.state.status
    });
  }
  if (!RECOVERABLE_STATUSES.has(loaded.state.status)) {
    throw contractError('invalid_transition', `Run cannot resume from ${loaded.state.status}.`, {
      run_id: loaded.state.run_id,
      from: loaded.state.status,
      to: 'running'
    });
  }
  const next = applyTransition(loaded.state, 'running', 'operator_resume', toIso(deps.now()), {
    attempt: loaded.state.attempt + 1,
    stop_reason: null,
    pending_decision: null
  });
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile);
  return next;
}

async function cancelRun(deps, repoRoot, options) {
  const loaded = await loadSelectedRun(deps, repoRoot, options);
  if (loaded.state.status === 'cancelled') return loaded.state;
  if (loaded.state.status === 'pr_ready') {
    throw contractError('terminal_state', 'A pr_ready Run is terminal and cannot be cancelled.', {
      run_id: loaded.state.run_id,
      status: loaded.state.status
    });
  }
  const next = applyTransition(loaded.state, 'cancelled', 'operator_cancelled', toIso(deps.now()), {
    stop_reason: {
      code: 'cancelled_by_operator',
      message: 'The guarded Run was cancelled by the operator.',
      details: {}
    },
    pending_decision: null
  });
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile);
  return next;
}

async function transitionRun(deps, repoRoot, options) {
  const to = options.to;
  if (!STATUS_VALUES.has(to)) throw contractError('unknown_status', `Unknown Run status: ${to}.`, { status: to });
  const loaded = await loadSelectedRun(deps, repoRoot, options, { requireCurrentHead: true });
  if (loaded.state.status === 'failed' && to === 'running') {
    throw contractError('invalid_transition', 'A failed Run can return to running only through execute resume.', {
      run_id: loaded.state.run_id,
      from: loaded.state.status,
      to
    });
  }
  if (to === 'pr_ready') {
    const gate = await deps.readGateReadiness(loaded.state.execution_context.root_realpath, {
      storyId: loaded.state.story_id
    });
    if (!gate?.ready_for_pr_create) {
      throw contractError('invalid_transition', 'Gate DAG is not ready for pr_ready.', {
        run_id: loaded.state.run_id,
        to,
        ready_for_pr_create: false
      });
    }
  }
  const timestamp = toIso(deps.now());
  const next = applyTransition(loaded.state, to, options.reason ?? 'run_transition', timestamp, {
    stop_reason: RECOVERABLE_STATUSES.has(to)
      ? options.stopReason
      : (to === 'running' || to === 'pr_ready'
          ? null
          : (options.stopReason ?? loaded.state.stop_reason)),
    pending_decision: options.pendingDecision ?? loaded.state.pending_decision
  });
  if (next === loaded.state) return next;
  await persistAuthorityThenMirror(deps, next, loaded.authorityFile, loaded.mirrorFile);
  return next;
}

async function loadSelectedRun(deps, repoRoot, options, requirements = {}) {
  const selected = await locateSelectedRun(deps, repoRoot, options);
  const authorityRaw = await readRequiredFile(
    deps,
    selected.authorityFile,
    selected.discoveredFromMirror ? 'worktree_unavailable' : 'run_not_found',
    selected.discoveredFromMirror ? 'The recorded Run authority is unavailable.' : 'Guarded Run was not found.',
    { run_id: selected.runId, authority_artifact: selected.authorityFile }
  );
  const authorityState = await parseAndMaybeQuarantine(deps, authorityRaw, selected.authorityFile);

  let mirrorRaw = null;
  if (selected.mirrorFile) {
    if (authorityState.execution_context?.authority_kind !== 'managed') {
      throw contractError('invalid_state', 'Run authority kind conflicts with its managed execution binding.', {
        run_id: selected.runId,
        authority_kind: authorityState.execution_context?.authority_kind ?? null
      });
    }
    mirrorRaw = await readOptionalFile(deps, selected.mirrorFile);
    if (mirrorRaw === null || mirrorRaw !== authorityRaw) {
      throw contractError('linked_copy_out_of_sync', 'Run authority and linked mirror are out of sync.', {
        run_id: authorityState.run_id,
        authority_artifact: selected.authorityFile,
        mirror_artifact: selected.mirrorFile
      });
    }
  }

  const migration = migrateRunState(authorityState);
  await validateAuthorityBinding(
    deps,
    selected.caller,
    migration.state,
    selected.authorityIdentity,
    {
      ...requirements,
      storyId: selected.storyId,
      runId: selected.runId,
      expectedAuthorityKind: selected.expectedAuthorityKind
    }
  );
  if (migration.changed) {
    await persistAuthorityThenMirror(deps, migration.state, selected.authorityFile, selected.mirrorFile);
  }
  return {
    ...selected,
    state: migration.state
  };
}

async function locateSelectedRun(deps, repoRoot, options) {
  const storyId = requireStoryId(options.storyId);
  const caller = await resolveIdentity(deps, repoRoot, 'worktree_mismatch');
  await assertRegisteredStory(deps, caller.root_realpath, storyId);
  const explicitRunId = options.runId == null ? null : requireRunId(options.runId);
  const legacy = await readLegacyState(deps, caller.root_realpath, storyId);
  const location = await resolveReadLocation(deps, caller, legacy);
  let runId = explicitRunId;
  if (!runId) {
    runId = await selectLatestRunId(deps, location, caller, storyId);
  }
  const authorityFile = getRunStatePath(location.authority.root_realpath, storyId, runId);
  const mirrorFile = location.mirror
    ? getRunStatePath(location.mirror.root_realpath, storyId, runId)
    : null;
  return {
    storyId,
    runId,
    caller,
    authorityIdentity: location.authority,
    expectedAuthorityKind: location.expectedAuthorityKind,
    authorityFile,
    mirrorFile,
    discoveredFromMirror: location.discoveredFromMirror
  };
}

async function resolveCreationBinding(deps, caller, legacy, options = {}) {
  const managed = legacy?.managed_worktree ?? {};
  const status = managed.status ?? null;
  const mode = managed.mode ?? (managed.required ? 'required' : 'preferred');
  if (mode === 'disabled' || status === 'disabled') {
    return {
      authority: caller,
      mirror: null,
      authorityKind: 'repository',
      managedWorktree: normalizeManagedBinding(managed, caller.root_realpath)
    };
  }
  if (isManagedUnavailable(managed)) {
    if (!options.newlyBootstrapped || mode === 'required') {
      throw contractError('worktree_unavailable', 'The recorded managed worktree is unavailable.', {
        path: managed.path ?? null,
        failure_reason: managed.failure_reason ?? null
      });
    }
    const normalized = normalizeManagedBinding(managed, caller.root_realpath);
    normalized.bootstrap_binding_fingerprint = buildBootstrapBindingFingerprint(normalized);
    return {
      authority: caller,
      mirror: null,
      authorityKind: 'source_fallback',
      managedWorktree: normalized
    };
  }
  if (!managed.path) {
    throw contractError('invalid_state', 'Legacy managed worktree binding has no path.', {});
  }
  const authority = await resolveIdentity(deps, managed.path, 'worktree_unavailable');
  const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
  assertAllowedCaller(caller, authority, source);
  return {
    authority,
    mirror: source.root_realpath === authority.root_realpath ? null : source,
    authorityKind: 'managed',
    managedWorktree: normalizeManagedBinding(managed, source.root_realpath)
  };
}

async function resolveReadLocation(deps, caller, legacy) {
  const managed = legacy?.managed_worktree ?? null;
  if (!managed || managed.mode === 'disabled' || managed.status === 'disabled') {
    return {
      authority: caller,
      mirror: null,
      discoveredFromMirror: false,
      expectedAuthorityKind: 'repository'
    };
  }
  if (isManagedUnavailable(managed)) {
    const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
    if (caller.root_realpath !== source.root_realpath) {
      throw contractError('worktree_mismatch', 'A source_fallback Run accepts only its recorded source root.', {
        caller_root: caller.root_realpath,
        source_root: source.root_realpath
      });
    }
    return {
      authority: source,
      mirror: null,
      discoveredFromMirror: false,
      expectedAuthorityKind: 'source_fallback'
    };
  }
  if (!managed.path) {
    throw contractError('invalid_state', 'Legacy managed worktree binding has no path.', {});
  }
  const authority = await resolveIdentity(deps, managed.path, 'worktree_unavailable');
  const source = await resolveIdentity(deps, managed.source_repo ?? caller.root_realpath, 'worktree_mismatch');
  assertAllowedCaller(caller, authority, source);
  return {
    authority,
    mirror: source.root_realpath === authority.root_realpath ? null : source,
    discoveredFromMirror: caller.root_realpath !== authority.root_realpath,
    expectedAuthorityKind: 'managed'
  };
}

async function validateAuthorityBinding(deps, caller, state, authorityIdentity, requirements = {}) {
  validateRunShape(state);
  const context = state.execution_context;
  if (requirements.storyId && state.story_id !== requirements.storyId) {
    throw contractError('invalid_state', 'Run Story identity does not match its artifact path.', {
      expected_story_id: requirements.storyId,
      story_id: state.story_id
    });
  }
  if (requirements.runId && state.run_id !== requirements.runId) {
    throw contractError('invalid_state', 'Run identity does not match its artifact path.', {
      expected_run_id: requirements.runId,
      run_id: state.run_id
    });
  }
  if (requirements.expectedAuthorityKind
      && context.authority_kind !== requirements.expectedAuthorityKind) {
    throw contractError('invalid_state', 'Run authority kind conflicts with the current execution binding.', {
      run_id: state.run_id,
      expected_authority_kind: requirements.expectedAuthorityKind,
      authority_kind: context.authority_kind
    });
  }
  if (!AUTHORITY_KINDS.has(context.authority_kind)) {
    throw contractError('invalid_state', `Unknown Run authority kind: ${context.authority_kind}.`, {
      run_id: state.run_id,
      authority_kind: context.authority_kind
    });
  }
  let actualAuthority;
  try {
    actualAuthority = await deps.resolveGitIdentity(context.root_realpath);
  } catch {
    throw contractError('worktree_unavailable', 'The recorded Run authority is unavailable.', {
      run_id: state.run_id,
      authority_root: context.root_realpath
    });
  }
  if (actualAuthority.root_realpath !== context.root_realpath
      || actualAuthority.git_dir_realpath !== context.git_dir_realpath
      || authorityIdentity.root_realpath !== context.root_realpath) {
    throw contractError('worktree_mismatch', 'The Run authority does not match its recorded worktree identity.', {
      run_id: state.run_id,
      expected_root: context.root_realpath,
      actual_root: actualAuthority.root_realpath
    });
  }
  const sourceRoot = state.managed_worktree?.source_repo ?? null;
  if (context.authority_kind === 'managed') {
    if (caller.root_realpath !== context.root_realpath && caller.root_realpath !== sourceRoot) {
      throw contractError('worktree_mismatch', 'This checkout is not an allowed control root for the managed Run.', {
        run_id: state.run_id,
        caller_root: caller.root_realpath
      });
    }
  } else if (caller.root_realpath !== context.root_realpath) {
    throw contractError('worktree_mismatch', 'This checkout is not the recorded Run authority.', {
      run_id: state.run_id,
      caller_root: caller.root_realpath
    });
  }
  if (context.authority_kind === 'source_fallback') {
    const fingerprint = state.managed_worktree?.bootstrap_binding_fingerprint;
    if (!fingerprint) {
      throw contractError('invalid_state', 'source_fallback Run is missing its bootstrap binding fingerprint.', {
        run_id: state.run_id
      });
    }
    const expected = buildBootstrapBindingFingerprint(state.managed_worktree);
    if (fingerprint !== expected) {
      throw contractError('worktree_mismatch', 'source_fallback binding fingerprint does not match.', {
        run_id: state.run_id
      });
    }
    const legacy = await readLegacyState(deps, context.root_realpath, state.story_id);
    if (!legacy?.managed_worktree || !isManagedUnavailable(legacy.managed_worktree)) {
      throw contractError('worktree_mismatch', 'source_fallback no longer matches an unavailable legacy binding.', {
        run_id: state.run_id
      });
    }
    if (buildBootstrapBindingFingerprint(normalizeManagedBinding(legacy.managed_worktree, context.root_realpath)) !== fingerprint) {
      throw contractError('worktree_mismatch', 'Current unavailable binding does not match the recorded source_fallback.', {
        run_id: state.run_id
      });
    }
  }
  if (requirements.requireCurrentHead && actualAuthority.head_sha !== state.current_head_sha) {
    throw contractError('stale_head', 'The authoritative worktree HEAD changed after this Run was recorded.', {
      run_id: state.run_id,
      expected_head_sha: state.current_head_sha,
      actual_head_sha: actualAuthority.head_sha
    });
  }
}

function buildInitialState({ storyId, runId, createdAt, binding }) {
  return {
    schema_version: GUARDED_RUN_SCHEMA_VERSION,
    run_id: runId,
    story_id: storyId,
    target: GUARDED_RUN_TARGET,
    autonomy_mode: GUARDED_AUTONOMY_MODE,
    created_at: createdAt,
    updated_at: createdAt,
    status: 'running',
    stop_reason: null,
    attempt: 1,
    iteration: 0,
    budget: { max_attempts: 1, max_iterations: 0 },
    deadline: null,
    last_progress_at: createdAt,
    pending_decision: null,
    current_head_sha: binding.authority.head_sha,
    execution_context: {
      authority_kind: binding.authorityKind,
      root_realpath: binding.authority.root_realpath,
      git_dir_realpath: binding.authority.git_dir_realpath
    },
    managed_worktree: binding.managedWorktree,
    transitions: [{
      sequence: 1,
      from: null,
      to: 'running',
      reason: 'run_created',
      timestamp: createdAt
    }]
  };
}

function applyTransition(state, to, reason, timestamp, patch = {}) {
  if (!STATUS_VALUES.has(state.status)) {
    throw contractError('unknown_status', `Unknown Run status: ${state.status}.`, {
      run_id: state.run_id,
      status: state.status
    });
  }
  if (!STATUS_VALUES.has(to)) {
    throw contractError('unknown_status', `Unknown Run status: ${to}.`, { run_id: state.run_id, status: to });
  }
  if (state.status === to && to === 'pr_ready') return state;
  if (!isAllowedTransition(state.status, to, reason)) {
    throw contractError('invalid_transition', `Run cannot transition from ${state.status} to ${to}.`, {
      run_id: state.run_id,
      from: state.status,
      to
    });
  }
  return {
    ...state,
    ...patch,
    status: to,
    updated_at: timestamp,
    last_progress_at: timestamp,
    transitions: [...state.transitions, {
      sequence: state.transitions.length + 1,
      from: state.status,
      to,
      reason,
      timestamp
    }]
  };
}

function isAllowedTransition(from, to, reason) {
  if (from === 'pr_ready') return to === 'pr_ready';
  if (from === 'cancelled') return false;
  if (from === 'failed' && to === 'running') return reason === 'operator_resume';
  if (from === 'running') return RECOVERABLE_STATUSES.has(to) || to === 'cancelled' || to === 'pr_ready';
  if (RECOVERABLE_STATUSES.has(from)) {
    return to === 'running'
      || (RECOVERABLE_STATUSES.has(to) && to !== from)
      || to === 'cancelled'
      || to === 'pr_ready';
  }
  return false;
}

async function persistAuthorityThenMirror(deps, state, authorityFile, mirrorFile) {
  validateRunShape(state);
  const raw = serializeState(state);
  await writeRawAtomic(deps, authorityFile, raw);
  if (!mirrorFile) return;
  try {
    await writeRawAtomic(deps, mirrorFile, raw);
  } catch (error) {
    throw contractError('linked_copy_sync_failed', 'Run authority committed but linked mirror synchronization failed.', {
      run_id: state.run_id,
      story_id: state.story_id,
      authority_artifact: authorityFile,
      mirror_artifact: mirrorFile,
      cause: error.message
    });
  }
}

async function writeRawAtomic(deps, filePath, raw) {
  await deps.artifactIo.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await deps.artifactIo.writeFile(tempPath, raw);
    await deps.artifactIo.rename(tempPath, filePath);
  } catch (error) {
    await deps.artifactIo.rm(tempPath, { force: true }).catch(() => null);
    throw error;
  }
}

async function parseAndMaybeQuarantine(deps, raw, filePath) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const quarantine = `${filePath}.corrupt-${formatRunTimestamp(toIso(deps.now()))}`;
    await deps.artifactIo.rename(filePath, quarantine);
    throw contractError('corrupt_state', 'Guarded Run state is corrupt and was quarantined.', {
      artifact: filePath,
      quarantine_artifact: quarantine
    });
  }
}

function migrateRunState(state) {
  if (state.schema_version === GUARDED_RUN_SCHEMA_VERSION) {
    validateRunShape(state);
    return { changed: false, state };
  }
  if (state.schema_version !== undefined && state.schema_version !== '0.0.0') {
    throw contractError('unsupported_schema', `Unsupported guarded Run schema: ${state.schema_version}.`, {
      run_id: state.run_id ?? null,
      schema_version: state.schema_version ?? null
    });
  }
  const migrated = { ...state, schema_version: GUARDED_RUN_SCHEMA_VERSION };
  validateRunShape(migrated);
  return { changed: true, state: migrated };
}

function validateRunShape(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw contractError('invalid_state', 'Guarded Run state must be an object.', {});
  }
  const required = [
    'schema_version', 'run_id', 'story_id', 'target', 'autonomy_mode', 'created_at', 'updated_at',
    'status', 'stop_reason', 'attempt', 'iteration', 'budget', 'deadline', 'last_progress_at',
    'pending_decision', 'current_head_sha', 'execution_context', 'managed_worktree', 'transitions'
  ];
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(state, key));
  if (missing.length > 0) {
    throw contractError('invalid_state', 'Guarded Run state is missing required fields.', {
      run_id: state.run_id ?? null,
      missing
    });
  }
  if (state.schema_version !== GUARDED_RUN_SCHEMA_VERSION) {
    throw contractError('unsupported_schema', `Unsupported guarded Run schema: ${state.schema_version}.`, {
      run_id: state.run_id ?? null,
      schema_version: state.schema_version
    });
  }
  requireRunId(state.run_id);
  requireStoryId(state.story_id);
  if (state.target !== GUARDED_RUN_TARGET || state.autonomy_mode !== GUARDED_AUTONOMY_MODE) {
    throw contractError('invalid_state', 'Guarded Run target or autonomy mode is invalid.', {
      run_id: state.run_id
    });
  }
  if (!STATUS_VALUES.has(state.status)) {
    throw contractError('unknown_status', `Unknown Run status: ${state.status}.`, {
      run_id: state.run_id,
      status: state.status
    });
  }
  if (!Number.isInteger(state.attempt) || state.attempt < 1
      || !Number.isInteger(state.iteration) || state.iteration < 0
      || !Number.isInteger(state.budget?.max_attempts) || state.budget.max_attempts < 1
      || !Number.isInteger(state.budget?.max_iterations) || state.budget.max_iterations < 0) {
    throw contractError('invalid_state', 'Guarded Run counters or budget are invalid.', { run_id: state.run_id });
  }
  if (!isIsoTimestamp(state.created_at) || !isIsoTimestamp(state.updated_at) || !isIsoTimestamp(state.last_progress_at)) {
    throw contractError('invalid_state', 'Guarded Run timestamps are invalid.', { run_id: state.run_id });
  }
  if (!state.current_head_sha || typeof state.current_head_sha !== 'string') {
    throw contractError('invalid_state', 'Guarded Run current_head_sha is invalid.', { run_id: state.run_id });
  }
  if (!state.execution_context || typeof state.execution_context !== 'object'
      || !state.execution_context.authority_kind
      || !state.execution_context.root_realpath
      || !state.execution_context.git_dir_realpath) {
    throw contractError('invalid_state', 'Guarded Run execution context is invalid.', { run_id: state.run_id });
  }
  if (!AUTHORITY_KINDS.has(state.execution_context.authority_kind)) {
    throw contractError('invalid_state', `Unknown Run authority kind: ${state.execution_context.authority_kind}.`, {
      run_id: state.run_id
    });
  }
  if (!state.managed_worktree || typeof state.managed_worktree !== 'object' || Array.isArray(state.managed_worktree)) {
    throw contractError('invalid_state', 'Guarded Run managed worktree snapshot is invalid.', { run_id: state.run_id });
  }
  if (state.execution_context.authority_kind === 'source_fallback'
      && typeof state.managed_worktree.bootstrap_binding_fingerprint !== 'string') {
    throw contractError('invalid_state', 'source_fallback Run is missing its bootstrap binding fingerprint.', {
      run_id: state.run_id
    });
  }
  if (!Array.isArray(state.transitions) || state.transitions.length === 0) {
    throw contractError('invalid_state', 'Guarded Run transition history is invalid.', { run_id: state.run_id });
  }
  for (let index = 0; index < state.transitions.length; index += 1) {
    const transition = state.transitions[index];
    const previous = index === 0 ? null : state.transitions[index - 1];
    if (transition?.sequence !== index + 1
        || (index === 0 ? transition.from !== null : transition.from !== previous.to)
        || !STATUS_VALUES.has(transition.to)
        || typeof transition.reason !== 'string'
        || !isIsoTimestamp(transition.timestamp)) {
      throw contractError('invalid_state', 'Guarded Run transition history is inconsistent.', {
        run_id: state.run_id,
        sequence: index + 1
      });
    }
    if ((index === 0 && (transition.to !== 'running' || transition.reason !== 'run_created'))
        || (index > 0 && !isAllowedTransition(previous.to, transition.to, transition.reason))) {
      throw contractError('invalid_state', 'Guarded Run transition history contains a forbidden transition.', {
        run_id: state.run_id,
        sequence: index + 1,
        from: transition.from,
        to: transition.to
      });
    }
  }
  if (state.transitions.at(-1).to !== state.status) {
    throw contractError('invalid_state', 'Guarded Run status does not match its last transition.', {
      run_id: state.run_id
    });
  }
  if (state.stop_reason !== null && !isTypedStopReason(state.stop_reason)) {
    throw contractError('invalid_state', 'Guarded Run stop_reason is invalid.', { run_id: state.run_id });
  }
  if (state.deadline !== null && !isIsoTimestamp(state.deadline)) {
    throw contractError('invalid_state', 'Guarded Run deadline is invalid.', { run_id: state.run_id });
  }
  if (state.pending_decision !== null && !isPlainRecord(state.pending_decision)) {
    throw contractError('invalid_state', 'Guarded Run pending_decision is invalid.', { run_id: state.run_id });
  }
}

async function selectLatestRunId(deps, location, caller, storyId) {
  const authorityRoot = location.authority.root_realpath;
  const runsRoot = getRunsRoot(authorityRoot, storyId);
  let entries;
  try {
    entries = await deps.artifactIo.readdir(runsRoot);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw contractError('run_not_found', 'No guarded Runs exist for this Story.', { story_id: storyId });
    }
    throw error;
  }
  const candidates = [];
  const rejectedCandidates = [];
  for (const runId of entries.filter((entry) => RUN_ID_PATTERN.test(entry))) {
    const filePath = getRunStatePath(authorityRoot, storyId, runId);
    const raw = await readOptionalFile(deps, filePath);
    if (raw === null) {
      rejectedCandidates.push({
        run_id: runId,
        code: 'invalid_state',
        message: 'Guarded Run directory has no state artifact.',
        artifact: filePath
      });
      continue;
    }
    let state;
    try {
      try {
        state = JSON.parse(raw);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw contractError('corrupt_state', 'Guarded Run state is corrupt.', { artifact: filePath });
      }
      state = migrateRunState(state).state;
      await validateAuthorityBinding(deps, caller, state, location.authority, {
        storyId,
        runId,
        expectedAuthorityKind: location.expectedAuthorityKind
      });
    } catch (error) {
      if (!isGuardedRunError(error)) throw error;
      rejectedCandidates.push({
        run_id: runId,
        code: error.code,
        message: error.message,
        artifact: error.details?.artifact ?? filePath
      });
      continue;
    }
    candidates.push({ runId, createdAt: state.created_at });
  }
  if (rejectedCandidates.length > 0) {
    throw contractError(
      'run_selection_blocked',
      'Implicit Run selection found rejected candidates; inspect them and select a validated Run explicitly.',
      { story_id: storyId, rejected_candidates: rejectedCandidates }
    );
  }
  candidates.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.runId.localeCompare(left.runId));
  if (candidates.length === 0) {
    throw contractError('run_not_found', 'No guarded Runs exist for this Story.', { story_id: storyId });
  }
  return candidates[0].runId;
}

async function assertRegisteredStory(deps, repoRoot, storyId) {
  const configPath = path.join(getWorkspaceDir(repoRoot), 'config.json');
  const raw = await readRequiredFile(deps, configPath, 'invalid_story_id', 'VibePro Story catalog is unavailable.', {
    story_id: storyId
  });
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw contractError('invalid_story_id', 'VibePro Story catalog is invalid.', { story_id: storyId });
  }
  const registered = Array.isArray(config?.brainbase?.stories)
    && config.brainbase.stories.some((story) => story?.story_id === storyId);
  if (!registered) {
    throw contractError('invalid_story_id', 'Story is not registered in the VibePro catalog.', { story_id: storyId });
  }
}

async function readLegacyState(deps, repoRoot, storyId) {
  const raw = await readOptionalFile(deps, getLegacyStatePath(repoRoot, storyId));
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw contractError('invalid_state', 'Legacy execution state is invalid JSON.', {
      story_id: storyId,
      cause: error.message
    });
  }
}

async function readOptionalFile(deps, filePath) {
  try {
    return await deps.artifactIo.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function readRequiredFile(deps, filePath, code, message, details) {
  const raw = await readOptionalFile(deps, filePath);
  if (raw === null) throw contractError(code, message, details);
  return raw;
}

function normalizeManagedBinding(managed = {}, sourceRoot) {
  return {
    status: managed.status ?? null,
    required: managed.required ?? managed.mode === 'required',
    mode: managed.mode ?? (managed.required ? 'required' : 'preferred'),
    source_repo: path.resolve(sourceRoot ?? managed.source_repo),
    source_relative_path: managed.source_relative_path ?? null,
    path: managed.path ? path.resolve(managed.path) : null,
    relative_path: managed.relative_path ?? null,
    branch: managed.branch ?? null,
    actual_branch: managed.actual_branch ?? null,
    branch_match: managed.branch_match ?? null,
    base_ref: managed.base_ref ?? null,
    created_from_sha: managed.created_from_sha ?? null,
    current_head_sha: managed.current_head_sha ?? null,
    dirty: managed.dirty ?? null,
    dirty_paths: managed.dirty_paths ?? [],
    dirty_check_error: managed.dirty_check_error ?? null,
    failure_reason: managed.failure_reason ?? null,
    ...(managed.bootstrap_binding_fingerprint
      ? { bootstrap_binding_fingerprint: managed.bootstrap_binding_fingerprint }
      : {})
  };
}

export function buildBootstrapBindingFingerprint(managed) {
  const tuple = {
    status: managed?.status ?? null,
    mode: managed?.mode ?? null,
    source_repo: managed?.source_repo ? path.resolve(managed.source_repo) : null,
    relative_path: managed?.relative_path ?? null,
    branch: managed?.branch ?? null,
    actual_branch: managed?.actual_branch ?? null,
    base_ref: managed?.base_ref ?? null,
    created_from_sha: managed?.created_from_sha ?? null,
    current_head_sha: managed?.current_head_sha ?? null,
    failure_reason: managed?.failure_reason ?? null
  };
  return createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
}

function isManagedUnavailable(managed) {
  return managed?.status === 'unavailable'
    || managed?.status === 'failed'
    || Boolean(managed?.failure_reason)
    || (!managed?.path && managed?.mode !== 'disabled' && managed?.status !== 'disabled');
}

function assertAllowedCaller(caller, authority, source) {
  if (caller.root_realpath !== authority.root_realpath && caller.root_realpath !== source.root_realpath) {
    throw contractError('worktree_mismatch', 'This checkout is not an allowed managed Run control root.', {
      caller_root: caller.root_realpath,
      authority_root: authority.root_realpath,
      source_root: source.root_realpath
    });
  }
}

async function resolveIdentity(deps, repoRoot, errorCode) {
  try {
    return await deps.resolveGitIdentity(path.resolve(repoRoot));
  } catch (error) {
    throw contractError(errorCode, 'Unable to resolve the Git worktree identity.', {
      path: path.resolve(repoRoot),
      cause: error.message
    });
  }
}

function requireStoryId(value) {
  const storyId = String(value ?? '').trim();
  if (!STORY_ID_PATTERN.test(storyId)
      || storyId.includes('..')
      || /[\\/%]/.test(storyId)
      || decodeSafely(storyId) !== storyId) {
    throw contractError('invalid_story_id', 'A valid registered Story id is required.', {
      story_id: value ?? null
    });
  }
  return storyId;
}

function requireRunId(value) {
  const runId = String(value ?? '').trim();
  if (!RUN_ID_PATTERN.test(runId)
      || /[\\/%]/.test(runId)
      || decodeSafely(runId) !== runId) {
    throw contractError('invalid_run_id', 'A valid guarded Run id is required.', {
      run_id: value ?? null
    });
  }
  return runId;
}

function decodeSafely(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function generateRunId(createdAt, randomBytes) {
  const suffix = Buffer.from(randomBytes(4)).toString('hex');
  if (!/^[0-9a-f]{8}$/.test(suffix)) throw new Error('randomBytes must provide exactly four bytes');
  return `run-${formatRunTimestamp(createdAt)}-${suffix}`;
}

function formatRunTimestamp(iso) {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('now dependency returned an invalid date');
  return date.toISOString();
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isTypedStopReason(value) {
  if (!isPlainRecord(value)
      || typeof value.code !== 'string' || value.code.length === 0
      || typeof value.message !== 'string' || value.message.length === 0) {
    return false;
  }
  return !Object.prototype.hasOwnProperty.call(value, 'details') || isPlainRecord(value.details);
}

function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function getRunsRoot(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'runs');
}

function getRunStatePath(repoRoot, storyId, runId) {
  return path.join(getRunsRoot(repoRoot, storyId), runId, 'state.json');
}

function getLegacyStatePath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'state.json');
}

function getCreationLockPath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, '.run-creation.lock');
}

function contractError(code, message, details = {}) {
  return new GuardedRunError(code, message, details);
}

function assertClosedKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} set must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`Unknown ${label} key(s): ${unknown.join(', ')}`);
  }
}
