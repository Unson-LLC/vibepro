export function resolveReconciliationAction(merge = {}) {
  const executionStateSyncFailed = merge.execution_state_sync?.status === 'failed';
  const recoveryCommand = executionStateSyncFailed
    && typeof merge.execution_state_sync.recovery_command === 'string'
    ? merge.execution_state_sync.recovery_command.trim()
    : '';
  if (executionStateSyncFailed) {
    return {
      status: recoveryCommand ? 'required' : 'blocked',
      reason: recoveryCommand
        ? 'execution_state_sync_failed'
        : 'execution_state_sync_recovery_command_missing',
      commands: recoveryCommand ? [recoveryCommand] : []
    };
  }

  const explicitCommands = Array.isArray(merge.reconciliation_action?.commands)
    ? merge.reconciliation_action.commands.filter((command) => typeof command === 'string' && command.trim())
    : [];
  if (explicitCommands.length > 0) {
    return {
      status: merge.reconciliation_action.status ?? 'required',
      reason: merge.reconciliation_action.reason ?? merge.reconciliation?.reasons?.[0] ?? null,
      commands: explicitCommands
    };
  }

  const deliveredDespiteFailure = merge.status === 'failed'
    && ['merged', 'merged_externally'].includes(merge.delivery?.status);
  if (merge.reconciliation?.status !== 'reconciliation_required' && !deliveredDespiteFailure) return null;

  const storyId = merge.story?.story_id ?? '<story-id>';
  const base = merge.base ?? '<base>';
  const retainedPrSelector = merge.pr?.url
    ?? merge.pr?.selector
    ?? merge.delivery?.pr_url
    ?? merge.pr_url
    ?? null;
  return {
    status: 'required',
    reason: merge.reconciliation?.reasons?.[0] ?? merge.stop_reason ?? 'delivery_reconciliation_required',
    commands: [
      `vibepro pr prepare . --story-id ${storyId} --base ${base}`,
      `vibepro execute merge . --story-id ${storyId} --base ${base}${retainedPrSelector ? ` --pr ${retainedPrSelector}` : ''}`
    ]
  };
}
