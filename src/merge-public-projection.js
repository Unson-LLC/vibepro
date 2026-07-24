const PUBLIC_MERGE_WARNING = 'Merge processing produced a warning. Inspect stop_reason and reconciliation state.';
const PUBLIC_RECONCILIATION_REASON = 'merge_reconciliation_required';
const PUBLIC_EXECUTION_STATE_SYNC_REASON = 'Execution-state synchronization failed after merge processing.';
const PUBLIC_RECONCILIATION_REASONS = new Set([
  'base_fetch_failed',
  'checks_not_ready',
  'decision_outcome_binding_failed',
  'delivery_not_verified',
  'dirty_worktree',
  'execution_state_sync_failed',
  'gate_not_ready',
  'provider_command_failed',
  'provider_response_parse_failed',
  'remote_head_mismatch',
  'review_policy_not_satisfied'
]);
const PUBLIC_RECOVERY_COMMAND = /^(?:node bin\/vibepro\.js |vibepro )(?:pr prepare|execute (?:merge|reconcile)) \.(?: --(?:story-id|base|pr) [A-Za-z0-9._~:/?#[\]@!+,%=-]+)*$/;
const PUBLIC_EXECUTION_STATE_SYNC_KEYS = new Set([
  'status',
  'reason',
  'recovery_command',
  'followup_persistence',
  'recovery_persistence'
]);
const PUBLIC_RECONCILIATION_ACTION_KEYS = new Set(['status', 'reason', 'commands']);
const PRIVATE_MERGE_DIAGNOSTIC_KEYS = new Set([
  'worktree_path',
  'command',
  'commands',
  'args',
  'env',
  'output',
  'results',
  'stdout',
  'stderr',
  'primary',
  'error',
  'persistence_error',
  'persistence_error_details',
  'recovery_persistence_error',
  'recovery_persistence_error_details'
]);

export function projectPublicMergeWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return [];
  return [PUBLIC_MERGE_WARNING];
}

export function projectPublicPrMergeResult(result) {
  const merge = isMergeExecutionEnvelope(result) ? result.merge : result ?? {};
  return projectPublicMergeValue(merge, []);
}

function projectPublicMergeValue(value, keyPath) {
  if (Array.isArray(value)) {
    if (keyPath.at(-1) === 'warnings') return projectPublicMergeWarnings(value);
    if (keyPath.at(-1) === 'reasons' && keyPath.at(-2) === 'reconciliation') {
      return [...new Set(value.map(projectPublicReconciliationReason))];
    }
    if (keyPath.at(-1) === 'commands' && keyPath.at(-2) === 'reconciliation_action') {
      return value
        .map(projectPublicRecoveryCommand)
        .filter(Boolean);
    }
    return value.map((item) => projectPublicMergeValue(item, keyPath));
  }
  if (!value || typeof value !== 'object') {
    if (keyPath.at(-1) === 'recovery_command' && keyPath.at(-2) === 'execution_state_sync') {
      return projectPublicRecoveryCommand(value);
    }
    return sanitizePublicString(value);
  }
  const publicKeys = keyPath.at(-1) === 'execution_state_sync'
    ? PUBLIC_EXECUTION_STATE_SYNC_KEYS
    : keyPath.at(-1) === 'reconciliation_action'
      ? PUBLIC_RECONCILIATION_ACTION_KEYS
    : null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => (
        (!publicKeys || publicKeys.has(key))
        && (!PRIVATE_MERGE_DIAGNOSTIC_KEYS.has(key)
        || (key === 'commands' && keyPath.at(-1) === 'reconciliation_action')
        )
      ))
      .map(([key, item]) => [
        key,
        key === 'reason' && keyPath.at(-1) === 'execution_state_sync'
          ? PUBLIC_EXECUTION_STATE_SYNC_REASON
          : key === 'reason' && keyPath.at(-1) === 'reconciliation_action'
            ? projectPublicReconciliationReason(item)
          : projectPublicMergeValue(item, [...keyPath, key])
      ])
  );
}

function projectPublicReconciliationReason(reason) {
  return typeof reason === 'string' && PUBLIC_RECONCILIATION_REASONS.has(reason)
    ? reason
    : PUBLIC_RECONCILIATION_REASON;
}

function projectPublicRecoveryCommand(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  return PUBLIC_RECOVERY_COMMAND.test(trimmed) ? sanitizePublicString(trimmed) : null;
}

function sanitizePublicString(value) {
  if (typeof value !== 'string') return value;
  return value.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => stripUrlCredentials(candidate));
}

function stripUrlCredentials(value) {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return value;
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return value;
  }
}

function isMergeExecutionEnvelope(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  if (!Object.hasOwn(result, 'merge') || !result.merge || typeof result.merge !== 'object') return false;
  return !Object.hasOwn(result, 'status') && !Object.hasOwn(result, 'story');
}
