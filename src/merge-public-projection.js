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
  'gate_status_unresolved',
  'gate_waiver_incomplete',
  'gate_waiver_stale',
  'gate_evidence_missing',
  'artifact_unreadable',
  'gate_authorization_denied',
  'pr_prepare_artifact_missing',
  'pr_prepare_artifact_stale',
  'pr_create_artifact_missing',
  'pr_create_artifact_stale',
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
  'recovery_persistence',
  'error',
  'persistence_error_details'
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
    'gate_authorization_diagnosis',
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
  ['gate_authorization_diagnosis', new Set([
    'schema_version',
    'status',
    'cause',
    'stop_reason',
    'authorization_reason',
    'authorization_source',
    'gate_dag_overall_status',
    'artifact_bindings',
    'blocking_gates',
    'explanation',
    'next_actions'
  ])],
  ['gate_authorization_diagnosis.artifact_bindings', new Set([
    'artifact',
    'status',
    'artifact_head_sha',
    'current_head_sha'
  ])],
  ['gate_authorization_diagnosis.blocking_gates', new Set(['id', 'severity', 'status', 'source'])],
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
  ['canonical_audit', new Set([
    'bundle',
    'directory',
    'artifact_count',
    'missing_artifact_count',
    'persistence',
    'final_persistence'
  ])],
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
  ['canonical_audit.final_persistence', new Set([
    'status',
    'reason',
    'pushed',
    'commit_sha',
    'push_postcondition',
    'cleanup',
    'recovery'
  ])],
  ['canonical_audit.final_persistence.push_postcondition', new Set(['status', 'remote_sha'])],
  ['canonical_audit.final_persistence.cleanup', new Set(['attempted', 'removed', 'status'])],
  ['cost_accounting', new Set([
    'schema_version',
    'status',
    'source',
    'source_path',
    'story_id',
    'session_id',
    'collected_at',
    'token_accounting',
    'elapsed_time_accounting',
    'artifact_token_accounting',
    'session_efficiency_audit'
  ])],
  ['cost_accounting.token_accounting', new Set([
    'status',
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'cached_input_tokens',
    'fresh_input_tokens',
    'reasoning_output_tokens',
    'reason',
    'source',
    'window'
  ])],
  ['cost_accounting.elapsed_time_accounting', new Set([
    'status',
    'elapsed_ms',
    'started_at',
    'finished_at',
    'reason',
    'source',
    'window'
  ])],
  ['cost_accounting.token_accounting.window', new Set(['story_id', 'session_id', 'scope', 'start', 'end'])],
  ['cost_accounting.elapsed_time_accounting.window', new Set(['story_id', 'session_id', 'scope', 'start', 'end'])],
  ['cost_accounting.artifact_token_accounting', new Set([
    'status',
    'estimated_total_tokens',
    'classified_estimated_tokens',
    'total_session_tokens',
    'source',
    'estimate_method',
    'coverage',
    'buckets',
    'provenance_buckets',
    'unique_estimated_tokens',
    'duplicate_estimated_tokens',
    'carryover_control',
    'top_exposures',
    'unmatched_event_count',
    'unmatched_estimated_tokens',
    'window',
    'reason'
  ])],
  ['cost_accounting.artifact_token_accounting.carryover_control', new Set([
    'status',
    'replayed_context_estimated_tokens',
    'duplicate_estimated_tokens',
    'duplicate_over_unique',
    'duplicate_over_unique_threshold'
  ])],
  ['cost_accounting.artifact_token_accounting.window', new Set(['story_id', 'session_id', 'scope', 'start', 'end'])],
  ['cost_accounting.session_efficiency_audit', new Set([
    'artifact_kind',
    'audit_readiness',
    'observed_worktree',
    'observed_worktree_source',
    'cost_breakdown',
    'attribution',
    'primary',
    'upper_bound',
    'mixed_parent',
    'strict_over_associated',
    'artifact_token_accounting'
  ])],
  ['cost_accounting.session_efficiency_audit.audit_readiness', new Set(['status', 'reason', 'missing'])],
  ['cost_accounting.session_efficiency_audit.attribution', new Set([
    'status',
    'primary',
    'upper_bound',
    'mixed_parent',
    'strict_over_associated'
  ])],
  ['cost_accounting.session_efficiency_audit.primary', new Set([
    'basis',
    'event_count',
    'active_span_ms',
    'active_burst_ms',
    'tool_test_ci_wait_ms',
    'tool_other_wait_ms',
    'observed_work_ms'
  ])],
  ['cost_accounting.session_efficiency_audit.upper_bound', new Set([
    'basis',
    'event_count',
    'active_span_ms',
    'active_burst_ms',
    'tool_test_ci_wait_ms',
    'tool_other_wait_ms',
    'observed_work_ms'
  ])],
  ['cost_accounting.session_efficiency_audit.attribution.primary', new Set([
    'basis',
    'event_count',
    'active_span_ms',
    'active_burst_ms',
    'tool_test_ci_wait_ms',
    'tool_other_wait_ms',
    'observed_work_ms'
  ])],
  ['cost_accounting.session_efficiency_audit.attribution.upper_bound', new Set([
    'basis',
    'event_count',
    'active_span_ms',
    'active_burst_ms',
    'tool_test_ci_wait_ms',
    'tool_other_wait_ms',
    'observed_work_ms'
  ])],
  ['cost_accounting_collection', new Set([
    'status',
    'reason',
    'artifact',
    'source',
    'source_path',
    'session_id',
    'collected_at',
    'session_selection',
    'automation_memory',
    'automation_memory_path',
    'observed_worktree',
    'observed_worktree_source',
    'audit_readiness'
  ])],
  ['cost_accounting_collection.session_selection', new Set([
    'status',
    'reason',
    'session_id',
    'source',
    'candidate_count'
  ])],
  ['cost_accounting_collection.automation_memory', new Set([
    'status',
    'source_path',
    'last_run',
    'window_start',
    'window_end',
    'reason'
  ])],
  ['cost_accounting_collection.audit_readiness', new Set(['status', 'reason', 'missing'])],
  ['execution_state_sync.error', new Set(['code'])],
  ['execution_state_sync.persistence_error_details', new Set(['code'])],
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
      : resolvePublicKeys(keyPath);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => (
        (!publicKeys || publicKeys.has(key))
        && (!(['error', 'persistence_error_details'].includes(key)
          && keyPath.at(-1) === 'execution_state_sync')
          || isPublicExecutionDiagnostic(value[key]))
        && (!PRIVATE_MERGE_DIAGNOSTIC_KEYS.has(key)
        || (key === 'commands' && keyPath.at(-1) === 'reconciliation_action')
        || (['error', 'persistence_error_details'].includes(key) && keyPath.at(-1) === 'execution_state_sync')
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

function isPublicExecutionDiagnostic(value) {
  const code = typeof value?.code === 'string' ? value.code : '';
  return /^(?:execution_state_|merge_)[a-z0-9_]+$/.test(code);
}

function resolvePublicKeys(keyPath) {
  const path = keyPath.join('.');
  const exact = PUBLIC_MERGE_KEYS_BY_PATH.get(path);
  if (exact) return exact;
  if (/^cost_accounting(?:\.session_efficiency_audit)?\.artifact_token_accounting\.buckets\.[^.]+$/.test(path)) {
    return new Set([
      'id',
      'label',
      'estimated_tokens',
      'event_count',
      'ratio_of_classified_exposure',
      'ratio_of_session_tokens',
      'matched_signals'
    ]);
  }
  if (/^cost_accounting(?:\.session_efficiency_audit)?\.artifact_token_accounting\.provenance_buckets\.[^.]+$/.test(path)) {
    return new Set([
      'id',
      'estimated_tokens',
      'unique_estimated_tokens',
      'duplicate_estimated_tokens',
      'event_count',
      'unique_digest_count'
    ]);
  }
  if (/^cost_accounting(?:\.session_efficiency_audit)?\.artifact_token_accounting\.(?:buckets|provenance_buckets)$/.test(path)) {
    return null;
  }
  if (path === 'cost_accounting.session_efficiency_audit.artifact_token_accounting') {
    return PUBLIC_MERGE_KEYS_BY_PATH.get('cost_accounting.artifact_token_accounting');
  }
  if (path === 'cost_accounting.session_efficiency_audit.artifact_token_accounting.carryover_control') {
    return PUBLIC_MERGE_KEYS_BY_PATH.get('cost_accounting.artifact_token_accounting.carryover_control');
  }
  if (path === 'cost_accounting.session_efficiency_audit.artifact_token_accounting.window') {
    return PUBLIC_MERGE_KEYS_BY_PATH.get('cost_accounting.artifact_token_accounting.window');
  }
  return new Set();
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
