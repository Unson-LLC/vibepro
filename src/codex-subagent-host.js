import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDevelopmentProgressEnvelope,
  verifyDevelopmentProgressReadback,
} from './brainbase-development-progress.js';

const POLL_MS = 250;
const HOST_ROOT = ['.vibepro', 'codex-host', 'runs'];
const DEVELOPMENT_PROGRESS_AWAITING = 'awaiting_integration';
const DEVELOPMENT_PROGRESS_ATTEMPT_TIMEOUT_MS = 2_000;
const DEVELOPMENT_PROGRESS_MAX_ATTEMPTS = 3;
const DEVELOPMENT_PROGRESS_RETRY_BACKOFF_MS = [250, 1_000];

/**
 * Publish one host event through the already configured Brainbase sender.
 *
 * This is deliberately an optional seam: the host remains fully usable when
 * no sender is injected, and a failed send/readback never changes the local
 * run or event state. Only explicit dispatch mapping and the provider session
 * captured by the worker are accepted here; run_id/thread_id are not session
 * substitutes.
 */
export async function publishDevelopmentProgress({ sender = null, request, state, event, sequence } = {}) {
  if (!sender) return { status: 'disabled', reason: 'sender_unconfigured' };
  if (sender.configurationError === 'development_progress_configuration_invalid') {
    return { status: 'unconfigured', reason: sender.configurationError };
  }
  if (typeof sender.send !== 'function' || typeof sender.readback !== 'function') {
    return { status: 'unconfigured', reason: 'sender_invalid' };
  }

  const dispatchMismatch = dispatchIdentityMismatch(request, state, event);
  if (dispatchMismatch) return { status: 'unconfigured', reason: dispatchMismatch };

  const progress = request?.development_progress;
  const missing = missingDevelopmentProgressIdentity({ request, progress, state, event, sequence });
  if (missing.length > 0) {
    return {
      status: 'unconfigured',
      reason: 'development_progress_identity_incomplete',
      missing,
    };
  }
  const taskRefMismatch = developmentProgressTaskRefMismatch(request, progress.task_ref);
  if (taskRefMismatch) return { status: 'unconfigured', reason: taskRefMismatch };

  let envelope;
  try {
    envelope = createDevelopmentProgressEnvelope({
      event_id: event.event_id,
      source: progress.source,
      sequence,
      observed_at: event.observed_at,
      canonical_task_id: progress.canonical_task_id,
      task_ref: progress.task_ref,
      plan_version: progress.plan_version,
      execution: {
        dispatch_id: state.dispatch_id,
        attempt: state.attempts,
        owner: progress.owner ?? state.agent_identity,
        session_ref: state.provider_session_id,
        status: developmentProgressStatus(event),
        // Local paths are intentionally never projected to Brainbase.
        worktree: null,
        base_sha: progress.base_sha ?? null,
        head_sha: progress.head_sha ?? null,
      },
      evidence: progress.evidence ?? { artifacts: [] },
      ...(progress.block_reason === undefined ? {} : { block_reason: progress.block_reason }),
      ...(progress.next_action === undefined ? {} : { next_action: progress.next_action }),
    });
  } catch {
    return { status: 'unconfigured', reason: 'development_progress_invalid' };
  }

  try {
    const sendResult = await sender.send(envelope);
    if (sendResult === false) {
      return {
        status: DEVELOPMENT_PROGRESS_AWAITING,
        reason: 'development_progress_send_rejected',
        failure_code: 'send_rejected',
      };
    }
  } catch {
    return {
      status: DEVELOPMENT_PROGRESS_AWAITING,
      reason: 'development_progress_send_failed',
      failure_code: 'send_failed',
    };
  }
  try {
    const readback = await sender.readback(envelope);
    try {
      verifyDevelopmentProgressReadback(readback, envelope);
    } catch {
      return {
        status: DEVELOPMENT_PROGRESS_AWAITING,
        reason: 'development_progress_readback_unconfirmed',
        failure_code: 'readback_unconfirmed',
      };
    }
  } catch {
    return {
      status: DEVELOPMENT_PROGRESS_AWAITING,
      reason: 'development_progress_readback_failed',
      failure_code: 'readback_failed',
    };
  }
  return { status: 'confirmed', event_id: envelope.event_id, sequence: envelope.sequence };
}

