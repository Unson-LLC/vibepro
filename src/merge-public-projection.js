const PUBLIC_MERGE_WARNING = 'Merge processing produced a warning. Inspect stop_reason and reconciliation state.';
const PUBLIC_RECONCILIATION_REASON = 'merge_reconciliation_required';
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
  const merge = result?.merge ?? result ?? {};
  return projectPublicMergeValue(merge, []);
}

function projectPublicMergeValue(value, keyPath) {
  if (Array.isArray(value)) {
    if (keyPath.at(-1) === 'warnings') return projectPublicMergeWarnings(value);
    if (keyPath.at(-1) === 'reasons' && keyPath.at(-2) === 'reconciliation') {
      return [...new Set(value.map(projectPublicReconciliationReason))];
    }
    return value.map((item) => projectPublicMergeValue(item, keyPath));
  }
  if (!value || typeof value !== 'object') {
    return keyPath.at(-1) === 'url' ? stripUrlCredentials(value) : value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => (
        !PRIVATE_MERGE_DIAGNOSTIC_KEYS.has(key)
        || (key === 'commands' && keyPath.at(-1) === 'reconciliation_action')
      ))
      .map(([key, item]) => [
        key,
        key === 'reason' && keyPath.at(-1) === 'execution_state_sync'
          ? 'Execution-state synchronization failed after merge processing.'
          : projectPublicMergeValue(item, [...keyPath, key])
      ])
  );
}

function projectPublicReconciliationReason(reason) {
  return typeof reason === 'string' && /^[a-z0-9_:-]+$/i.test(reason)
    ? reason
    : PUBLIC_RECONCILIATION_REASON;
}

function stripUrlCredentials(value) {
  if (typeof value !== 'string') return value;
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
