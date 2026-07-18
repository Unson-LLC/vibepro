import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINATION_GRACE_MS = 100;
const DEFAULT_CLOSE_TIMEOUT_MS = 250;
const DEFAULT_MAX_OUTPUT_BYTES = 16_384;
const TRUNCATION_MARKER = '\n...[truncated]';

/**
 * Execute an owned child process under one finite lifecycle contract.
 * The result is data, including timeout and termination state; command failures
 * are not thrown so callers can retain their existing exit-code decisions.
 */
export async function executeManagedCommand({
  command,
  stage,
  cwd,
  env,
  timeoutMs,
  terminationGraceMs,
  closeTimeoutMs,
  maxOutputBytes,
  redactValues = [],
  runner
} = {}) {
  const settings = resolveSettings({ env, timeoutMs, terminationGraceMs, closeTimeoutMs, maxOutputBytes });
  const safeCommand = boundAndRedact(formatCommand(command), settings.maxOutputBytes, redactValues);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const nonInteractiveEnv = buildNonInteractiveEnv(env);

  if (typeof runner !== 'function') {
    return executeOwnedChild({
      command, stage, cwd, env: nonInteractiveEnv, settings, redactValues,
      safeCommand, startedAt, startedMs
    });
  }

  const controller = new AbortController();
  const outerBudgetMs = settings.timeoutMs + settings.terminationGraceMs + settings.closeTimeoutMs;
  const deadlineAt = Date.now() + settings.timeoutMs;
  const runDefault = () => executeOwnedChild({
    command,
    stage,
    cwd,
    env: nonInteractiveEnv,
    settings: { ...settings, timeoutMs: Math.max(1, deadlineAt - Date.now()) },
    redactValues,
    safeCommand,
    startedAt: new Date().toISOString(),
    startedMs: Date.now()
  });
  const operation = executeManagedOperation({
    stage,
    timeoutMs: outerBudgetMs,
    signalController: controller,
    runner: ({ signal }) => runner({
      command,
      stage,
      cwd,
      env: nonInteractiveEnv,
      signal,
      deadlineAt,
      timeoutMs: settings.timeoutMs,
      runDefault
    })
  });
  const outcome = await operation;
  if (outcome.status === 'succeeded') {
    return normalizeRunnerResult(outcome.value, {
      stage, safeCommand, startedAt, startedMs, settings, redactValues
    });
  }
  if (outcome.status === 'timed_out') {
    return commandResult({
      status: 'timed_out', failureKind: 'runner_timeout', stage, safeCommand,
      startedAt, startedMs, settings, exitCode: null, signal: null,
      stdout: '', stderr: 'injected command runner exceeded its outer deadline', redactValues,
      termination: outcome.termination
    });
  }
  return commandResult({
    status: 'failed', failureKind: 'runner_error', stage, safeCommand,
    startedAt, startedMs, settings, exitCode: 1, signal: null,
    stdout: '', stderr: outcome.diagnostic, redactValues,
    termination: outcome.termination
  });
}

/** Apply a finite outer deadline to an injected async operation. */
export async function executeManagedOperation({
  stage,
  timeoutMs,
  runner,
  signalController
} = {}) {
  const budget = positiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS);
  const controller = signalController ?? new AbortController();
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  let timer;
  const operation = Promise.resolve().then(() => runner({
    signal: controller.signal,
    deadlineAt: startedMs + budget,
    timeoutMs: budget,
    stage
  }));
  // A runner may reject after its caller has already timed out. Observe it.
  operation.catch(() => {});
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ timedOut: true });
    }, budget);
  });
  const settled = await Promise.race([
    operation.then((value) => ({ value }), (error) => ({ error })),
    timeout
  ]);
  clearTimeout(timer);
  const base = {
    stage: stage ?? 'managed.operation',
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startedMs,
    timeout_ms: budget,
    termination: {
      ownership: 'external_runner',
      term_sent: false,
      kill_sent: false,
      close_observed: null,
      abort_requested: controller.signal.aborted
    }
  };
  if (settled.timedOut) return { ...base, status: 'timed_out', failure_kind: 'runner_timeout' };
  if ('error' in settled) {
    const result = {
      ...base,
      status: 'failed',
      failure_kind: 'runner_error',
      diagnostic: boundAndRedact(String(settled.error?.message ?? settled.error), DEFAULT_MAX_OUTPUT_BYTES)
    };
    Object.defineProperty(result, 'error', { value: settled.error, enumerable: false });
    return result;
  }
  return { ...base, status: 'succeeded', failure_kind: null, value: settled.value };
}

