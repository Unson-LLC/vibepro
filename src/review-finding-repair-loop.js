import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getWorkspaceDir } from './workspace.js';

const DISPOSITIONS = new Set(['repairable', 'human_decision', 'split_required', 'non_actionable']);
const HUMAN_BOUNDARY = /\b(architecture|security|authorization|ownership|owner decision|policy|boundary|irreversible)\b/i;
const SPLIT_BOUNDARY = /\b(split|separate stor(?:y|ies)|out of scope|scope boundary)\b/i;

export function createFindingRepairPlan(input = {}) {
  const storyId = required(input.storyId, 'storyId');
  const stage = required(input.stage, 'stage');
  const role = required(input.role, 'role');
  const review = normalizeReview(input.review);
  if (!['needs_changes', 'block'].includes(review.status)) {
    throw new Error('finding repair requires a needs_changes or block review');
  }
  const maxAttempts = positiveInteger(input.maxAttempts ?? 3, 'maxAttempts');
  const attempts = review.findings.map((finding, index) => createAttempt({
    storyId, stage, role, review, finding, attemptNumber: 1, index
  }));
  const blocked = attempts.find((attempt) => ['human_decision', 'split_required'].includes(attempt.disposition));
  const repairable = attempts.find((attempt) => attempt.disposition === 'repairable');
  return {
    schema_version: '0.1.0', story_id: storyId, stage, role, max_attempts: maxAttempts,
    original_review: snapshotReview(review), attempts,
    status: blocked ? 'human_checkpoint' : repairable ? 'planned' : 'stopped',
    stop_reason: blocked ? null : repairable ? null : 'no_actionable_findings',
    next_action: blocked
      ? checkpointAction(blocked)
      : repairable
        ? dispatchAction(repairable)
        : { type: 'stop', reason: 'no_actionable_findings' }
  };
}

export function recordFindingRepairAttempt(current, input = {}) {
  const state = structuredClone(current);
  if (!['planned', 'repairing', 'awaiting_rereview'].includes(state.status)) {
    throw new Error(`finding repair cannot record while status=${state.status}`);
  }
  const attemptIndex = state.attempts.findIndex((attempt) => attempt.disposition === 'repairable' && !attempt.outcome);
  if (attemptIndex < 0) throw new Error('finding repair has no open repairable attempt');
  const attempt = state.attempts[attemptIndex];
  const headSha = required(input.headSha, 'headSha');
  const implementationIdentity = required(input.implementationIdentity, 'implementationIdentity');
  const implementationSessionId = required(input.implementationSessionId, 'implementationSessionId');
  assertCurrentEvidence(input.verification, headSha, 'verification');
  assertCurrentEvidence(input.prPrepare, headSha, 'pr prepare');
  const rereview = normalizeReview(input.rereview);
  if (rereview.stage !== state.stage || rereview.role !== state.role) {
    throw new Error('fresh re-review must use the same stage and role');
  }
  if (!rereview.agent_identity || (!rereview.session_id && !rereview.thread_id)) {
    throw new Error('fresh re-review requires reviewer identity and session or thread provenance');
  }
  if (rereview.head_commit !== headSha) throw new Error('fresh re-review must bind to current HEAD');
  if (rereview.agent_identity === implementationIdentity ||
      [rereview.session_id, rereview.thread_id].filter(Boolean).includes(implementationSessionId)) {
    throw new Error('fresh re-review must use an independent identity and session');
  }
  if (rereview.lifecycle !== 'closed') throw new Error('fresh re-review lifecycle must be closed');
  attempt.outcome = {
    implementation: { head_sha: headSha, agent_identity: implementationIdentity, session_id: implementationSessionId },
    verification: structuredClone(input.verification), pr_prepare: structuredClone(input.prPrepare)
  };
  attempt.rereview = { ...snapshotReview(rereview), agent_identity: rereview.agent_identity,
    session_id: rereview.session_id ?? null, thread_id: rereview.thread_id ?? null, lifecycle: rereview.lifecycle,
    fresh_independent: true };

  if (rereview.status === 'pass') {
    const remaining = state.attempts.find((item) => item.disposition === 'repairable' && !item.outcome);
    state.status = remaining ? 'planned' : 'converged';
    state.stop_reason = null;
    state.next_action = remaining ? dispatchAction(remaining) : { type: 'complete', head_sha: headSha };
    return state;
  }
  if (!['needs_changes', 'block'].includes(rereview.status)) throw new Error(`unsupported re-review status: ${rereview.status}`);
  const repeated = rereview.findings.some((finding) => findingFingerprint(finding) === attempt.finding_fingerprint);
  if (repeated && headSha === attempt.input_head_sha) return stopNoProgress(state, 'repeated_finding_without_head_progress');
  const nextNumber = Math.max(...state.attempts.map((item) => item.attempt_number)) + 1;
  if (nextNumber > state.max_attempts) return stopNoProgress(state, 'max_attempts_reached');
  const additions = rereview.findings.map((finding, index) => createAttempt({
    storyId: state.story_id, stage: state.stage, role: state.role, review: rereview,
    finding, attemptNumber: nextNumber, index
  }));
  state.attempts.push(...additions);
  const blocked = additions.find((item) => ['human_decision', 'split_required'].includes(item.disposition));
  const repairable = additions.find((item) => item.disposition === 'repairable');
  state.status = blocked ? 'human_checkpoint' : repairable ? 'planned' : 'stopped';
  state.stop_reason = repairable || blocked ? null : 'no_actionable_findings';
  state.next_action = blocked ? checkpointAction(blocked) : repairable ? dispatchAction(repairable) : { type: 'stop', reason: state.stop_reason };
  return state;
}

