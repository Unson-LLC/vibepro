import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createGuardedRunSession } from './guarded-run-session.js';
import { getWorkspaceDir } from './workspace.js';

export const STORY_RUN_PORTFOLIO_SCHEMA_VERSION = '0.1.0';

const PORTFOLIO_ID = /^portfolio-[a-z0-9][a-z0-9._-]*$/;
const STORY_ID = /^story-[a-z0-9][a-z0-9._-]*$/;
const TERMINAL = new Set(['pr_ready']);
const STOPPED = new Set(['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed', 'cancelled']);
const DECISIONS = new Set(['continue', 'skip', 'retry']);
const DEPENDENCY_KEYS = new Set(['now', 'randomBytes', 'guardedRun', 'guardedRunDependencies', 'readFile', 'writeFile', 'rename', 'mkdir', 'realpath', 'rm', 'isProcessAlive']);
let lockNonce = 0;

export class StoryRunPortfolioError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'StoryRunPortfolioError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { status: 'error', stop_reason: { code: this.code, message: this.message, details: this.details } };
  }
}

export function createStoryRunPortfolioController(dependencies = {}) {
  const unknown = Object.keys(dependencies).filter((key) => !DEPENDENCY_KEYS.has(key));
  if (unknown.length > 0) throw new TypeError(`Unknown Story Run Portfolio dependency key(s): ${unknown.join(', ')}`);
  const deps = {
    now: dependencies.now ?? (() => new Date()),
    randomBytes: dependencies.randomBytes ?? nodeRandomBytes,
    guardedRun: dependencies.guardedRun ?? createGuardedRunSession(dependencies.guardedRunDependencies ?? {}),
    readFile: dependencies.readFile ?? readFile,
    writeFile: dependencies.writeFile ?? writeFile,
    rename: dependencies.rename ?? rename,
    mkdir: dependencies.mkdir ?? mkdir,
    realpath: dependencies.realpath ?? realpath,
    rm: dependencies.rm ?? rm,
    isProcessAlive: dependencies.isProcessAlive ?? isProcessAlive
  };
  return {
    create: async (repoRoot, options = {}) => {
      const portfolioId = options.portfolioId ?? generatedId(iso(deps.now()), deps.randomBytes);
      const lockedOptions = { ...options, portfolioId };
      return withPortfolioLock(deps, repoRoot, lockedOptions, () => createPortfolio(deps, repoRoot, lockedOptions));
    },
    status: (repoRoot, options) => readPortfolio(deps, repoRoot, options),
    advance: (repoRoot, options) => withPortfolioLock(deps, repoRoot, options, () => advancePortfolio(deps, repoRoot, options)),
    decide: (repoRoot, options) => withPortfolioLock(deps, repoRoot, options, () => decidePortfolio(deps, repoRoot, options)),
    promote: (repoRoot, options) => withPortfolioLock(deps, repoRoot, options, () => promoteContext(deps, repoRoot, options))
  };
}

async function createPortfolio(deps, repoRoot, options = {}) {
  const stories = [...new Set(options.storyIds ?? [])];
  if (stories.length === 0 || stories.some((id) => !STORY_ID.test(id))) {
    throw error('invalid_story_set', 'Portfolio requires one or more valid, unique Story ids.');
  }
  if (stories.length !== (options.storyIds ?? []).length) {
    throw error('duplicate_story', 'A Story can appear only once in a Portfolio.');
  }
  if ((options.mode ?? 'sequential') !== 'sequential') {
    throw error('parallel_isolation_unproven', 'Parallel Portfolio execution is rejected without an isolation proof.');
  }
  const now = iso(deps.now());
  const portfolioId = options.portfolioId;
  requirePortfolioId(portfolioId);
  const state = {
    schema_version: STORY_RUN_PORTFOLIO_SCHEMA_VERSION,
    portfolio_id: portfolioId,
    mode: 'sequential',
    status: 'running',
    created_at: now,
    updated_at: now,
    entries: stories.map((storyId, order) => ({
      story_id: storyId,
      order,
      run_id: null,
      status: 'queued',
      worktree: null,
      head_sha: null,
      cost_attribution: emptyCostAttribution(),
      stop_reason: null
    })),
    promoted_context: [],
    decision_journal: [],
    scope_bindings: {}
  };
  await persist(deps, repoRoot, state, { failIfExists: true });
  return state;
}