export function buildNonInteractiveEnv(env = {}) {
  return {
    ...process.env,
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GH_PROMPT_DISABLED: '1',
    GCM_INTERACTIVE: 'Never'
  };
}

export function sanitizeDiagnostic(value, { maxBytes = DEFAULT_MAX_OUTPUT_BYTES, redactValues = [] } = {}) {
  return boundAndRedact(String(value ?? ''), positiveInteger(maxBytes, DEFAULT_MAX_OUTPUT_BYTES), redactValues);
}

function executeOwnedChild({ command, stage, cwd, env, settings, redactValues, safeCommand, startedAt, startedMs }) {
  return new Promise((resolve) => {
    const [bin, args] = Array.isArray(command) ? command : [];
    let child;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let termSent = false;
    let killSent = false;
    let settled = false;
    let timeoutTimer;
    let escalationTimer;
    let closeTimer;

    const finish = ({ code = null, signal = null, error = null, closeObserved = true, closeTimedOut = false } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(escalationTimer);
      clearTimeout(closeTimer);
      const failureKind = closeTimedOut
        ? 'close_timeout'
        : timedOut
          ? 'command_timeout'
          : error
            ? 'spawn_error'
            : code === 0 ? null : 'exit_code';
      const status = closeTimedOut ? 'indeterminate' : timedOut ? 'timed_out' : code === 0 ? 'succeeded' : 'failed';
      resolve(commandResult({
        status,
        failureKind,
        stage,
        safeCommand,
        startedAt,
        startedMs,
        settings,
        exitCode: Number.isInteger(code) ? code : null,
        signal,
        stdout,
        stderr: error ? `${stderr}\n${String(error.message ?? error)}` : stderr,
        redactValues,
        termination: {
          ownership: process.platform === 'win32' ? 'child' : 'process_group',
          term_sent: termSent,
          kill_sent: killSent,
          close_observed: closeObserved,
          abort_requested: false
        }
      }));
    };

    try {
      child = spawn(bin, args, {
        cwd,
        env,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      finish({ error, closeObserved: false });
      return;
    }
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => { stdout = appendBounded(stdout, chunk, settings.maxOutputBytes * 2); });
    child.stderr?.on('data', (chunk) => { stderr = appendBounded(stderr, chunk, settings.maxOutputBytes * 2); });
    child.once('error', (error) => finish({ error, closeObserved: false }));
    child.once('close', (code, signal) => finish({ code, signal, closeObserved: true }));

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      termSent = terminateOwnedChild(child, 'SIGTERM');
      escalationTimer = setTimeout(() => {
        killSent = terminateOwnedChild(child, 'SIGKILL');
        closeTimer = setTimeout(() => {
          killSent = terminateOwnedChild(child, 'SIGKILL') || killSent;
          child.unref?.();
          finish({ signal: 'SIGKILL', closeObserved: false, closeTimedOut: true });
        }, settings.closeTimeoutMs);
        closeTimer.unref?.();
      }, settings.terminationGraceMs);
      escalationTimer.unref?.();
    }, settings.timeoutMs);
    timeoutTimer.unref?.();
  });
}

function terminateOwnedChild(child, signal) {
  if (!child?.pid) return false;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    return error.code === 'ESRCH';
  }
}