export function summarizeFindingRepairState(state) {
  return {
    story_id: state.story_id, stage: state.stage, role: state.role, status: state.status,
    attempt_count: state.attempts.length, max_attempts: state.max_attempts,
    stop_reason: state.stop_reason ?? null, next_action: state.next_action
  };
}

export async function dispatchFindingRepair(state, input = {}) {
  assertFindingRepairState(state);
  if (state.status !== 'planned' || state.next_action?.type !== 'dispatch_implementation') {
    throw new Error('finding repair is not ready for implementation dispatch');
  }
  if (!input.runtimeCoordinator || typeof input.runtimeCoordinator.dispatch !== 'function') {
    throw new Error('runtimeCoordinator.dispatch is required');
  }
  const request = {
    ...state.next_action.task.runtime_request,
    adapter_id: required(input.adapterId, 'adapterId'),
    requirements: input.requirements,
    implementation_identity: input.implementationIdentity ?? null
  };
  const dispatching = {
    ...state,
    status: 'dispatching',
    next_action: { type: 'await_dispatch_receipt', task_id: request.task_id }
  };
  if (input.beforeDispatch) await input.beforeDispatch(dispatching);
  const dispatched = await input.runtimeCoordinator.dispatch(input.runState, request);
  const next = {
    ...state,
    runtime_dispatch: structuredClone(dispatched.dispatch),
    runtime_state: structuredClone(dispatched.state)
  };
  return applyRuntimeResult(next, dispatched.dispatch.status);
}

export async function dispatchFindingRepairFromRepo(repoRoot, input = {}) {
  const artifact = statePath(repoRoot, required(input.storyId, 'storyId'), required(input.stage, 'stage'), required(input.role, 'role'));
  const state = JSON.parse(await readFile(artifact, 'utf8'));
  assertFindingRepairState(state);
  try {
    const next = await dispatchFindingRepair(state, { ...input, beforeDispatch: async (dispatching) => writeJsonAtomic(artifact, dispatching) });
    await writeJsonAtomic(artifact, next);
    return { artifact, state: next, summary: summarizeFindingRepairState(next) };
  } catch (error) {
    let persisted;
    try { persisted = JSON.parse(await readFile(artifact, 'utf8')); } catch { throw error; }
    if (persisted.status === 'dispatching') {
      persisted.runtime_error = { message: error instanceof Error ? error.message : String(error) };
      return persistStoppedRuntime(artifact, persisted, 'runtime_dispatch_uncertain');
    }
    throw error;
  }
}

