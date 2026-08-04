// Side-effect-free policy kernel for "stay alive while progress advances, die on an
// independent hard cap" semantics. No timers, no child_process, no I/O: every notion of
// "now" comes from the injected `now` clock, and every notion of progress comes from an
// explicit `observe()` call. Enforcement (timers, SIGTERM -> grace -> SIGKILL) belongs to
// the adopter, not this module.
//
// Design principle: a heartbeat (mere liveness) does not extend the no-progress deadline.
// Only a *new*, previously-unseen progress token does. Duplicate tokens are rejected for
// extension purposes. wall-clock / cost / attempts are independent hard caps that progress
// can never extend.

const DEFAULT_MAX_ATTEMPTS = Infinity;
const DEFAULT_MAX_COST_USD = 0;

/**
 * @param {object} options
 * @param {number} options.no_progress_deadline_ms - killed if no NEW progress token is
 *   observed within this many ms.
 * @param {number} options.max_wall_clock_ms - independent hard cap from `started_at`.
 * @param {number} [options.max_attempts] - independent hard cap checked against the
 *   attempts value passed into `check()`.
 * @param {number} [options.max_cost_usd] - independent hard cap checked against the cost
 *   value passed into `check()`. 0 (default) disables cost enforcement.
 * @param {number|string|Date} options.started_at - wall-clock origin.
 * @param {number|string|Date} [options.progress_started_at] - no-progress-clock origin;
 *   defaults to `started_at`. Kept distinct because a resumed/recovered attempt can restart
 *   the no-progress clock without resetting the wall-clock origin.
 * @param {() => (number|string|Date)} [options.now] - injected clock. Defaults to Date.now.
 */
export function createProgressDeadline({
  no_progress_deadline_ms,
  max_wall_clock_ms,
  max_attempts = DEFAULT_MAX_ATTEMPTS,
  max_cost_usd = DEFAULT_MAX_COST_USD,
  started_at,
  progress_started_at,
  now = () => Date.now()
} = {}) {
  if (!Number.isFinite(no_progress_deadline_ms) || no_progress_deadline_ms <= 0) {
    throw new TypeError('createProgressDeadline requires a positive no_progress_deadline_ms');
  }
  if (!Number.isFinite(max_wall_clock_ms) || max_wall_clock_ms <= 0) {
    throw new TypeError('createProgressDeadline requires a positive max_wall_clock_ms');
  }
  if (started_at === undefined || started_at === null) {
    throw new TypeError('createProgressDeadline requires started_at');
  }
  const startedAtMs = toMillis(started_at);
  const seen = new Set();
  let lastProgressAtMs = toMillis(progress_started_at ?? started_at);

  /**
   * Observe a monotonic progress token (a checkpoint id, a cumulative byte count, a
   * completed-test count — anything that is strictly new when real progress happens).
   * A token already seen does NOT move the no-progress clock. Returns whether the
   * no-progress clock advanced.
   *
   * @param {string|number} progressValue
   * @param {object} [opts]
   * @param {number|string|Date} [opts.at] - timestamp of the observation. Defaults to
   *   `now()`. Pass this when replaying a historical event log rather than observing live.
   */
  function observe(progressValue, { at } = {}) {
    if (progressValue === undefined || progressValue === null) return false;
    const key = String(progressValue);
    if (seen.has(key)) return false;
    seen.add(key);
    lastProgressAtMs = toMillis(at ?? now());
    return true;
  }

  /**
   * Evaluate every cause code in precedence order: wall clock -> attempts -> cost ->
   * cost_accounting_unavailable -> no_progress. Returns `{ ok: true }` or
   * `{ ok: false, kill: { code, message, details } }`.
   *
   * @param {object} [opts]
   * @param {number} [opts.attempts] - current attempt count, checked against max_attempts.
   * @param {number|null} [opts.costUsd] - current cumulative cost, or null when cost
   *   accounting is unavailable this check.
   */
  function check({ attempts = 1, costUsd = null } = {}) {
    const nowMs = toMillis(now());
    const elapsedMs = nowMs - startedAtMs;
    const noProgressElapsedMs = nowMs - lastProgressAtMs;
    if (elapsedMs > max_wall_clock_ms) {
      return kill('max_wall_clock_exceeded', { elapsed_ms: elapsedMs, max_wall_clock_ms });
    }
    if (attempts > max_attempts) {
      return kill('max_attempts_exceeded', { attempts, max_attempts });
    }
    if (max_cost_usd > 0 && costUsd !== null && costUsd >= max_cost_usd) {
      return kill('max_cost_exceeded', { cost_usd: costUsd, max_cost_usd });
    }
    if (max_cost_usd > 0 && costUsd === null && noProgressElapsedMs > no_progress_deadline_ms) {
      return kill('cost_accounting_unavailable', { no_progress_elapsed_ms: noProgressElapsedMs, no_progress_deadline_ms });
    }
    if (noProgressElapsedMs > no_progress_deadline_ms) {
      return kill('no_progress_deadline_exceeded', { no_progress_elapsed_ms: noProgressElapsedMs, no_progress_deadline_ms });
    }
    return { ok: true };
  }

  return { observe, check };
}

function kill(code, details) {
  return { ok: false, kill: { code, message: code, details } };
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new TypeError(`progress-deadline: invalid time value: ${JSON.stringify(value)}`);
  return parsed;
}

/**
 * Classify an already-dead process as a policy kill (the kernel's own SIGTERM/SIGKILL) or
 * an external kill (a signal the policy did not send — someone else's SIGTERM, an OOM
 * killer SIGKILL, a manual `kill`). `sentSignals` is the set of signals the adopter itself
 * sent during this process's lifecycle.
 *
 * @param {object} input
 * @param {string|null} [input.signal] - the signal the process exited with, if any.
 * @param {Iterable<string>} [input.sentSignals] - signals the policy sent to this process.
 */
export function classifyTermination({ signal, sentSignals = [] } = {}) {
  if (!signal) return { kind: 'exited', signal: null };
  const sent = new Set(sentSignals);
  return sent.has(signal) ? { kind: 'policy_kill', signal } : { kind: 'external_signal', signal };
}
