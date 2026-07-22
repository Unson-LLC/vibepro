import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const POLL_MS = 250;
const HOST_ROOT = ['.vibepro', 'codex-host', 'runs'];

export function createCodexSubagentHost({
  cwd = process.cwd(),
  env = process.env,
  codexExecutable,
  codexExecutableArgs = [],
  model,
  probeTimeoutMs = 10000,
  killProcess = process.kill.bind(process)
} = {}) {
  const executable = codexExecutable ?? env?.VIBEPRO_CODEX_EXECUTABLE ?? 'codex';
  const selectedModel = model ?? env?.VIBEPRO_CODEX_MODEL ?? null;
  const workerPath = fileURLToPath(new URL('./codex-subagent-host-worker.js', import.meta.url));
  let resumeHandler = null;
  const subscriptions = new Map();
  const workers = new Map();
  const runRoots = new Set([path.resolve(cwd)]);

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
        const codexProcess = await readJson(path.join(located, 'codex-process.json'));
        await terminateWorkerTree(state.worker_pid, workers.get(providerRunId), codexProcess?.pid, killProcess);
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
          for (const file of files) {
            if (subscription.delivered.has(file)) continue;
            const event = await readJson(path.join(eventsDir, file));
            if (!event) continue;
            await onEvent(event);
            subscription.delivered.add(file);
            const statePath = path.join(runDir, 'state.json');
            const state = await readJson(statePath);
            if (event.kind === 'completed' && state?.status === 'delivery_pending') {
              await writeJson(statePath, { ...state, status: 'completed', completed_at: event.observed_at });
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
      for (const file of files) {
        const event = await readJson(path.join(eventsDir, file));
        if (event) events.push(event);
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

async function terminateWorkerTree(workerPid, workerProcess, codexPid, killProcess) {
  // Stop the separately-grouped Codex tree while its worker is still alive to
  // reap the direct child. Killing both groups at once can strand a zombie.
  if (Number.isInteger(codexPid) && codexPid > 1) {
    const signaled = process.platform !== 'win32'
      ? signalProcess(-codexPid, 'SIGTERM', killProcess, ['EINVAL', 'EPERM'])
      : signalProcess(codexPid, 'SIGTERM', killProcess);
    if (signaled && await waitForProcessExit(workerPid, 2000, workerProcess)) return;
  }
  // A managed host may not be permitted to signal the Codex process group.
  // The worker owns that direct child and forwards this signal from inside the
  // permitted boundary before reaping it.
  signalProcess(workerPid, 'SIGTERM', killProcess);
  if (await waitForProcessExit(workerPid, 2000, workerProcess)) return;
  if (process.platform !== 'win32') signalProcess(-workerPid, 'SIGTERM', killProcess);
  if (await waitForProcessExit(workerPid, 1000, workerProcess)) return;
  if (process.platform !== 'win32') signalProcess(-workerPid, 'SIGKILL', killProcess);
  else signalProcess(workerPid, 'SIGKILL', killProcess);
  await waitForProcessExit(workerPid, 1000, workerProcess);
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