export async function pollFindingRepairFromRepo(repoRoot, input = {}) {
  const artifact = statePath(repoRoot, required(input.storyId, 'storyId'), required(input.stage, 'stage'), required(input.role, 'role'));
  const state = JSON.parse(await readFile(artifact, 'utf8'));
  assertFindingRepairState(state);
  if (state.status !== 'repairing' || !state.runtime_dispatch?.dispatch_id) throw new Error('finding repair has no running implementation dispatch');
  if (!input.runtimeCoordinator || typeof input.runtimeCoordinator.poll !== 'function') throw new Error('runtimeCoordinator.poll is required');
  const observed = await input.runtimeCoordinator.poll(state.runtime_state, state.runtime_dispatch.dispatch_id);
  const next = applyRuntimeResult({ ...state, runtime_dispatch: structuredClone(observed.dispatch), runtime_state: structuredClone(observed.state) }, observed.dispatch.status);
  if (['failed', 'cancelled', 'timed_out'].includes(observed.dispatch.status)) {
    return persistStoppedRuntime(artifact, next, `runtime_${observed.dispatch.status}`);
  }
  await writeJsonAtomic(artifact, next);
  return { artifact, state: next, summary: summarizeFindingRepairState(next) };
}

export async function planFindingRepair(repoRoot, input = {}) {
  const reviewPath = path.resolve(repoRoot, required(input.reviewPath, 'reviewPath'));
  const source = JSON.parse(await readFile(reviewPath, 'utf8'));
  const review = {
    ...source,
    findings: (source.findings ?? []).map((finding) => ({
      ...finding,
      acceptance_clause: finding.acceptance_clause ?? input.acceptanceClause,
      code_scope: finding.code_scope ?? input.codeScope,
      test_scope: finding.test_scope ?? input.testScope
    }))
  };
  const state = createFindingRepairPlan({ ...input, review });
  const artifact = statePath(repoRoot, state.story_id, state.stage, state.role);
  await writeJsonAtomic(artifact, state);
  return { artifact, state, summary: summarizeFindingRepairState(state) };
}

export async function recordFindingRepair(repoRoot, input = {}) {
  const artifact = statePath(repoRoot, required(input.storyId, 'storyId'), required(input.stage, 'stage'), required(input.role, 'role'));
  const current = JSON.parse(await readFile(artifact, 'utf8'));
  assertFindingRepairState(current);
  const result = JSON.parse(await readFile(path.resolve(repoRoot, required(input.resultPath, 'resultPath')), 'utf8'));
  const canonical = await readCanonicalEvidence(repoRoot, current.story_id, required(result.headSha, 'headSha'));
  const state = recordFindingRepairAttempt(current, { ...result, ...canonical });
  await writeJsonAtomic(artifact, state);
  return { artifact, state, summary: summarizeFindingRepairState(state) };
}

