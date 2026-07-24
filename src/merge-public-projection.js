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
const PUBLIC_MERGE_KEYS_BY_PATH = new Map([
  ['', new Set([
    'schema_version',
    'created_at',
    'story_id',
    'story',
    'status',
    'strategy',
    'base',
    'dry_run',
    'delete_branch',
    'stop_reason',
    'merge_commit_sha',
    'merged_at',
    'current_head_sha',
    'delivery',
    'reconciliation',
    'reconciliation_action',
    'execution_state_sync',
    'pr',
    'pr_url',
    'preconditions',
    'gate_authorization',
    'artifact_freshness',
    'branch_cleanup',
    'decision_outcome_binding',
    'canonical_audit',
    'cost_accounting',
    'cost_accounting_collection',
    'warnings',
    'output',
    'git'
  ])],
  ['story', new Set(['story_id', 'title', 'status'])],
  ['delivery', new Set(['status', 'observed', 'source', 'pr_url', 'merge_commit_sha', 'merged_at'])],
  ['reconciliation', new Set(['status', 'reasons', 'evaluated_at', 'head_sha'])],
  ['pr', new Set([
    'url',
    'selector',
    'number',
    'state',
    'head_ref_name',
    'head_ref_oid',
    'base_ref_name',
    'merge_state_status',
    'review_decision',
    'checks'
  ])],
  ['pr.checks', new Set(['name', 'status', 'conclusion', 'workflowName', 'workflow_name'])],
  ['preconditions', new Set([
    'gate_ready',
    'clean_worktree',
    'base_freshness',
    'remote_head_match',
    'checks_ready',
    'review_policy',
    'open_pull_request'
  ])],
  ['preconditions.base_freshness', new Set(['status'])],
  ['preconditions.remote_head_match', new Set(['status'])],
  ['preconditions.checks_ready', new Set(['status'])],
  ['preconditions.review_policy', new Set(['status'])],
  ['preconditions.open_pull_request', new Set(['status'])],
  ['gate_authorization', new Set(['allowed', 'source', 'reason', 'gate_override'])],
  ['gate_authorization.gate_override', new Set([
    'allowed',
    'waiver_policy',
    'reason',
    'critical_unresolved_gates',
    'unresolved_gates'
  ])],
  ['gate_authorization.gate_override.critical_unresolved_gates', new Set(['id', 'severity', 'status'])],
  ['gate_authorization.gate_override.unresolved_gates', new Set(['id', 'severity', 'status'])],
  ['artifact_freshness', new Set(['kind', 'status', 'artifact_head_sha', 'current_head_sha'])],
  ['branch_cleanup', new Set(['requested', 'remote', 'local'])],
  ['branch_cleanup.remote', new Set(['attempted', 'deleted', 'status'])],
  ['branch_cleanup.local', new Set(['attempted', 'deleted', 'status'])],
  ['decision_outcome_binding', new Set([
    'status',
    'persistence_status',
    'reason',
    'expected_entry_count',
    'promoted_count',
    'duplicate_count'
  ])],
  ['canonical_audit', new Set(['artifact_count', 'persistence'])],
  ['canonical_audit.persistence', new Set([
    'status',
    'reason',
    'pushed',
    'commit_sha',
    'push_postcondition',
    'cleanup',
    'recovery'
  ])],
  ['canonical_audit.persistence.push_postcondition', new Set(['status', 'remote_sha'])],
  ['canonical_audit.persistence.cleanup', new Set(['attempted', 'removed', 'status'])],
  ['cost_accounting', new Set(['schema_version', 'token_accounting', 'elapsed_time_accounting'])],
  ['cost_accounting.token_accounting', new Set([
    'status',
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'cached_input_tokens',
    'source',
    'window'
  ])],
  ['cost_accounting.elapsed_time_accounting', new Set([
    'status',
    'elapsed_ms',
    'started_at',
    'finished_at',
    'source',
    'window'
  ])],
  ['cost_accounting.token_accounting.window', new Set(['session_id', 'scope'])],
  ['cost_accounting.elapsed_time_accounting.window', new Set(['session_id', 'scope'])],
  ['cost_accounting_collection', new Set(['status', 'reason', 'artifact'])],
  ['output', new Set(['language'])],
  ['git', new Set(['base_branch'])]
]);
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
      : PUBLIC_MERGE_KEYS_BY_PATH.get(keyPath.join('.')) ?? new Set();
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
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => stripUrlCredentials(candidate))
    .replace(/\bAuthorization\s*:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/\b(?:token|password|secret|authorization)\s*[:=]\s*\S+/gi, '[REDACTED]');
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
