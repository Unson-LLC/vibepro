import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createGuardedRunSession, deriveRunEfficiencyMetrics } from './guarded-run-session.js';
import { aggregateDeliveryMetrics } from './delivery-efficiency-guardrail.js';
import { getWorkspaceDir } from './workspace.js';

export const STORY_RUN_PORTFOLIO_SCHEMA_VERSION = '0.1.0';

const PORTFOLIO_ID = /^portfolio-[a-z0-9][a-z0-9._-]*$/;
const STORY_ID = /^story-[a-z0-9][a-z0-9._-]*$/;
const TERMINAL = new Set(['pr_ready']);
const STOPPED = new Set(['waiting_for_human', 'waiting_for_runtime', 'blocked', 'failed', 'cancelled']);
const ENTRY_STATUSES = new Set(['queued', 'starting', 'running', 'pr_ready', 'skipped', ...STOPPED]);
const PORTFOLIO_STATUSES = new Set(['queued', 'starting', 'running', 'completed', 'skipped', ...STOPPED]);
const DECISIONS = new Set(['continue', 'skip', 'retry']);
const STATE_KEYS = ['schema_version', 'portfolio_id', 'mode', 'status', 'created_at', 'updated_at', 'entries', 'promoted_context', 'decision_journal', 'scope_bindings'];
const ENTRY_KEYS = ['story_id', 'order', 'run_id', 'status', 'worktree', 'head_sha', 'cost_attribution', 'stop_reason'];
const COST_KEYS = Object.keys(emptyCostAttribution());
const COST_AGGREGATION_INPUT_KEYS = new Set(['run_started_at', 'trusted_pr_ready_at', 'reviews', 'review_dispatches_by_role', 'attribution_status']);
const COUNT_COST_KEYS = new Set([
  'subagent_count', 'review_dispatch_count', 'accepted_finding_count', 'repair_batch_count', 'full_suite_count',
  'expensive_verification_count', 'evidence_reuse_count', 'evidence_invalidation_count',
  'human_interruption_count', 'efficiency_debt_count', 'accepted_defect_count', 'risk_reduction_count'
]);
const PROMOTED_CONTEXT_KEYS = ['source_story_id', 'artifact_path', 'digest', 'consumer_story_id', 'reason', 'promoted_at'];
const DECISION_JOURNAL_KEYS = ['story_id', 'decision', 'policy_type', 'reason', 'decided_at'];
const DEPENDENCY_KEYS = new Set(['now', 'randomBytes', 'guardedRun', 'guardedRunDependencies', 'readFile', 'writeFile', 'rename', 'mkdir', 'realpath', 'lstat', 'rm', 'isProcessAlive']);
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
    lstat: dependencies.lstat ?? lstat,
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
    status: 'queued',
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
      const creationRequestId = state.scope_bindings[active.story_id]?.creation_request_id;
      if (!creationRequestId) throw error('starting_identity_missing', `Starting Portfolio entry has no creation request identity: ${active.story_id}.`);
      run = await deps.guardedRun.run(repoRoot, { storyId: active.story_id, creationRequestId });
      if (run.story_id !== active.story_id || run.creation_request_id !== creationRequestId || !run.run_id) {
        await persistInitialRunContamination(deps, repoRoot, state, active, run, creationRequestId);
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
    try {
      const derivedCost = Object.fromEntries(
        Object.entries(deriveRunEfficiencyMetrics(run)).filter(([key, value]) => key === 'story_id' || key === 'run_id' || value !== null)
      );
      active.cost_attribution = mergeCostAttribution(active.cost_attribution, derivedCost, active);
      active.cost_attribution = mergeCostAttribution(active.cost_attribution, options.costAttribution, active);
    } catch (cause) {
      if (cause.code !== 'scope_contamination') throw cause;
      active.status = 'blocked';
      active.stop_reason = { code: cause.code, message: cause.message, details: cause.details };
      state.status = 'blocked';
      state.updated_at = iso(deps.now());
      await persist(deps, repoRoot, state);
      throw cause;
    }
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
    if (!state.entries.every((entry) => entry.status === 'pr_ready' || entry.status === 'skipped')) {
      throw error('invalid_portfolio_state', 'Portfolio has no queued entry but is not terminal.');
    }
    state.status = 'completed';
    state.updated_at = iso(deps.now());
    await persist(deps, repoRoot, state);
    return state;
  }
  if (state.entries.some((entry) => entry.order < next.order && !['pr_ready', 'skipped'].includes(entry.status))) {
    throw error('sequential_order_violation', 'The previous Story must reach an accepted terminal state before the next Story mutates.');
  }
  next.status = 'starting';
  state.status = 'starting';
  const creationRequestId = portfolioCreationRequestId(state.portfolio_id, next.story_id, next.order);
  state.scope_bindings[next.story_id] = { status: 'starting', creation_request_id: creationRequestId };
  state.updated_at = iso(deps.now());
  await persist(deps, repoRoot, state);
  const run = await deps.guardedRun.run(repoRoot, { storyId: next.story_id, creationRequestId });
  if (run.story_id !== next.story_id || run.creation_request_id !== creationRequestId || !run.run_id) {
    await persistInitialRunContamination(deps, repoRoot, state, next, run, creationRequestId);
  }
  next.run_id = run.run_id;
  state.scope_bindings[next.story_id] = buildScopeBinding(run);
  await assertAndPersistRunOwnership(deps, repoRoot, state, next, run);
  next.status = run.status;
  next.worktree = run.execution_context?.root_realpath ?? null;
  next.head_sha = run.current_head_sha ?? null;
  next.stop_reason = run.stop_reason ?? null;
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
    const binding = state.scope_bindings[entry.story_id];
    if (entry.run_id === null && binding?.status === 'starting') {
      state.scope_bindings[entry.story_id] = { creation_request_id: binding.creation_request_id, branch: null, worktree: null };
    }
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
    creation_request_id: run.creation_request_id,
    branch: run.execution_context?.branch ?? run.execution_context?.branch_name ?? null,
    worktree: run.execution_context?.root_realpath ?? null
  };
}