export async function getFindingRepairStatus(repoRoot, input = {}) {
  const artifact = statePath(repoRoot, required(input.storyId, 'storyId'), required(input.stage, 'stage'), required(input.role, 'role'));
  let state;
  try { state = JSON.parse(await readFile(artifact, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`no finding repair plan exists; run: ${planCommand(input)}`);
    throw error;
  }
  assertFindingRepairState(state);
  return { artifact, state, summary: summarizeFindingRepairState(state) };
}

function assertFindingRepairState(state) {
  if (!state || typeof state !== 'object') throw new Error('finding repair state must be an object');
  if (state.schema_version !== '0.1.0') throw new Error(`unsupported finding repair state schema_version: ${state.schema_version ?? 'missing'}`);
  required(state.story_id, 'state.story_id');
  required(state.stage, 'state.stage');
  required(state.role, 'state.role');
  required(state.status, 'state.status');
  positiveInteger(state.max_attempts, 'state.max_attempts');
  if (!state.original_review || typeof state.original_review !== 'object') throw new Error('state.original_review is required');
  if (!Array.isArray(state.attempts)) throw new Error('state.attempts must be an array');
  if (!state.next_action || typeof state.next_action.type !== 'string') throw new Error('state.next_action is required');
  for (const attempt of state.attempts) {
    positiveInteger(attempt?.attempt_number, 'attempt.attempt_number');
    required(attempt?.finding_fingerprint, 'attempt.finding_fingerprint');
    if (!DISPOSITIONS.has(attempt?.disposition)) throw new Error(`unsupported attempt disposition: ${attempt?.disposition ?? 'missing'}`);
    if (attempt.disposition === 'repairable' && (!attempt.task || typeof attempt.task !== 'object')) throw new Error('repairable attempt.task is required');
  }
  return state;
}

function applyRuntimeResult(state, status) {
  if (status === 'running') {
    state.status = 'repairing';
    state.next_action = { type: 'poll_implementation', dispatch_id: required(state.runtime_dispatch?.dispatch_id, 'runtime dispatch id') };
    return state;
  }
  if (status === 'completed') {
    state.status = 'awaiting_rereview';
    state.stop_reason = null;
    state.next_action = { type: 'record_rereview', command: recordCommand(state), result_schema: 'headSha, implementationIdentity, implementationSessionId, rereview' };
    return state;
  }
  if (['failed', 'cancelled', 'timed_out'].includes(status)) {
    state.status = 'no_progress';
    state.stop_reason = `runtime_${status}`;
    state.next_action = runtimeStopAction(state, state.stop_reason);
    return state;
  }
  throw new Error(`unsupported runtime dispatch status: ${status ?? 'missing'}`);
}

function createAttempt({ storyId, stage, role, review, finding, attemptNumber, index }) {
  const disposition = classifyFinding(review.status, finding);
  const fingerprint = findingFingerprint(finding);
  const taskId = `repair-${attemptNumber}-${fingerprint.slice(0, 10)}`;
  return {
    attempt_number: attemptNumber, finding_index: index, input_head_sha: review.head_commit,
    review_status: review.status, finding: structuredClone(finding), finding_fingerprint: fingerprint, disposition,
    task: disposition === 'repairable' ? {
      task_id: taskId,
      acceptance_clause: required(finding.acceptance_clause, `finding ${finding.id} acceptance_clause`),
      code_scope: nonEmptyList(finding.code_scope, `finding ${finding.id} code_scope`),
      test_scope: nonEmptyList(finding.test_scope, `finding ${finding.id} test_scope`),
      instruction: finding.detail,
      runtime_request: {
        story_id: storyId, task_id: taskId, role: 'implementation', input_head_sha: review.head_commit,
        stage, review_role: role, finding_fingerprint: fingerprint
      }
    } : null,
    outcome: null, rereview: null
  };
}

function classifyFinding(reviewStatus, finding) {
  if (finding.disposition) {
    if (!DISPOSITIONS.has(finding.disposition)) throw new Error(`unsupported finding disposition: ${finding.disposition}`);
    return finding.disposition;
  }
  const text = `${finding.id ?? ''} ${finding.detail ?? ''}`;
  if (SPLIT_BOUNDARY.test(text)) return 'split_required';
  if (reviewStatus === 'block' && HUMAN_BOUNDARY.test(text)) return 'human_decision';
  if (finding.acceptance_clause && Array.isArray(finding.code_scope) && finding.code_scope.length > 0 &&
      Array.isArray(finding.test_scope) && finding.test_scope.length > 0) return 'repairable';
  return reviewStatus === 'block' ? 'human_decision' : 'non_actionable';
}

function normalizeReview(value) {
  if (!value || typeof value !== 'object') throw new Error('review is required');
  return {
    ...value,
    status: required(value.status, 'review.status'),
    head_commit: required(value.head_commit ?? value.head_sha ?? value.git_context?.head_sha, 'review.head_commit'),
    agent_identity: value.agent_identity ?? value.agent_provenance?.agent_id ?? null,
    session_id: value.session_id ?? value.agent_provenance?.session_id ?? value.agent_provenance?.agent_session_id ?? null,
    thread_id: value.thread_id ?? value.agent_provenance?.thread_id ?? value.agent_provenance?.agent_thread_id ?? null,
    lifecycle: value.lifecycle ?? (value.agent_provenance?.lifecycle?.agent_closed ? 'closed' : null),
    stage: value.stage ?? null,
    role: value.role ?? null,
    findings: Array.isArray(value.findings) ? value.findings.map((finding) => ({ ...finding,
      id: required(finding.id, 'finding.id'), detail: required(finding.detail, `finding ${finding.id ?? ''} detail`) })) : []
  };
}

function snapshotReview(review) {
  return { status: review.status, head_commit: review.head_commit, recorded_at: review.recorded_at ?? null,
    findings: structuredClone(review.findings) };
}

function findingFingerprint(finding) {
  return createHash('sha256').update(JSON.stringify({ id: finding.id, detail: finding.detail,
    acceptance_clause: finding.acceptance_clause ?? null, code_scope: finding.code_scope ?? [], test_scope: finding.test_scope ?? [] })).digest('hex');
}

function assertCurrentEvidence(evidence, headSha, label) {
  if (!evidence || evidence.head_sha !== headSha) throw new Error(`${label} must bind to current HEAD`);
  if (!['pass', 'ready', 'ready_for_review'].includes(evidence.status)) throw new Error(`${label} must pass for current HEAD`);
}

function dispatchAction(attempt) { return { type: 'dispatch_implementation', task: attempt.task }; }
function checkpointAction(attempt) { return {
  type: 'human_checkpoint', reason: attempt.disposition, finding: attempt.finding,
  decision_required: attempt.disposition === 'split_required' ? 'Approve a separate Story or mark this finding non-actionable.' : 'Choose the authorized owner decision before repair resumes.',
  authority: 'human_owner',
  next_commands: ['vibepro review finding-repair plan --review <updated-review.json> ...', 'vibepro story add <repo> --id <new-story-id>']
}; }
function stopNoProgress(state, reason) {
  state.status = 'no_progress'; state.stop_reason = reason; state.next_action = {
    type: 'stop', reason, authority: 'human_owner',
    decision_required: 'Inspect the unchanged finding and either narrow the repair, split a Story, or stop as non-actionable.',
    next_commands: [`vibepro review finding-repair status . --id ${state.story_id} --stage ${state.stage} --role ${state.role}`, 'vibepro story add <repo> --id <new-story-id>']
  }; return state;
}
function required(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`); return value.trim(); }
function nonEmptyList(value, label) { if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} is required`); return value.map((item) => required(item, label)); }
function positiveInteger(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`); return number; }
function safeSegment(value, label) { const text = required(value, label); if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(text) || text.includes('..')) throw new Error(`${label} must be a path-safe segment`); return text; }
function statePath(repoRoot, storyId, stage, role) { return path.join(getWorkspaceDir(repoRoot), 'review-finding-repair', safeSegment(storyId, 'storyId'), safeSegment(stage, 'stage'), safeSegment(role, 'role'), 'state.json'); }
function planCommand(input) { return `vibepro review finding-repair plan . --id ${input.storyId} --stage ${input.stage} --role ${input.role} --review <review.json>`; }
function recordCommand(state) { return `vibepro review finding-repair record . --id ${state.story_id} --stage ${state.stage} --role ${state.role} --result <result.json>`; }
async function persistStoppedRuntime(artifact, state, reason) {
  state.status = 'no_progress';
  state.stop_reason = reason;
  state.next_action = runtimeStopAction(state, reason);
  await writeJsonAtomic(artifact, state);
  return { artifact, state, summary: summarizeFindingRepairState(state) };
}
function runtimeStopAction(state, reason) {
  return {
    type: 'stop',
    reason,
    authority: 'human_owner',
    decision_required: 'Inspect the runtime failure and either retry with corrected runtime inputs, split a Story, or stop as non-actionable.',
    next_commands: [
      `vibepro review finding-repair status . --id ${state.story_id} --stage ${state.stage} --role ${state.role}`,
      `vibepro review finding-repair dispatch . --id ${state.story_id} --stage ${state.stage} --role ${state.role} --adapter <adapter-id>`,
      'vibepro story add <repo> --id <new-story-id>'
    ]
  };
}
async function readCanonicalEvidence(repoRoot, storyId, headSha) {
  const root = path.join(getWorkspaceDir(repoRoot), 'pr', safeSegment(storyId, 'storyId'));
  const verificationArtifact = path.join(root, 'verification-evidence.json');
  const prepareArtifact = path.join(root, 'pr-prepare.json');
  const verificationSource = JSON.parse(await readFile(verificationArtifact, 'utf8'));
  const commands = verificationSource.commands ?? [];
  const current = commands.filter((item) => item.status === 'pass' && item.git_context?.head_sha === headSha && item.content_binding?.recorded_head_sha === headSha);
  if (current.length === 0) throw new Error('canonical verification evidence must contain a current-HEAD content-bound pass');
  const prepareSource = JSON.parse(await readFile(prepareArtifact, 'utf8'));
  if (prepareSource.story?.id !== storyId || prepareSource.git?.head_sha !== headSha) throw new Error('canonical pr prepare artifact must bind to the Story and current HEAD');
  return {
    verification: { status: 'pass', head_sha: headSha, artifact: path.relative(repoRoot, verificationArtifact), command_count: current.length },
    prPrepare: { status: prepareSource.gate_status?.ready_for_pr_create ? 'ready' : 'ready_for_review', head_sha: headSha, artifact: path.relative(repoRoot, prepareArtifact) }
  };
}
async function writeJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`); await rename(temporary, filePath); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}