async function advancePortfolio(deps, repoRoot, options = {}) {
  let state = await readPortfolio(deps, repoRoot, options);
  const active = state.entries.find((entry) => entry.status === 'starting' || entry.status === 'running' || STOPPED.has(entry.status));
  if (active) {
    let run;
    if (active.status === 'starting') {
      try {
        run = await deps.guardedRun.status(repoRoot, { storyId: active.story_id });
      } catch (cause) {
        if (cause.code !== 'run_not_found') throw cause;
        run = await deps.guardedRun.run(repoRoot, { storyId: active.story_id });
      }
      if (run.story_id !== active.story_id) {
        await assertAndPersistRunOwnership(deps, repoRoot, state, active, run);
      }
      active.run_id = run.run_id;
      state.scope_bindings[active.story_id] = buildScopeBinding(run);
    } else {
      run = await deps.guardedRun.status(repoRoot, { storyId: active.story_id, runId: active.run_id });
    }
    await assertAndPersistRunOwnership(deps, repoRoot, state, active, run);
    active.status = run.status;
    active.worktree = run.execution_context?.root_realpath ?? null;
    active.head_sha = run.current_head_sha ?? null;
    active.stop_reason = run.stop_reason ?? null;
    active.cost_attribution = mergeCostAttribution(active.cost_attribution, options.costAttribution);
    if (STOPPED.has(active.status)) {
      state.status = active.status;
      state.updated_at = iso(deps.now());
      await persist(deps, repoRoot, state);
      return state;
    }
    if (active.status === 'running') {
      state.status = 'running';
      state.updated_at = iso(deps.now());
      await persist(deps, repoRoot, state);
      return state;
    }
    if (!TERMINAL.has(active.status)) {
      throw error('unknown_run_status', `Unsupported guarded Run status: ${active.status}.`);
    }
  }
  const next = state.entries.find((entry) => entry.status === 'queued');
  if (!next) {
    state.status = state.entries.every((entry) => entry.status === 'pr_ready' || entry.status === 'skipped')
      ? 'completed'
      : 'stopped';
    state.updated_at = iso(deps.now());
    await persist(deps, repoRoot, state);
    return state;
  }
  if (state.entries.some((entry) => entry.order < next.order && !['pr_ready', 'skipped'].includes(entry.status))) {
    throw error('sequential_order_violation', 'The previous Story must reach an accepted terminal state before the next Story mutates.');
  }
  next.status = 'starting';
  state.status = 'starting';
  state.updated_at = iso(deps.now());
  await persist(deps, repoRoot, state);
  const run = await deps.guardedRun.run(repoRoot, { storyId: next.story_id });
  next.run_id = run.run_id;
  next.status = run.status;
  next.worktree = run.execution_context?.root_realpath ?? null;
  next.head_sha = run.current_head_sha ?? null;
  next.stop_reason = run.stop_reason ?? null;
  state.scope_bindings[next.story_id] = buildScopeBinding(run);
  state.status = next.status;
  state.updated_at = iso(deps.now());
  await persist(deps, repoRoot, state);
  return state;
}

async function decidePortfolio(deps, repoRoot, options = {}) {
  const state = await readPortfolio(deps, repoRoot, options);
  const entry = state.entries.find((item) => item.story_id === options.storyId);
  const decision = options.decision;
  if (!entry || !STOPPED.has(entry.status)) {
    throw error('decision_not_applicable', 'A Portfolio decision requires a stopped Story entry.');
  }
  if (!DECISIONS.has(decision) || !options.policyType || !options.reason) {
    throw error('typed_policy_required', 'continue, skip, and retry require a typed policy and reason.');
  }
  if (decision === 'skip') {
    entry.status = 'skipped';
    entry.stop_reason = { code: 'explicit_skip', message: options.reason, details: { policy_type: options.policyType } };
  } else {
    const run = await deps.guardedRun.resume(repoRoot, {
      storyId: entry.story_id,
      runId: entry.run_id,
      decisionId: options.decisionId,
      answer: options.answer,
      answeredBy: options.answeredBy,
      reflectedIn: options.reflectedIn ?? []
    });
    await assertAndPersistRunOwnership(deps, repoRoot, state, entry, run);
    entry.status = run.status;
    entry.head_sha = run.current_head_sha ?? entry.head_sha;
    entry.stop_reason = run.stop_reason ?? null;
  }
  state.decision_journal.push({ story_id: entry.story_id, decision, policy_type: options.policyType, reason: options.reason, decided_at: iso(deps.now()) });
  state.status = entry.status;
  state.updated_at = iso(deps.now());
  await persist(deps, repoRoot, state);
  return state;
}