function assertRunOwnership(entry, run, binding = {}) {
  const branch = run.execution_context?.branch ?? run.execution_context?.branch_name ?? null;
  const mixedMutations = hasMixedAttribution(run.mutation_artifacts, entry);
  const mixedEvidence = hasMixedAttribution(run.evidence_artifacts, entry);
  const mixedReviews = hasMixedAttribution(run.review_artifacts, entry);
  const mixedSessions = hasMixedAttribution(run.session_attribution, entry);
  const contaminated = run.story_id !== entry.story_id
    || run.run_id !== entry.run_id
    || !binding.creation_request_id
    || run.creation_request_id !== binding.creation_request_id
    || (entry.worktree && run.execution_context?.root_realpath !== entry.worktree)
    || (binding.worktree && run.execution_context?.root_realpath !== binding.worktree)
    || (binding.branch && branch !== binding.branch)
    || mixedMutations
    || mixedEvidence
    || mixedReviews
    || mixedSessions;
  if (contaminated) {
    throw error('scope_contamination', 'Guarded Run identity does not match its Portfolio entry.', {
      expected: { story_id: entry.story_id, run_id: entry.run_id, creation_request_id: binding.creation_request_id ?? null, worktree: entry.worktree, head_sha: entry.head_sha },
      actual: { story_id: run.story_id, run_id: run.run_id, creation_request_id: run.creation_request_id ?? null, worktree: run.execution_context?.root_realpath, branch, head_sha: run.current_head_sha, mixed_mutations: mixedMutations, mixed_evidence: mixedEvidence, mixed_reviews: mixedReviews, mixed_sessions: mixedSessions }
    });
  }
}