function normalizeRunnerResult(value, context) {
  if (!value || typeof value !== 'object') {
    return commandResult({
      status: 'failed', failureKind: 'runner_result_invalid', stage: context.stage,
      safeCommand: context.safeCommand, startedAt: context.startedAt, startedMs: context.startedMs,
      settings: context.settings, exitCode: 1, signal: null, stdout: '',
      stderr: 'injected command runner returned an invalid result', redactValues: context.redactValues,
      termination: externalTermination(false)
    });
  }
  const exitCode = Number.isInteger(value.exit_code) ? value.exit_code : value.status === 'succeeded' ? 0 : 1;
  return commandResult({
    status: value.status ?? (exitCode === 0 ? 'succeeded' : 'failed'),
    failureKind: value.failure_kind ?? (exitCode === 0 ? null : 'exit_code'),
    stage: value.stage ?? context.stage,
    safeCommand: context.safeCommand,
    startedAt: value.started_at ?? context.startedAt,
    startedMs: context.startedMs,
    settings: context.settings,
    exitCode,
    signal: value.signal ?? null,
    stdout: value.stdout,
    stderr: value.stderr,
    redactValues: context.redactValues,
    termination: value.termination ?? externalTermination(false),
    finishedAt: value.finished_at
  });
}

function commandResult({
  status, failureKind, stage, safeCommand, startedAt, startedMs, settings,
  exitCode, signal, stdout, stderr, redactValues, termination, finishedAt
}) {
  return {
    command: safeCommand,
    stage: stage ?? 'managed.command',
    status,
    failure_kind: failureKind,
    started_at: startedAt,
    finished_at: finishedAt ?? new Date().toISOString(),
    elapsed_ms: Date.now() - startedMs,
    timeout_ms: settings.timeoutMs,
    exit_code: exitCode,
    signal,
    stdout: boundAndRedact(stdout, settings.maxOutputBytes, redactValues),
    stderr: boundAndRedact(stderr, settings.maxOutputBytes, redactValues),
    termination
  };
}

function externalTermination(abortRequested) {
  return {
    ownership: 'external_runner',
    term_sent: false,
    kill_sent: false,
    close_observed: null,
    abort_requested: abortRequested
  };
}

function resolveSettings({ env, timeoutMs, terminationGraceMs, closeTimeoutMs, maxOutputBytes }) {
  const effectiveEnv = { ...process.env, ...env };
  return {
    timeoutMs: positiveInteger(timeoutMs ?? effectiveEnv.VIBEPRO_COMMAND_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    terminationGraceMs: positiveInteger(terminationGraceMs ?? effectiveEnv.VIBEPRO_TERMINATION_GRACE_MS, DEFAULT_TERMINATION_GRACE_MS),
    closeTimeoutMs: positiveInteger(closeTimeoutMs ?? effectiveEnv.VIBEPRO_COMMAND_CLOSE_TIMEOUT_MS, DEFAULT_CLOSE_TIMEOUT_MS),
    maxOutputBytes: positiveInteger(maxOutputBytes ?? effectiveEnv.VIBEPRO_COMMAND_MAX_OUTPUT_BYTES, DEFAULT_MAX_OUTPUT_BYTES)
  };
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function appendBounded(current, chunk, maxBytes) {
  if (Buffer.byteLength(current) >= maxBytes) return current;
  return truncateBytes(`${current}${String(chunk)}`, maxBytes);
}

function boundAndRedact(value, maxBytes, redactValues = []) {
  let safe = String(value ?? '');
  for (const secret of [...redactValues].filter(Boolean).sort((a, b) => String(b).length - String(a).length)) {
    safe = safe.replaceAll(String(secret), '[REDACTED]');
  }
  safe = safe
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,})\b/g, '[REDACTED]')
    .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s'"`]+/gi, '$1[REDACTED]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/gi, '$1[REDACTED]@')
    .replace(/\b((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,'"`]+/gi, '$1[REDACTED]');
  const bounded = truncateBytes(safe, maxBytes);
  return Buffer.byteLength(safe) > maxBytes ? `${bounded}${TRUNCATION_MARKER}` : bounded;
}

function truncateBytes(value, maxBytes) {
  const bytes = Buffer.from(String(value));
  if (bytes.length <= maxBytes) return String(value);
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '');
}

function formatCommand(command) {
  const [bin, args] = Array.isArray(command) ? command : [];
  return [bin, ...(Array.isArray(args) ? args : [])]
    .map((value) => /^[a-zA-Z0-9_./:=@+-]+$/.test(String(value))
      ? String(value)
      : `'${String(value).replaceAll("'", "'\\''")}'`)
    .join(' ');
}