async function promoteContext(deps, repoRoot, options = {}) {
  const state = await readPortfolio(deps, repoRoot, options);
  const source = state.entries.find((entry) => entry.story_id === options.sourceStoryId);
  const consumer = state.entries.find((entry) => entry.story_id === options.consumerStoryId);
  if (!source || !consumer || source.order >= consumer.order || !options.artifactPath || !options.reason) {
    throw error('invalid_context_promotion', 'Context promotion requires an earlier source Story, later consumer Story, artifact path, and reason.');
  }
  if (options.rawTranscript || /(?:^|\/)(?:transcript|session)(?:[./-]|$)/i.test(options.artifactPath)) {
    throw error('raw_transcript_forbidden', 'Raw transcripts cannot be promoted between Story Runs.');
  }
  const absoluteArtifact = path.resolve(repoRoot, options.artifactPath);
  let realRoot;
  let realArtifact;
  try {
    [realRoot, realArtifact] = await Promise.all([
      deps.realpath(path.resolve(repoRoot)),
      deps.realpath(absoluteArtifact)
    ]);
  } catch (cause) {
    throw error('artifact_unavailable', 'Promoted context artifact must exist and be readable.', { cause: cause.code ?? cause.message });
  }
  const relativeArtifact = path.relative(realRoot, realArtifact);
  if (relativeArtifact.startsWith('..') || path.isAbsolute(relativeArtifact)) {
    throw error('artifact_outside_repository', 'Promoted context artifact must stay inside the repository.');
  }
  if (/(?:^|\/)(?:transcript|session)(?:[./-]|$)/i.test(relativeArtifact)) {
    throw error('raw_transcript_forbidden', 'Raw transcripts cannot be promoted between Story Runs.');
  }
  let artifactContent;
  try {
    artifactContent = await deps.readFile(realArtifact);
  } catch (cause) {
    throw error('artifact_unavailable', 'Promoted context artifact must exist and be readable.', { cause: cause.code ?? cause.message });
  }
  const actualDigest = createHash('sha256').update(artifactContent).digest('hex');
  if (options.digest && !/^[a-f0-9]{64}$/.test(options.digest)) throw error('invalid_digest', 'Promoted context digest must be sha256 hex.');
  if (options.digest && options.digest !== actualDigest) {
    throw error('digest_mismatch', 'Promoted context digest does not match the artifact content.', { expected: options.digest, actual: actualDigest });
  }
  const digest = actualDigest;
  state.promoted_context.push({
    source_story_id: source.story_id,
    artifact_path: options.artifactPath,
    digest,
    consumer_story_id: consumer.story_id,
    reason: options.reason,
    promoted_at: iso(deps.now())
  });
  state.updated_at = iso(deps.now());
  await persist(deps, repoRoot, state);
  return state;
}

function buildScopeBinding(run) {
  return {
    branch: run.execution_context?.branch ?? run.execution_context?.branch_name ?? null,
    worktree: run.execution_context?.root_realpath ?? null
  };
}

function assertRunOwnership(entry, run, binding = {}) {
  const branch = run.execution_context?.branch ?? run.execution_context?.branch_name ?? null;
  const mixedReviews = (run.review_artifacts ?? []).some((artifact) => artifact.story_id !== entry.story_id || artifact.run_id && artifact.run_id !== entry.run_id);
  const mixedSessions = (run.session_attribution ?? []).some((session) => session.story_id !== entry.story_id || session.run_id && session.run_id !== entry.run_id);
  const contaminated = run.story_id !== entry.story_id
    || run.run_id !== entry.run_id
    || (entry.worktree && run.execution_context?.root_realpath !== entry.worktree)
    || (binding.worktree && run.execution_context?.root_realpath !== binding.worktree)
    || (binding.branch && branch !== binding.branch)
    || mixedReviews
    || mixedSessions;
  if (contaminated) {
    throw error('scope_contamination', 'Guarded Run identity does not match its Portfolio entry.', {
      expected: { story_id: entry.story_id, run_id: entry.run_id, worktree: entry.worktree, head_sha: entry.head_sha },
      actual: { story_id: run.story_id, run_id: run.run_id, worktree: run.execution_context?.root_realpath, branch, head_sha: run.current_head_sha, mixed_reviews: mixedReviews, mixed_sessions: mixedSessions }
    });
  }
}