function hasMixedAttribution(artifacts = [], entry) {
  return artifacts.some((artifact) => artifact.story_id !== entry.story_id || artifact.run_id !== entry.run_id);
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

async function persistInitialRunContamination(deps, repoRoot, state, entry, run, creationRequestId) {
  const cause = error('scope_contamination', 'New Guarded Run identity does not match its Portfolio creation request.', {
    expected: { story_id: entry.story_id, creation_request_id: creationRequestId },
    actual: { story_id: run.story_id ?? null, run_id: run.run_id ?? null, creation_request_id: run.creation_request_id ?? null }
  });
  entry.status = 'blocked';
  entry.stop_reason = { code: cause.code, message: cause.message, details: cause.details };
  state.status = 'blocked';
  state.updated_at = iso(deps.now());
  await persist(deps, repoRoot, state);
  throw cause;
}

function emptyCostAttribution() {
  return {
    trusted_pr_ready_ms: null,
    active_ms: null,
    wait_ms: null,
    observed_work_ms: null,
    active_wait_ms: null,
    tool_wait_ms: null,
    review_wait_ms: null,
    subagent_wall_clock_ms: null,
    agent_consumption_ms: null,
    subagent_count: null,
    review_dispatch_count: null,
    accepted_finding_count: null,
    repair_batch_count: null,
    total_tokens: null,
    fresh_input_tokens: null,
    cost_usd: null,
    full_suite_count: null,
    expensive_verification_count: null,
    evidence_reuse_count: null,
    evidence_invalidation_count: null,
    human_interruption_count: null,
    accepted_defect_count: null,
    risk_reduction_count: null,
    efficiency_debt_count: null
  };
}

function mergeCostAttribution(current, next, entry) {
  if (!next) return current;
  const allowed = COST_KEYS;
  const identity = ['story_id', 'run_id'];
  if (Object.keys(next).some((key) => !allowed.includes(key) && !identity.includes(key) && !COST_AGGREGATION_INPUT_KEYS.has(key))) {
    throw error('invalid_cost_attribution', 'Unknown cost attribution field.');
  }
  if (next.story_id !== entry.story_id || next.run_id !== entry.run_id) {
    throw error('scope_contamination', 'Cost attribution identity does not match its Portfolio entry.', {
      expected: { story_id: entry.story_id, run_id: entry.run_id },
      actual: { story_id: next.story_id ?? null, run_id: next.run_id ?? null }
    });
  }
  const supplied = Object.fromEntries(Object.entries(next).filter(([key]) => allowed.includes(key)));
  const aggregated = aggregateDeliveryMetrics({
    run_started_at: next.run_started_at,
    trusted_pr_ready_at: next.trusted_pr_ready_at,
    reviews: next.reviews,
    review_dispatches_by_role: next.review_dispatches_by_role,
    attribution_status: next.attribution_status,
    ...supplied
  });
  const measurements = {
    ...supplied,
    ...Object.fromEntries(Object.entries(aggregated)
      .filter(([key, value]) => allowed.includes(key) && value !== undefined && value !== null))
  };
  if (Object.entries(measurements).some(([key, value]) => !validCostMeasurement(key, value))) {
    throw error('invalid_cost_attribution', 'Cost attribution measurements must be non-negative numbers, integer counts, or null.');
  }
  return { ...current, ...measurements };
}

async function readPortfolio(deps, repoRoot, options = {}) {
  const portfolioId = requirePortfolioId(options.portfolioId);
  try {
    const state = normalizePersistedCostAttribution(JSON.parse(await deps.readFile(statePath(repoRoot, portfolioId), 'utf8')));
    validateState(state, portfolioId);
    return state;
  } catch (cause) {
    if (cause.code === 'ENOENT') throw error('portfolio_not_found', `Portfolio not found: ${portfolioId}.`);
    if (cause instanceof StoryRunPortfolioError) throw cause;
    throw error('invalid_portfolio_state', `Portfolio state is invalid: ${cause.message}.`);
  }
}

function normalizePersistedCostAttribution(state) {
  if (!Array.isArray(state?.entries)) return state;
  for (const entry of state.entries) {
    if (!isRecord(entry?.cost_attribution)) continue;
    entry.cost_attribution = { ...emptyCostAttribution(), ...entry.cost_attribution };
  }
  return state;
}

function validateState(state, portfolioId) {
  if (!hasExactKeys(state, STATE_KEYS) || state.schema_version !== STORY_RUN_PORTFOLIO_SCHEMA_VERSION || state.portfolio_id !== portfolioId || state.mode !== 'sequential' || !PORTFOLIO_STATUSES.has(state.status) || !isIsoTimestamp(state.created_at) || !isIsoTimestamp(state.updated_at) || !Array.isArray(state.entries) || state.entries.length === 0 || !Array.isArray(state.promoted_context) || !Array.isArray(state.decision_journal) || !isRecord(state.scope_bindings)) {
    throw error('invalid_portfolio_state', 'Portfolio state does not match the closed schema.');
  }
  const storyIds = new Set();
  for (const [order, entry] of state.entries.entries()) {
    const cost = entry.cost_attribution;
    if (!hasExactKeys(entry, ENTRY_KEYS) || entry.order !== order || !STORY_ID.test(entry.story_id) || storyIds.has(entry.story_id) || !ENTRY_STATUSES.has(entry.status) || (entry.run_id !== null && !nonEmptyString(entry.run_id)) || (entry.worktree !== null && !nonEmptyString(entry.worktree)) || (entry.head_sha !== null && !nonEmptyString(entry.head_sha)) || !hasExactKeys(cost, COST_KEYS) || Object.entries(cost).some(([key, value]) => !validCostMeasurement(key, value)) || !validStopReason(entry.stop_reason)) {
      throw error('invalid_portfolio_state', 'Portfolio entry does not match the closed schema.');
    }
    storyIds.add(entry.story_id);
    const binding = state.scope_bindings[entry.story_id];
    if (entry.status === 'queued' && (entry.run_id !== null || binding !== undefined)) {
      throw error('invalid_portfolio_state', 'Queued Portfolio entry cannot own Run identity.');
    }
    const startingBinding = binding?.status === 'starting';
    const expectedBindingKeys = startingBinding ? ['status', 'creation_request_id'] : ['creation_request_id', 'branch', 'worktree'];
    if (binding !== undefined && (!hasExactKeys(binding, expectedBindingKeys) || !nonEmptyString(binding.creation_request_id) || (startingBinding && binding.status !== 'starting') || (!startingBinding && ((binding.branch !== null && !nonEmptyString(binding.branch)) || (binding.worktree !== null && !nonEmptyString(binding.worktree)))))) {
      throw error('invalid_portfolio_state', 'Portfolio scope binding is invalid.');
    }
    if (entry.run_id !== null && (!binding || (binding.worktree ?? null) !== entry.worktree)) {
      throw error('invalid_portfolio_state', 'Portfolio Run identity does not match its scope binding.');
    }
  }
  if (Object.keys(state.scope_bindings).some((storyId) => !storyIds.has(storyId))) {
    throw error('invalid_portfolio_state', 'Portfolio scope binding references an unknown Story.');
  }
  for (const item of state.promoted_context) {
    if (!hasExactKeys(item, PROMOTED_CONTEXT_KEYS) || !storyIds.has(item.source_story_id) || !storyIds.has(item.consumer_story_id) || state.entries.find((entry) => entry.story_id === item.source_story_id).order >= state.entries.find((entry) => entry.story_id === item.consumer_story_id).order || !nonEmptyString(item.artifact_path) || !/^[a-f0-9]{64}$/.test(item.digest) || !nonEmptyString(item.reason) || !isIsoTimestamp(item.promoted_at)) {
      throw error('invalid_portfolio_state', 'Promoted context does not match the closed schema.');
    }
  }
  for (const item of state.decision_journal) {
    if (!hasExactKeys(item, DECISION_JOURNAL_KEYS) || !storyIds.has(item.story_id) || !DECISIONS.has(item.decision) || !nonEmptyString(item.policy_type) || !nonEmptyString(item.reason) || !isIsoTimestamp(item.decided_at)) {
      throw error('invalid_portfolio_state', 'Decision journal does not match the closed schema.');
    }
  }
  validateLifecycleState(state);
}

function validateLifecycleState(state) {
  const activeEntries = state.entries.filter((entry) => entry.status === 'starting' || entry.status === 'running' || STOPPED.has(entry.status));
  if (activeEntries.length > 1) {
    throw error('invalid_portfolio_state', 'Sequential Portfolio state cannot contain multiple active entries.');
  }
  for (const entry of state.entries) {
    const binding = state.scope_bindings[entry.story_id];
    if (entry.status === 'queued') {
      if (entry.run_id !== null || entry.worktree !== null || entry.head_sha !== null || entry.stop_reason !== null || binding !== undefined) {
        throw error('invalid_portfolio_state', 'Queued Portfolio entry must not own runtime state.');
      }
      continue;
    }
    if (entry.status === 'starting') {
      if (entry.run_id !== null || entry.worktree !== null || entry.head_sha !== null || entry.stop_reason !== null || binding?.status !== 'starting') {
        throw error('invalid_portfolio_state', 'Starting Portfolio entry must own only its creation request identity.');
      }
      continue;
    }
    const rejectedInitialRun = entry.status === 'blocked'
      && entry.run_id === null
      && binding?.status === 'starting'
      && entry.stop_reason?.code === 'scope_contamination';
    const skippedBeforeRun = entry.status === 'skipped'
      && entry.run_id === null
      && binding
      && binding.status !== 'starting';
    if (!rejectedInitialRun && !skippedBeforeRun && (!nonEmptyString(entry.run_id) || !binding || binding.status === 'starting')) {
      throw error('invalid_portfolio_state', 'Started Portfolio entry must own a durable Run and scope binding.');
    }
    if (STOPPED.has(entry.status) && entry.stop_reason === null) {
      throw error('invalid_portfolio_state', 'Stopped Portfolio entry requires a typed stop reason.');
    }
    if ((entry.status === 'running' || entry.status === 'pr_ready') && entry.stop_reason !== null) {
      throw error('invalid_portfolio_state', 'Non-stopped Portfolio entry cannot retain a stop reason.');
    }
    if (entry.status === 'skipped') {
      const matchingDecision = state.decision_journal.some((item) => item.story_id === entry.story_id
        && item.decision === 'skip'
        && item.reason === entry.stop_reason?.message
        && item.policy_type === entry.stop_reason?.details?.policy_type);
      if (entry.stop_reason?.code !== 'explicit_skip' || !matchingDecision) {
        throw error('invalid_portfolio_state', 'Skipped Portfolio entry requires its matching typed decision.');
      }
    }
  }
  if (state.status === 'completed' && !state.entries.every((entry) => ['pr_ready', 'skipped'].includes(entry.status))) {
    throw error('invalid_portfolio_state', 'Completed Portfolio state requires every entry to be terminal.');
  }
  if (state.status === 'queued' && !state.entries.every((entry) => entry.status === 'queued')) {
    throw error('invalid_portfolio_state', 'Queued Portfolio state requires every entry to be queued.');
  }
  if (state.status === 'running' && (activeEntries.length !== 1 || activeEntries[0].status !== 'running')) {
    throw error('invalid_portfolio_state', 'Running Portfolio state requires exactly one running entry.');
  }
  if (state.status === 'starting' && (activeEntries.length !== 1 || activeEntries[0].status !== 'starting')) {
    throw error('invalid_portfolio_state', 'Starting Portfolio state requires exactly one starting entry.');
  }
  if (STOPPED.has(state.status) && (activeEntries.length !== 1 || activeEntries[0].status !== state.status)) {
    throw error('invalid_portfolio_state', 'Stopped Portfolio state must match its stopped entry.');
  }
  if (state.status === 'skipped' && !state.entries.some((entry) => entry.status === 'skipped')) {
    throw error('invalid_portfolio_state', 'Skipped Portfolio state requires an explicitly skipped entry.');
  }
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isIsoTimestamp(value) {
  return nonEmptyString(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validCostMeasurement(key, value) {
  if (value === null) return true;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
  return !COUNT_COST_KEYS.has(key) || Number.isInteger(value);
}

function validStopReason(value) {
  return value === null || (isRecord(value) && nonEmptyString(value.code) && nonEmptyString(value.message) && (!Object.hasOwn(value, 'details') || isRecord(value.details)) && Object.keys(value).every((key) => ['code', 'message', 'details'].includes(key)));
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

async function acquirePortfolioLock(deps, lock, portfolioId, token, recovered = false, contentionRetry = true) {
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
    if (cause.code === 'ENOENT' && contentionRetry) {
      try {
        await deps.lstat(lock);
      } catch (lockCause) {
        if (lockCause.code === 'ENOENT') {
          return acquirePortfolioLock(deps, lock, portfolioId, token, recovered, false);
        }
        throw lockCause;
      }
    }
    throw error('portfolio_lock_recovery_required', `Portfolio lock ownership cannot be verified: ${portfolioId}.`, { lock, cause: cause.code ?? cause.message });
  }
  if (!Number.isInteger(owner.pid) || !owner.token || deps.isProcessAlive(owner.pid)) {
    throw error('portfolio_busy', `Portfolio is already being mutated: ${portfolioId}.`, { owner });
  }
  if (recovered) throw error('portfolio_lock_recovery_failed', `Orphaned Portfolio lock could not be recovered: ${portfolioId}.`, { owner });

  const recoveryLock = `${lock}.recovery`;
  const recoveryOwner = { schema_version: 1, pid: process.pid, token, acquired_at: iso(deps.now()) };
  let recoveryLockCreated = false;
  try {
    await deps.mkdir(recoveryLock);
    recoveryLockCreated = true;
    await deps.writeFile(path.join(recoveryLock, 'owner.json'), `${JSON.stringify(recoveryOwner, null, 2)}\n`);
  } catch (cause) {
    if (recoveryLockCreated) {
      await deps.rm(recoveryLock, { recursive: true, force: true });
      throw cause;
    }
    if (cause.code === 'EEXIST') {
      let existingRecoveryOwner;
      try {
        existingRecoveryOwner = JSON.parse(await deps.readFile(path.join(recoveryLock, 'owner.json'), 'utf8'));
      } catch (ownerCause) {
        throw error('portfolio_lock_recovery_required', `Portfolio recovery lock ownership cannot be verified: ${portfolioId}.`, {
          recovery_lock: recoveryLock, cause: ownerCause.code ?? ownerCause.message,
          required_action: 'Inspect and remove the recovery lock only after proving no recovery process is active.'
        });
      }
      if (!Number.isInteger(existingRecoveryOwner.pid) || !existingRecoveryOwner.token || !deps.isProcessAlive(existingRecoveryOwner.pid)) {
        throw error('portfolio_lock_recovery_required', `Portfolio recovery lock has no live owner: ${portfolioId}.`, {
          recovery_lock: recoveryLock, owner: existingRecoveryOwner,
          required_action: 'Inspect and remove the recovery lock only after proving no recovery process is active.'
        });
      }
      throw error('portfolio_busy', `Portfolio lock recovery is already in progress: ${portfolioId}.`, { owner: existingRecoveryOwner });
    }
    throw cause;
  }
  try {
    let currentOwner;
    try {
      currentOwner = JSON.parse(await deps.readFile(path.join(lock, 'owner.json'), 'utf8'));
    } catch (cause) {
      throw error('portfolio_lock_recovery_required', `Portfolio lock changed before recovery: ${portfolioId}.`, { cause: cause.code ?? cause.message });
    }
    if (currentOwner.token !== owner.token || deps.isProcessAlive(currentOwner.pid)) {
      throw error('portfolio_busy', `Portfolio lock owner changed before recovery: ${portfolioId}.`, { owner: currentOwner });
    }

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
  } finally {
    let currentRecoveryOwner;
    try {
      currentRecoveryOwner = JSON.parse(await deps.readFile(path.join(recoveryLock, 'owner.json'), 'utf8'));
    } catch (cause) {
      throw error('portfolio_lock_recovery_required', `Portfolio recovery lock changed before release: ${portfolioId}.`, {
        recovery_lock: recoveryLock, cause: cause.code ?? cause.message
      });
    }
    if (currentRecoveryOwner.token !== token) {
      throw error('portfolio_lock_ownership_lost', `Portfolio recovery lock owner changed before release: ${portfolioId}.`, {
        expected_token: token, actual_token: currentRecoveryOwner.token
      });
    }
    await deps.rm(recoveryLock, { recursive: true, force: true });
  }
}

function portfolioCreationRequestId(portfolioId, storyId, order) {
  return `portfolio-${createHash('sha256').update(`${portfolioId}:${storyId}:${order}`).digest('hex').slice(0, 24)}`;
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
    lines.push(`   trusted_pr_ready_ms=${cost.trusted_pr_ready_ms ?? 'unknown'} active_ms=${cost.active_ms ?? 'unknown'} wait_ms=${cost.wait_ms ?? 'unknown'} tokens=${cost.total_tokens ?? 'unknown'} cost_usd=${cost.cost_usd ?? 'unknown'} full_suite=${cost.full_suite_count ?? 'unknown'} evidence_reuse=${cost.evidence_reuse_count ?? 'unknown'} evidence_invalidations=${cost.evidence_invalidation_count ?? 'unknown'} human_interruptions=${cost.human_interruption_count ?? 'unknown'} accepted_defects=${cost.accepted_defect_count ?? 'unknown'} risk_reductions=${cost.risk_reduction_count ?? 'unknown'}`);
    lines.push(`   observed_work_ms=${cost.observed_work_ms ?? 'unknown'} active_wait_ms=${cost.active_wait_ms ?? 'unknown'} tool_wait_ms=${cost.tool_wait_ms ?? 'unknown'} review_wait_ms=${cost.review_wait_ms ?? 'unknown'} subagent_wall_clock_ms=${cost.subagent_wall_clock_ms ?? 'unknown'} agent_consumption_ms=${cost.agent_consumption_ms ?? 'unknown'}`);
    lines.push(`   subagents=${cost.subagent_count ?? 'unknown'} review_dispatches=${cost.review_dispatch_count ?? 'unknown'} accepted_findings=${cost.accepted_finding_count ?? 'unknown'} repair_batches=${cost.repair_batch_count ?? 'unknown'} expensive_verification=${cost.expensive_verification_count ?? 'unknown'} fresh_input_tokens=${cost.fresh_input_tokens ?? 'unknown'} evidence_invalidation=${cost.evidence_invalidation_count ?? 'unknown'} efficiency_debt=${cost.efficiency_debt_count ?? 'unknown'}`);
    if (entry.stop_reason) {
      lines.push(`   stop_reason=${entry.stop_reason.code}: ${entry.stop_reason.message}`);
      lines.push(`   next_action=vibepro execute portfolio-decide . --portfolio-id ${state.portfolio_id} --story-id ${entry.story_id} --decision <continue|retry|skip> --policy-type <type> --reason <reason>`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export function renderStoryRunPortfolioError(cause) {
  const lines = [`${cause.code}: ${cause.message}`];
  const details = cause.details ?? {};
  for (const key of ['recovery_lock', 'artifact', 'run_id', 'creation_request_id', 'cause', 'required_action']) {
    if (details[key] !== undefined && details[key] !== null) lines.push(`${key}=${details[key]}`);
  }
  return `${lines.join('\n')}\n`;
}