export function createCodexSubagentHost({
  cwd = process.cwd(),
  env = process.env,
  codexExecutable,
  codexExecutableArgs = [],
  model,
  probeTimeoutMs = 10000,
  killProcess = process.kill.bind(process),
  developmentProgressSender = null,
  developmentProgressAttemptTimeoutMs = DEVELOPMENT_PROGRESS_ATTEMPT_TIMEOUT_MS,
  developmentProgressMaxAttempts = DEVELOPMENT_PROGRESS_MAX_ATTEMPTS,
  developmentProgressRetryBackoffMs = DEVELOPMENT_PROGRESS_RETRY_BACKOFF_MS,
} = {}) {
  const executable = codexExecutable ?? env?.VIBEPRO_CODEX_EXECUTABLE ?? 'codex';
  const selectedModel = model ?? env?.VIBEPRO_CODEX_MODEL ?? null;
  const workerPath = fileURLToPath(new URL('./codex-subagent-host-worker.js', import.meta.url));
  let resumeHandler = null;
  const subscriptions = new Map();
  const workers = new Map();
  const runRoots = new Set([path.resolve(cwd)]);
  const confirmedProgress = new Map();
  const progressJobs = new Map();
  const progressAttemptTimeoutMs = positiveIntegerOrDefault(
    developmentProgressAttemptTimeoutMs,
    DEVELOPMENT_PROGRESS_ATTEMPT_TIMEOUT_MS,
  );
  const progressMaxAttempts = positiveIntegerOrDefault(
    developmentProgressMaxAttempts,
    DEVELOPMENT_PROGRESS_MAX_ATTEMPTS,
  );
  const progressRetryBackoffMs = normalizeRetryBackoff(
    developmentProgressRetryBackoffMs,
    DEVELOPMENT_PROGRESS_RETRY_BACKOFF_MS,
  );

  return {
    async probe() {
      const available = await probeExecutable(executable, codexExecutableArgs, probeTimeoutMs);
      return {
        available, capabilities: available ? ['review', 'completion_inbox', 'detached_resume'] : [],
        sandbox: 'read-only', approval_policy: 'managed', reason: available ? null : `Codex executable unavailable: ${executable}`
      };
    },
    async spawn(request) {
      const repoRoot = path.resolve(request.requirements.managed_worktree);
      runRoots.add(repoRoot);
      const runDir = resolveRunDir(repoRoot, request.dispatch_id, request.idempotency_key);
      await mkdir(path.dirname(runDir), { recursive: true, mode: 0o700 });
      const claimed = await claimRun(runDir);
      if (!claimed) return startedFromState(await waitForExistingRun(runDir, request));
      const providerRunId = `codex-cli-${crypto.randomUUID()}`;
      const threadId = `codex-host-${crypto.randomUUID()}`;
      const state = {
        schema_version: '0.1.0', status: 'spawning', provider: 'codex-cli', provider_run_id: providerRunId,
        provider_session_id: null, thread_id: threadId, agent_identity: request.reviewer_identity ?? `codex-${request.role}`,
        dispatch_id: request.dispatch_id, idempotency_key: request.idempotency_key, attempts: request.recovery_attempt ?? 1,
        started_at: new Date().toISOString(), worker_pid: null
      };
      await writeJson(path.join(runDir, 'request.json'), request);
      await writeJson(path.join(runDir, 'state.json'), state);
      const child = spawn(process.execPath, [workerPath, runDir, repoRoot], {
        cwd: repoRoot, detached: true, stdio: 'ignore',
        env: workerEnvironment(env, { executable, executableArgs: codexExecutableArgs, selectedModel })
      });
      workers.set(providerRunId, child);
      child.once('close', () => workers.delete(providerRunId));
      child.unref();
      state.worker_pid = child.pid;
      state.status = 'running';
      await writeJson(path.join(runDir, 'state.json'), state);
      return startedFromState(state);
    },
    async status({ provider_run_id: providerRunId, repo_root: repoRoot }) {
      const searchRoots = authorityRunRoots(runRoots, repoRoot);
      const located = await findRunAcrossRoots(searchRoots, providerRunId);
      if (!located) return { status: 'failed', message: `unknown Codex provider run: ${providerRunId}` };
      const state = await readJson(path.join(located, 'state.json'));
      return state?.status === 'delivery_pending' ? { ...state, status: 'running' } : state;
    },
    async shutdown({ provider_run_id: providerRunId, repo_root: repoRoot, reason }) {
      const searchRoots = authorityRunRoots(runRoots, repoRoot);
      const located = await findRunAcrossRoots(searchRoots, providerRunId);
      if (!located) return { status: 'cancelled' };
      const statePath = path.join(located, 'state.json');
      const state = await readJson(statePath);
      if (Number.isInteger(state?.worker_pid) && state.worker_pid > 1 && isActive(state.status)) {
        // The child can publish its own observable PID before the worker's
        // atomic metadata rename completes. Resolve that short startup race so
        // containment never treats an unknown Codex PID as already stopped.
        const codexProcess = await waitForJson(path.join(located, 'codex-process.json'), 1000);
        await terminateWorkerTree(located, state.worker_pid, workers.get(providerRunId), codexProcess?.pid, killProcess);
      }
      const next = { ...state, status: 'cancelled', completed_at: new Date().toISOString(), stop_reason: { code: reason ?? 'cancelled' } };
      await writeJson(statePath, next);
      return next;
    },
    async subscribeCompletion({ dispatch_id: dispatchId, repo_root: repoRoot, onEvent }) {
      const searchRoots = authorityRunRoots(runRoots, repoRoot);
      const subscriptionId = crypto.randomUUID();
      const timer = setInterval(async () => {
        const subscription = subscriptions.get(subscriptionId);
        if (!subscription || subscription.delivering) return;
        subscription.delivering = true;
        try {
          const runDir = await findDispatchRunAcrossRoots(searchRoots, dispatchId);
          if (!runDir) return;
          const eventsDir = path.join(runDir, 'events');
          let files = [];
          try { files = (await readdir(eventsDir)).filter((file) => file.endsWith('.json')).sort(); } catch {}
          const request = developmentProgressSender ? await readJson(path.join(runDir, 'request.json')) : null;
          for (let index = 0; index < files.length; index += 1) {
            const file = files[index];
            const event = await readJson(path.join(eventsDir, file));
            if (!event) continue;
            const state = developmentProgressSender
              ? await readJson(path.join(runDir, 'state.json'))
              : null;
            const progress = developmentProgressSender
              ? progressForEvent({
                sender: developmentProgressSender,
                request,
                state,
                event,
                sequence: progressSequence(request, index),
                confirmedProgress,
                progressJobs,
                attemptTimeoutMs: progressAttemptTimeoutMs,
                maxAttempts: progressMaxAttempts,
                retryBackoffMs: progressRetryBackoffMs,
              })
              : null;
            if (!subscription.delivered.has(file)) {
              await onEvent(progress ? { ...event, development_progress: progress } : event);
              subscription.delivered.add(file);
            }
            const statePath = path.join(runDir, 'state.json');
            const latestState = await readJson(statePath);
            if (event.kind === 'completed' && latestState?.status === 'delivery_pending') {
              await writeJson(statePath, { ...latestState, status: 'completed', completed_at: event.observed_at });
            }
          }
        } catch {
          // Durable event files remain authoritative and are retried by the next scan.
        } finally {
          const current = subscriptions.get(subscriptionId);
          if (current) current.delivering = false;
        }
      }, POLL_MS);
      timer.unref();
      subscriptions.set(subscriptionId, { timer, delivered: new Set(), delivering: false });
      return { subscription_id: subscriptionId };
    },
    async drainCompletion({ dispatch_id: dispatchId, repo_root: repoRoot }) {
      const searchRoots = authorityRunRoots(runRoots, repoRoot);
      const runDir = await findDispatchRunAcrossRoots(searchRoots, dispatchId);
      if (!runDir) return [];
      const eventsDir = path.join(runDir, 'events');
      let files = [];
      try { files = (await readdir(eventsDir)).filter((file) => file.endsWith('.json')).sort(); } catch { return []; }
      const events = [];
      const request = developmentProgressSender ? await readJson(path.join(runDir, 'request.json')) : null;
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const event = await readJson(path.join(eventsDir, file));
        if (!event) continue;
        const progress = developmentProgressSender
          ? progressForEvent({
            sender: developmentProgressSender,
            request,
            state: await readJson(path.join(runDir, 'state.json')),
            event,
            sequence: progressSequence(request, index),
            confirmedProgress,
            progressJobs,
            attemptTimeoutMs: progressAttemptTimeoutMs,
            maxAttempts: progressMaxAttempts,
            retryBackoffMs: progressRetryBackoffMs,
          })
          : null;
        events.push(progress ? { ...event, development_progress: progress } : event);
      }
      return events;
    },
    registerResumeHandler({ resume }) { resumeHandler = resume; },
    async wake(notification) {
      if (!resumeHandler) throw new Error('Codex parent resume handler is unavailable');
      return resumeHandler(notification);
    },
    async detach() { return { status: 'running_detached' }; }
  };
}