async function assertAndPersistRunOwnership(deps, repoRoot, state, entry, run) {
  try {
    assertRunOwnership(entry, run, state.scope_bindings[entry.story_id]);
  } catch (cause) {
    if (cause.code !== 'scope_contamination') throw cause;
    entry.status = 'blocked';
    entry.stop_reason = { code: cause.code, message: cause.message, details: cause.details };
    state.status = 'blocked';
    state.updated_at = iso(deps.now());
    await persist(deps, repoRoot, state);
    throw cause;
  }
}

function emptyCostAttribution() {
  return {
    trusted_pr_ready_ms: null,
    active_ms: null,
    wait_ms: null,
    total_tokens: null,
    cost_usd: null,
    full_suite_count: 0,
    evidence_reuse_count: 0,
    human_interruption_count: 0
  };
}

function mergeCostAttribution(current, next) {
  if (!next) return current;
  const allowed = Object.keys(emptyCostAttribution());
  if (Object.keys(next).some((key) => !allowed.includes(key))) throw error('invalid_cost_attribution', 'Unknown cost attribution field.');
  return { ...current, ...next };
}

async function readPortfolio(deps, repoRoot, options = {}) {
  const portfolioId = requirePortfolioId(options.portfolioId);
  try {
    const state = JSON.parse(await deps.readFile(statePath(repoRoot, portfolioId), 'utf8'));
    validateState(state, portfolioId);
    return state;
  } catch (cause) {
    if (cause.code === 'ENOENT') throw error('portfolio_not_found', `Portfolio not found: ${portfolioId}.`);
    if (cause instanceof StoryRunPortfolioError) throw cause;
    throw error('invalid_portfolio_state', `Portfolio state is invalid: ${cause.message}.`);
  }
}

function validateState(state, portfolioId) {
  if (state.schema_version !== STORY_RUN_PORTFOLIO_SCHEMA_VERSION || state.portfolio_id !== portfolioId || state.mode !== 'sequential' || !Array.isArray(state.entries) || !state.scope_bindings || typeof state.scope_bindings !== 'object') {
    throw error('invalid_portfolio_state', 'Portfolio state does not match the closed schema.');
  }
  for (const [order, entry] of state.entries.entries()) {
    if (entry.order !== order || !STORY_ID.test(entry.story_id) || !Object.hasOwn(entry, 'cost_attribution') || !Object.hasOwn(entry, 'stop_reason')) {
      throw error('invalid_portfolio_state', 'Portfolio entry does not match the closed schema.');
    }
  }
}

async function persist(deps, repoRoot, state, options = {}) {
  const file = statePath(repoRoot, state.portfolio_id);
  await deps.mkdir(path.dirname(file), { recursive: true });
  if (options.failIfExists) {
    try {
      await deps.readFile(file, 'utf8');
      throw error('portfolio_exists', `Portfolio already exists: ${state.portfolio_id}.`);
    } catch (cause) {
      if (cause instanceof StoryRunPortfolioError) throw cause;
      if (cause.code !== 'ENOENT') throw cause;
    }
  }
  const temporary = `${file}.tmp-${process.pid}-${deps.randomBytes(8).toString('hex')}`;
  await deps.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await deps.rename(temporary, file);
}

async function withPortfolioLock(deps, repoRoot, options, operation) {
  const portfolioId = requirePortfolioId(options?.portfolioId);
  const lock = `${statePath(repoRoot, portfolioId)}.lock`;
  await deps.mkdir(path.dirname(lock), { recursive: true });
  const token = `${deps.randomBytes(12).toString('hex')}-${process.pid}-${lockNonce += 1}`;
  await acquirePortfolioLock(deps, lock, portfolioId, token);
  try {
    return await operation();
  } finally {
    try {
      const owner = JSON.parse(await deps.readFile(path.join(lock, 'owner.json'), 'utf8'));
      if (owner.token !== token) {
        throw error('portfolio_lock_ownership_lost', `Portfolio lock owner changed before release: ${portfolioId}.`, { expected_token: token, actual_token: owner.token });
      }
      await deps.rm(lock, { recursive: true, force: true });
    } catch (cause) {
      if (cause instanceof StoryRunPortfolioError) throw cause;
      throw error('portfolio_lock_cleanup_failed', `Portfolio lock cleanup failed: ${portfolioId}.`, { cause: cause.code ?? cause.message });
    }
  }
}

async function acquirePortfolioLock(deps, lock, portfolioId, token, recovered = false) {
  const candidate = `${lock}.candidate-${process.pid}-${token}`;
  await deps.mkdir(candidate);
  await deps.writeFile(path.join(candidate, 'owner.json'), `${JSON.stringify({ schema_version: 1, pid: process.pid, token, acquired_at: iso(deps.now()) }, null, 2)}\n`);
  try {
    await deps.rename(candidate, lock);
    return;
  } catch (cause) {
    await deps.rm(candidate, { recursive: true, force: true });
    if (!['EEXIST', 'ENOTEMPTY'].includes(cause.code)) throw cause;
  }

  let owner;
  try {
    owner = JSON.parse(await deps.readFile(path.join(lock, 'owner.json'), 'utf8'));
  } catch (cause) {
    throw error('portfolio_lock_recovery_required', `Portfolio lock ownership cannot be verified: ${portfolioId}.`, { lock, cause: cause.code ?? cause.message });
  }
  if (!Number.isInteger(owner.pid) || !owner.token || deps.isProcessAlive(owner.pid)) {
    throw error('portfolio_busy', `Portfolio is already being mutated: ${portfolioId}.`, { owner });
  }
  if (recovered) throw error('portfolio_lock_recovery_failed', `Orphaned Portfolio lock could not be recovered: ${portfolioId}.`, { owner });

  const orphan = `${lock}.orphan-${process.pid}-${token}`;
  try {
    await deps.rename(lock, orphan);
  } catch (cause) {
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(cause.code)) {
      throw error('portfolio_busy', `Portfolio lock changed during recovery: ${portfolioId}.`);
    }
    throw cause;
  }
  let movedOwner;
  try {
    movedOwner = JSON.parse(await deps.readFile(path.join(orphan, 'owner.json'), 'utf8'));
  } catch (cause) {
    throw error('portfolio_lock_recovery_failed', `Recovered Portfolio lock ownership is unreadable: ${portfolioId}.`, { cause: cause.code ?? cause.message });
  }
  if (movedOwner.token !== owner.token) {
    try {
      await deps.rename(orphan, lock);
    } catch (cause) {
      throw error('portfolio_lock_recovery_failed', `Portfolio lock changed during owner verification: ${portfolioId}.`, { expected_token: owner.token, actual_token: movedOwner.token, cause: cause.code ?? cause.message });
    }
    throw error('portfolio_busy', `Portfolio lock owner changed during recovery: ${portfolioId}.`, { owner: movedOwner });
  }
  await deps.rm(orphan, { recursive: true, force: true });
  return acquirePortfolioLock(deps, lock, portfolioId, token, true);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return cause.code === 'EPERM';
  }
}

function statePath(repoRoot, portfolioId) {
  return path.join(getWorkspaceDir(repoRoot), 'portfolios', portfolioId, 'state.json');
}

function generatedId(now, randomBytes) {
  return `portfolio-${now.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').toLowerCase()}-${randomBytes(4).toString('hex')}`;
}

function requirePortfolioId(value) {
  if (!PORTFOLIO_ID.test(value ?? '')) throw error('invalid_portfolio_id', 'A valid --portfolio-id is required.');
  return value;
}

function iso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function error(code, message, details = {}) {
  return new StoryRunPortfolioError(code, message, details);
}

export function renderStoryRunPortfolioSummary(state) {
  const lines = [`Portfolio ${state.portfolio_id}: ${state.status} (${state.mode})`];
  for (const entry of state.entries) {
    const cost = entry.cost_attribution;
    lines.push(`${entry.order + 1}. ${entry.story_id}: ${entry.status} run=${entry.run_id ?? '-'} worktree=${entry.worktree ?? '-'} head=${entry.head_sha ?? '-'}`);
    lines.push(`   trusted_pr_ready_ms=${cost.trusted_pr_ready_ms ?? 'unknown'} active_ms=${cost.active_ms ?? 'unknown'} wait_ms=${cost.wait_ms ?? 'unknown'} tokens=${cost.total_tokens ?? 'unknown'} cost_usd=${cost.cost_usd ?? 'unknown'} full_suite=${cost.full_suite_count} evidence_reuse=${cost.evidence_reuse_count} human_interruptions=${cost.human_interruption_count}`);
    if (entry.stop_reason) {
      lines.push(`   stop_reason=${entry.stop_reason.code}: ${entry.stop_reason.message}`);
      lines.push(`   next_action=vibepro execute portfolio-decide . --portfolio-id ${state.portfolio_id} --story-id ${entry.story_id} --decision <continue|retry|skip> --policy-type <type> --reason <reason>`);
    }
  }
  return `${lines.join('\n')}\n`;
}