function authorityRunRoots(runRoots, repoRoot) {
  if (typeof repoRoot === 'string' && repoRoot.trim()) {
    const authorityRoot = path.resolve(repoRoot);
    runRoots.add(authorityRoot);
    return [authorityRoot];
  }
  return runRoots;
}

async function claimRun(runDir) {
  try {
    await mkdir(runDir, { mode: 0o700 });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}

async function waitForExistingRun(runDir, request) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [existingRequest, state] = await Promise.all([
      readJson(path.join(runDir, 'request.json')), readJson(path.join(runDir, 'state.json'))
    ]);
    if (existingRequest && state) {
      if (existingRequest.dispatch_id !== request.dispatch_id || existingRequest.idempotency_key !== request.idempotency_key) {
        throw new Error(`Codex run identity collision for ${request.dispatch_id}`);
      }
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Codex idempotent spawn claim did not become readable for ${request.dispatch_id}`);
}

function resolveRunDir(repoRoot, dispatchId, idempotencyKey) {
  const digest = crypto.createHash('sha256').update(`${dispatchId}\0${idempotencyKey}`).digest('hex');
  return path.join(repoRoot, ...HOST_ROOT, digest);
}

async function findRun(repoRoot, providerRunId) {
  const base = path.join(path.resolve(repoRoot), ...HOST_ROOT);
  let entries;
  try { entries = await readdir(base); } catch { return null; }
  for (const entry of entries) {
    const runDir = path.join(base, entry);
    const state = await readJson(path.join(runDir, 'state.json'));
    if (state?.provider_run_id === providerRunId) return runDir;
  }
  return null;
}

async function findRunAcrossRoots(repoRoots, providerRunId) {
  for (const repoRoot of repoRoots) {
    const located = await findRun(repoRoot, providerRunId);
    if (located) return located;
  }
  return null;
}

async function findDispatchRun(repoRoot, dispatchId) {
  const base = path.join(path.resolve(repoRoot), ...HOST_ROOT);
  let entries;
  try { entries = await readdir(base); } catch { return null; }
  for (const entry of entries) {
    const runDir = path.join(base, entry);
    const state = await readJson(path.join(runDir, 'state.json'));
    if (state?.dispatch_id === dispatchId && state.status !== 'cancelled') return runDir;
  }
  return null;
}

async function findDispatchRunAcrossRoots(repoRoots, dispatchId) {
  for (const repoRoot of repoRoots) {
    const located = await findDispatchRun(repoRoot, dispatchId);
    if (located) return located;
  }
  return null;
}

function startedFromState(state) {
  return {
    provider: state.provider, provider_run_id: state.provider_run_id, provider_session_id: state.provider_session_id,
    thread_id: state.thread_id, agent_identity: state.agent_identity, dispatch_id: state.dispatch_id
  };
}

function dispatchIdentityMismatch(request, state, event) {
  const values = [request?.dispatch_id, state?.dispatch_id, event?.dispatch_id]
    .filter((value) => typeof value === 'string' && value.trim() !== '');
  if (values.length < 2) return null;
  return values.every((value) => value === values[0]) ? null : 'dispatch_identity_mismatch';
}

function missingDevelopmentProgressIdentity({ request, progress, state, event, sequence }) {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return ['development_progress'];
  const missing = [];
  if (!hasNonEmptyString(progress.canonical_task_id)) missing.push('canonical_task_id');
  if (!hasNonEmptyString(progress.source)) missing.push('source');
  if (!progress.task_ref || typeof progress.task_ref !== 'object' || Array.isArray(progress.task_ref)) {
    missing.push('task_ref');
  } else {
    for (const field of ['repository', 'story_id', 'task_id']) {
      if (!hasNonEmptyString(progress.task_ref[field])) missing.push(`task_ref.${field}`);
    }
  }
  if (!hasNonEmptyString(progress.plan_version)) missing.push('plan_version');
  if (!Number.isSafeInteger(sequence) || sequence < 1) missing.push('sequence');
  if (!hasNonEmptyString(event?.event_id)) missing.push('event_id');
  if (!hasNonEmptyString(event?.observed_at)) missing.push('observed_at');
  if (!hasNonEmptyString(request?.dispatch_id)
      || !hasNonEmptyString(state?.dispatch_id)
      || !hasNonEmptyString(event?.dispatch_id)) {
    missing.push('dispatch_id');
  }
  if (!Number.isInteger(state?.attempts) || state.attempts < 1) missing.push('execution.attempt');
  if (!hasNonEmptyString(state?.provider_session_id)) missing.push('execution.session_ref');
  if (!hasNonEmptyString(progress.owner ?? state?.agent_identity)) missing.push('execution.owner');
  return missing;
}

function developmentProgressTaskRefMismatch(request, taskRef) {
  const expected = request?.task_ref;
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    for (const field of ['repository', 'story_id', 'task_id']) {
      if (hasNonEmptyString(expected[field]) && taskRef[field] !== expected[field]) {
        return `development_progress_task_ref_mismatch:${field}`;
      }
    }
  }
  for (const field of ['story_id', 'task_id']) {
    if (hasNonEmptyString(request?.[field]) && taskRef[field] !== request[field]) {
      return `development_progress_task_ref_mismatch:${field}`;
    }
  }
  if (hasNonEmptyString(request?.repository) && taskRef.repository !== request.repository) {
    return 'development_progress_task_ref_mismatch:repository';
  }
  return null;
}

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function developmentProgressStatus(event) {
  if (event?.kind === 'partial_result') return 'running';
  if (event?.kind === 'completed') return 'completed';
  if (event?.kind === 'failed') return 'failed';
  return typeof event?.kind === 'string' && event.kind.trim() !== '' ? event.kind : 'observed';
}

function progressForEvent({
  sender,
  request,
  state,
  event,
  sequence,
  confirmedProgress,
  progressJobs,
  attemptTimeoutMs,
  maxAttempts,
  retryBackoffMs,
}) {
  const key = progressKey(state, event);
  const cached = confirmedProgress.get(key);
  if (cached) return cached;

  const existing = progressJobs.get(key);
  if (existing) {
    // The worker writes provider_session_id before publishing its first event,
    // but a scan can still observe the event file first. Refresh the in-memory
    // job with the latest durable state before its next bounded attempt.
    if (state) existing.state = state;
    if (request) existing.request = request;
    existing.event = event;
    existing.sequence = sequence;
    return existing.receipt;
  }

  // The local event is delivered with a mutable receipt immediately. The
  // sender runs in the background, so a slow or unavailable Brainbase cannot
  // delay the caller's onEvent. The same event file remains the source of
  // truth; this map is only an in-process de-duplication guard.
  const job = {
    key,
    sender,
    request,
    state,
    event,
    sequence,
    receipt: { status: DEVELOPMENT_PROGRESS_AWAITING, reason: 'development_progress_pending' },
    attempts: 0,
    running: false,
    done: false,
    timer: null,
    attemptTimeoutMs,
    maxAttempts,
    retryBackoffMs,
    confirmedProgress,
  };
  progressJobs.set(key, job);
  scheduleProgressJob(job);
  return job.receipt;
}

function progressKey(state, event) {
  return `${state?.dispatch_id ?? event?.dispatch_id ?? 'unknown'}:${event?.event_id ?? 'unknown'}`;
}

function scheduleProgressJob(job) {
  if (job.done || job.running || job.timer) return;
  const retryIndex = Math.max(0, job.attempts - 1);
  const delayMs = job.attempts === 0
    ? 0
    : job.retryBackoffMs[Math.min(retryIndex, job.retryBackoffMs.length - 1)] ?? 0;
  job.timer = setTimeout(() => {
    job.timer = null;
    void runProgressJob(job);
  }, delayMs);
  job.timer.unref?.();
}

async function runProgressJob(job) {
  if (job.done || job.running) return;
  job.running = true;
  job.attempts += 1;
  let result;
  try {
    result = await publishDevelopmentProgressWithTimeout(job);
  } catch {
    result = {
      status: DEVELOPMENT_PROGRESS_AWAITING,
      reason: 'development_progress_attempt_failed',
      failure_code: 'attempt_failed',
    };
  }
  updateProgressReceipt(job.receipt, result);
  if (result.status === 'confirmed') {
    job.confirmedProgress.set(job.key, result);
    job.done = true;
  } else if (
    (result.status === 'unconfigured' && result.reason !== 'development_progress_identity_incomplete')
    || result.failure_code === 'attempt_timeout'
    || job.attempts >= job.maxAttempts
  ) {
    // Identity/configuration failures cannot be repaired by another POST.
    // A session that has not been persisted yet remains retryable, as do
    // transport/readback failures, within the bounded attempt budget.
    job.done = true;
  }
  job.running = false;
  if (!job.done) scheduleProgressJob(job);
}

async function publishDevelopmentProgressWithTimeout(job) {
  let timeoutHandle;
  const operation = Promise.resolve().then(() => publishDevelopmentProgress({
    sender: job.sender,
    request: job.request,
    state: job.state,
    event: job.event,
    sequence: job.sequence,
  }));
  const timed = await Promise.race([
    operation.then((result) => ({ timedOut: false, result })),
    new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ timedOut: true }), job.attemptTimeoutMs);
      timeoutHandle.unref?.();
    }),
  ]);
  if (!timed.timedOut) {
    clearTimeout(timeoutHandle);
    return timed.result;
  }

  // A timed-out custom sender may still be pending. Stop automatic retries
  // for this event instead of issuing a concurrent duplicate POST. The real
  // transport also aborts its request, but local delivery never relies on it.
  return {
    status: DEVELOPMENT_PROGRESS_AWAITING,
    reason: 'development_progress_attempt_timeout',
    failure_code: 'attempt_timeout',
  };
}

function updateProgressReceipt(receipt, result) {
  for (const key of Object.keys(receipt)) delete receipt[key];
  Object.assign(receipt, result);
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function normalizeRetryBackoff(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  const normalized = source
    .filter((delay) => Number.isSafeInteger(delay) && delay >= 0)
    .map((delay) => delay);
  return normalized.length > 0 ? normalized : [...fallback];
}

function progressSequence(request, index) {
  const base = request?.development_progress?.sequence;
  if (!Number.isSafeInteger(base) || base < 1 || !Number.isSafeInteger(index) || index < 0) return null;
  const sequence = base + index;
  return Number.isSafeInteger(sequence) ? sequence : null;
}

function workerEnvironment(env, { executable, executableArgs, selectedModel }) {
  const allowed = ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'LC_ALL', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];
  const result = {};
  for (const key of allowed) if (env?.[key] !== undefined) result[key] = env[key];
  result.VIBEPRO_CODEX_EXECUTABLE = executable;
  result.VIBEPRO_CODEX_EXECUTABLE_ARGS = JSON.stringify(executableArgs);
  if (selectedModel) result.VIBEPRO_CODEX_MODEL = selectedModel;
  return result;
}

function isActive(status) { return ['spawning', 'running', 'running_detached'].includes(status); }

async function terminateWorkerTree(runDir, workerPid, workerProcess, codexPid, killProcess) {
  // The worker is the Codex process's direct parent, so let it stop and reap
  // that child before the host escalates. This also keeps process-group signals
  // inside the managed sandbox boundary on hosts that reject negative PIDs.
  signalProcess(workerPid, 'SIGTERM', killProcess);
  const [workerStopped, shutdownAcknowledged] = await Promise.all([
    waitForProcessExit(workerPid, 4000, workerProcess),
    waitForFile(path.join(runDir, 'shutdown-finished.json'), 4000)
  ]);
  // codex-process.json is registered synchronously by the worker, but under
  // host load the initial shutdown() sample can still race ahead of that
  // write landing on disk. Re-resolve codexPid from disk before every
  // escalation stage below so an unknown pid never causes containment to
  // skip signaling the orphaned Codex process tree.
  codexPid = await resolveCodexPid(runDir, codexPid);
  if (workerStopped && shutdownAcknowledged && await waitForPidExit(codexPid, 500, killProcess)) return;
  codexPid = await resolveCodexPid(runDir, codexPid);
  if (Number.isInteger(codexPid) && codexPid > 1) {
    const signaled = process.platform !== 'win32'
      ? signalProcess(-codexPid, 'SIGTERM', killProcess, ['EINVAL', 'EPERM'])
      : signalProcess(codexPid, 'SIGTERM', killProcess);
    if (signaled) {
      const [codexStopped, ownerStopped] = await Promise.all([
        waitForPidExit(codexPid, 2000, killProcess),
        waitForProcessExit(workerPid, 2000, workerProcess)
      ]);
      if (codexStopped && ownerStopped) return;
    }
  }
  if (process.platform !== 'win32') signalProcess(-workerPid, 'SIGTERM', killProcess);
  codexPid = await resolveCodexPid(runDir, codexPid);
  if (await waitForProcessExit(workerPid, 1000, workerProcess)
      && await waitForPidExit(codexPid, 500, killProcess)) return;
  codexPid = await resolveCodexPid(runDir, codexPid);
  if (Number.isInteger(codexPid) && codexPid > 1) {
    if (process.platform !== 'win32') signalProcess(-codexPid, 'SIGKILL', killProcess, ['EINVAL', 'EPERM']);
    else signalProcess(codexPid, 'SIGKILL', killProcess);
  }
  if (process.platform !== 'win32') signalProcess(-workerPid, 'SIGKILL', killProcess);
  else signalProcess(workerPid, 'SIGKILL', killProcess);
  const lateResolvedCodexPid = await resolveCodexPid(runDir, codexPid);
  if (lateResolvedCodexPid !== codexPid && Number.isInteger(lateResolvedCodexPid) && lateResolvedCodexPid > 1) {
    // A pid that only became resolvable after the SIGKILL stage was never
    // signaled by the stages above; kill it before the final confirmation.
    if (process.platform !== 'win32') signalProcess(-lateResolvedCodexPid, 'SIGKILL', killProcess, ['EINVAL', 'EPERM']);
    else signalProcess(lateResolvedCodexPid, 'SIGKILL', killProcess);
  }
  codexPid = lateResolvedCodexPid;
  const [ownerStopped, codexStopped] = await Promise.all([
    waitForProcessExit(workerPid, 1000, workerProcess),
    waitForPidExit(codexPid, 1000, killProcess)
  ]);
  if (!ownerStopped || !codexStopped) {
    throw new Error(`Codex containment could not confirm terminal processes: worker=${workerPid} codex=${codexPid ?? 'unknown'}`);
  }
}

async function resolveCodexPid(runDir, codexPid) {
  if (Number.isInteger(codexPid) && codexPid > 1) return codexPid;
  const codexProcess = await readJson(path.join(runDir, 'codex-process.json'));
  return Number.isInteger(codexProcess?.pid) ? codexProcess.pid : codexPid;
}

async function waitForFile(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(file);
      return true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function waitForJson(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await readJson(file);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return null;
}

function signalProcess(pid, signal, killProcess, fallbackCodes = []) {
  try {
    killProcess(pid, signal);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    if (fallbackCodes.includes(error.code)) return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs, workerProcess) {
  if (workerProcess) {
    if (workerProcess.exitCode !== null || workerProcess.signalCode !== null) return true;
    return Promise.race([
      new Promise((resolve) => workerProcess.once('close', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs))
    ]);
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

async function waitForPidExit(pid, timeoutMs, killProcess) {
  if (!Number.isInteger(pid) || pid <= 1) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      killProcess(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function probeExecutable(executable, executableArgs, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(executable, [...executableArgs, '--version'], { stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(false); }, timeoutMs);
    timer.unref();
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}
