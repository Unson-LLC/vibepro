import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentReviewStatus } from './agent-review.js';
import { persistMergeFollowupState } from './merge-manager.js';
import { resolveReconciliationAction } from './reconciliation-action.js';
import { withStoryTransactionLocks } from './story-transaction-lock.js';
import {
  buildMergeGateAuthorization,
  resolveCurrentMergeGateStatus
} from './merge-gate-authorization.js';
import {
  buildExecutionDag,
  buildManagedWorktreeCommands,
  buildPendingManagedWorktree,
  ensureManagedWorktree,
  isManagedWorktreeCommandSafe,
  readManagedExecutionState,
  refreshManagedWorktree
} from './managed-worktree.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import {
  DEFAULT_ARTIFACT_TEMPLATES,
  derivePrArtifactTemplate,
  readArtifactRoutingConfig,
  resolveArtifactRoute,
  resolveGateArtifactFile,
  resolvePrArtifactFile
} from './artifact-routing.js';

const SCHEMA_VERSION = '0.1.0';
const DEFAULT_TARGET = 'pr_create';
const execFileAsync = promisify(execFile);

export async function startExecution(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute start');
  await assertWorkspaceInitialized(repoRoot, 'execute start');
  const existing = await readManagedExecutionState(repoRoot, storyId);
  const managedWorktree = await ensureManagedWorktree(repoRoot, {
    storyId,
    baseRef: options.baseRef,
    branchName: options.branchName,
    worktreePath: options.worktreePath
  });
  const state = await buildExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? DEFAULT_TARGET,
    startedAt: existing?.started_at,
    managedWorktree,
    preserveStartedAt: true
  });
  return writeExecutionStateWithLinkedCopies(repoRoot, state, options);
}

export async function getExecutionStatus(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute status');
  const existing = await readManagedExecutionState(repoRoot, storyId);
  if (existing) {
    // Pass the stored state unrefreshed: buildExecutionState performs the refresh.
    // The policy_sync audit does not depend on refresh count — the last real sync is
    // stamped durably in the worktree (.vibepro/policy-sync.json via
    // recordPolicySyncEvent/withLastPolicySyncEvent) and every refresh resurfaces it
    // as policy_sync.last_event. Refreshing here too would only duplicate git work.
    const managedWorktree = existing.managed_worktree ?? null;
    const state = await buildExecutionState(repoRoot, {
      ...options,
      storyId,
      target: options.target ?? existing.target ?? DEFAULT_TARGET,
      startedAt: existing.started_at,
      managedWorktree,
      repairManagedWorktreeGitExclude: false,
      syncManagedWorktreePolicy: false,
      preserveStartedAt: true
    });
    return {
      state,
      artifact: toWorkspaceRelative(repoRoot, getExecutionStatePath(repoRoot, storyId)),
      found: true
    };
  }
  const managedWorktree = await buildPendingManagedWorktree(repoRoot, {
    storyId,
    baseRef: options.baseRef,
    branchName: options.branchName,
    worktreePath: options.worktreePath
  });
  const state = await buildExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? DEFAULT_TARGET,
    managedWorktree,
    repairManagedWorktreeGitExclude: false,
    syncManagedWorktreePolicy: false
  });
  return {
    state,
    artifact: toWorkspaceRelative(repoRoot, getExecutionStatePath(repoRoot, storyId)),
    found: false
  };
}

export async function getExecutionNext(repoRoot, options = {}) {
  const result = await getExecutionStatus(repoRoot, options);
  return {
    ...result,
    next: {
      completion_status: result.state.completion_status,
      current_phase: result.state.current_phase,
      blocking_gate: result.state.blocking_gate,
      next_actions: result.state.next_actions,
      managed_worktree: result.state.managed_worktree,
      execution_dag: result.state.execution_dag
    }
  };
}

export async function reconcileExecutionState(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute reconcile');
  await assertWorkspaceInitialized(repoRoot, 'execute reconcile');
  const readState = options.readManagedExecutionState ?? readManagedExecutionState;
  const refreshWorktree = options.refreshManagedWorktree ?? refreshManagedWorktree;
  const buildState = options.buildExecutionState ?? buildExecutionState;
  const writeState = options.writeExecutionStateWithLinkedCopies ?? writeExecutionStateWithLinkedCopies;
  const consumeSyncFailure = options.consumeExecutionStateSyncFailure ?? consumeExecutionStateSyncFailure;
  const existing = await readState(repoRoot, storyId);
  const buildOptions = {
    ...options,
    storyId,
    target: options.target ?? existing?.target ?? DEFAULT_TARGET,
    startedAt: existing?.started_at,
    // Unrefreshed on purpose: buildExecutionState performs the refresh, and the
    // policy_sync audit survives any refresh count via the durable worktree stamp
    // (see getExecutionStatus).
    managedWorktree: existing?.managed_worktree ?? null,
    preserveStartedAt: true
  };
  const state = await buildState(repoRoot, buildOptions);
  const initialResult = await writeState(repoRoot, state, {
    ...options,
    expectedCurrentState: existing ?? null
  });
  const recovery = await consumeSyncFailure(repoRoot, {
    storyId,
    baseRef: options.baseRef,
    pr: options.pr
  });
  if (!recovery) return initialResult;

  try {
    const reconciledState = await buildState(repoRoot, buildOptions);
    return await writeState(repoRoot, reconciledState, {
      ...options,
      expectedCurrentState: initialResult.state
    });
  } catch (error) {
    await restoreMergeFollowupStateOrThrow(repoRoot, {
      storyId,
      merge: recovery.original,
      expectedMerge: recovery.recovered,
      originalError: error,
      persist: options.persistMergeFollowupState ?? persistMergeFollowupState
    });
    throw error;
  }
}

async function restoreMergeFollowupStateOrThrow(repoRoot, { storyId, merge, expectedMerge, originalError, persist }) {
  try {
    await persist(repoRoot, { storyId, merge, expectedMerge });
  } catch (restoreError) {
    const transactionError = new Error(
      `execution reconciliation failed and the original merge follow-up artifact could not be restored: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`,
      { cause: originalError }
    );
    transactionError.code = 'execution_reconciliation_restore_failed';
    transactionError.restore_error = restoreError instanceof Error ? restoreError.message : String(restoreError);
    transactionError.restore_errors = restoreError?.restore_errors ?? [];
    throw transactionError;
  }
}

async function consumeExecutionStateSyncFailure(repoRoot, { storyId, baseRef, pr } = {}) {
  const root = path.resolve(repoRoot);
  const mergePath = await resolvePrArtifactFile(root, storyId, 'pr-merge.json');
  const merge = await readJsonIfExists(mergePath);
  if (!merge || merge.execution_state_sync?.status !== 'failed') return null;
  if (!['merged', 'merged_externally'].includes(merge.delivery?.status)) return null;
  if (!merge.reconciliation?.reasons?.includes('execution_state_sync_failed')) return null;

  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  if (!isCurrentPrLifecycleArtifact(merge, currentHeadSha)) return null;
  const retainedBaseRef = resolveMergeBase(merge);
  const retainedPrSelector = resolvePrSelector(merge);
  if (!baseRef || !pr || !retainedBaseRef || !retainedPrSelector) return null;
  if (stripRemote(retainedBaseRef) !== stripRemote(baseRef)) return null;
  if (retainedPrSelector !== pr) return null;

  const recoveredAt = new Date().toISOString();
  const remainingReasons = merge.reconciliation.reasons.filter((reason) => reason !== 'execution_state_sync_failed');
  const resolvedBaseRef = retainedBaseRef;
  const recoveryCommand = merge.execution_state_sync.recovery_command
    ?? `vibepro execute reconcile . --story-id ${storyId} --base ${resolvedBaseRef} --pr ${retainedPrSelector}`;
  const { stop_reason: stopReason, reconciliation_action: reconciliationAction, ...rest } = merge;
  const recovered = {
    ...rest,
    execution_state_sync: {
      ...merge.execution_state_sync,
      previous_status: 'failed',
      previous_reason: merge.execution_state_sync.reason ?? null,
      status: 'reconciled',
      reason: null,
      recovered_at: recoveredAt
    },
    reconciliation: {
      ...merge.reconciliation,
      status: remainingReasons.length > 0 ? 'reconciliation_required' : 'reconciled',
      reasons: remainingReasons,
      evaluated_at: recoveredAt
    },
    reconciliation_action: remainingReasons.length > 0
      ? {
          status: 'required',
          reason: remainingReasons[0],
          commands: [recoveryCommand]
        }
      : {
          status: 'reconciled',
          reason: null,
          commands: []
        }
  };
  if (stopReason && stopReason !== 'execution_state_sync_failed') recovered.stop_reason = stopReason;
  await persistMergeFollowupState(root, { storyId, merge: recovered, expectedMerge: merge });
  return { original: merge, recovered };
}

export async function reconcileAllMergedExecutionStates(repoRoot, options = {}) {
  await assertWorkspaceInitialized(repoRoot, 'execute reconcile --all-merged');
  const root = path.resolve(repoRoot);
  const storyIds = await collectMergedStoryIds(root);
  const stories = [];
  for (const storyId of storyIds) {
    const before = await readManagedExecutionState(root, storyId).catch(() => null);
    const result = await reconcileExecutionState(root, {
      ...options,
      storyId
    });
    const evidence = await collectMergedReconcileEvidence(root, storyId);
    stories.push({
      story_id: storyId,
      before_status: before?.completion_status ?? null,
      after_status: result.state.completion_status,
      changed: (before?.completion_status ?? null) !== result.state.completion_status,
      artifact: result.artifact,
      evidence,
      missing_evidence: inferMissingMergedEvidence(result.state, evidence)
    });
  }
  return {
    schema_version: SCHEMA_VERSION,
    status: 'completed',
    story_count: stories.length,
    updated_story_count: stories.filter((story) => story.changed).length,
    stories
  };
}

export async function updateExecutionStateFromPrPrepare(repoRoot, prepareResult, options = {}) {
  const storyId = prepareResult?.preparation?.story?.story_id ?? options.storyId;
  if (!storyId) return null;
  if (prepareResult?.preparation?.workspace?.initialized !== true) return null;
  return reconcileExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? DEFAULT_TARGET
  });
}

export async function updateExecutionStateFromPrCreate(repoRoot, createResult, options = {}) {
  const storyId = createResult?.execution?.story?.story_id ?? options.storyId;
  if (!storyId) return null;
  if (createResult?.execution?.workspace_initialized !== true) return null;
  const result = await reconcileExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? DEFAULT_TARGET
  });
  const execution = createResult?.execution;
  if (!execution || execution.dry_run) return result;
  const state = {
    ...result.state,
    completion_status: execution.pr_url ? 'pr_created' : result.state.completion_status,
    current_phase: execution.pr_url ? 'complete' : result.state.current_phase,
    completed_phases: execution.pr_url
      ? unique([...result.state.completed_phases, 'create_pr'])
      : result.state.completed_phases,
    pr_url: execution.pr_url ?? result.state.pr_url ?? null,
    next_actions: execution.pr_url ? [] : result.state.next_actions,
    blocking_gate: execution.pr_url ? null : result.state.blocking_gate,
    updated_at: new Date().toISOString()
  };
  return writeExecutionStateWithLinkedCopies(repoRoot, state, options);
}

export async function updateExecutionStateFromPrMerge(repoRoot, mergeResult, options = {}) {
  const storyId = mergeResult?.merge?.story?.story_id ?? options.storyId;
  if (!storyId) return null;
  const result = await reconcileExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? DEFAULT_TARGET
  });
  const merge = mergeResult?.merge;
  const deliveryStatus = merge?.delivery?.status ?? merge?.status;
  if (!merge || !['merged', 'merged_externally'].includes(deliveryStatus)) return result;
  const mergeFailed = merge.status === 'failed';
  const reconciliationRequired = merge.reconciliation?.status !== 'reconciled';
  const reconciliationReasons = merge.reconciliation?.reasons ?? [];
  const failureReason = merge.stop_reason ?? 'merge_failed';
  const retainedPrSelector = resolvePrSelector(merge) ?? result.state.pr_url ?? null;
  const reconciliationAction = merge ? resolveReconciliationAction(merge) : null;
  const synchronizationRecoveryRequired = merge.execution_state_sync?.status === 'failed';
  await options.beforeMergeStateCommit?.({
    repoRoot: path.resolve(repoRoot),
    storyId,
    observedState: structuredClone(result.state),
    merge: structuredClone(merge)
  });
  const state = {
    ...result.state,
    completion_status: synchronizationRecoveryRequired || reconciliationRequired
      ? 'merged_reconciliation_required'
      : mergeFailed ? 'failed' : 'merged',
    current_phase: synchronizationRecoveryRequired
      ? 'reconcile_delivery'
      : mergeFailed
      ? ['canonical_audit_persistence_failed', 'canonical_audit_final_persistence_failed'].includes(failureReason)
        ? 'persist_canonical_audit'
        : 'merge'
      : reconciliationRequired ? 'reconcile_delivery' : 'complete',
    completed_phases: unique([
      ...result.state.completed_phases.filter((phase) => !(deliveryStatus === 'merged_externally' && phase === 'merge_ready')),
      ...(deliveryStatus === 'merged' ? ['merge_ready'] : []),
      'merge'
    ]),
    pr_url: retainedPrSelector,
    delivery: merge.delivery ?? null,
    reconciliation: merge.reconciliation ?? null,
    next_actions: synchronizationRecoveryRequired
      ? reconciliationAction?.commands ?? []
      : mergeFailed
      ? [`Resolve ${failureReason} and re-run \`vibepro execute merge . --story-id ${storyId} --base ${merge.base ?? 'main'}${retainedPrSelector ? ` --pr ${retainedPrSelector}` : ''}\``]
      : reconciliationRequired
      ? reconciliationAction?.commands ?? [
          `Refresh current-head evidence with \`vibepro pr prepare . --story-id ${storyId} --base ${merge.base ?? 'main'}\``,
          `Re-run \`vibepro execute merge . --story-id ${storyId} --base ${merge.base ?? 'main'}${retainedPrSelector ? ` --pr ${retainedPrSelector}` : ''}\` after reconciliation`
        ]
      : [],
    blocking_gate: synchronizationRecoveryRequired
      ? {
          id: 'delivery_reconciliation',
          status: 'blocked',
          reasons: unique([...reconciliationReasons, reconciliationAction?.reason].filter(Boolean))
        }
      : mergeFailed
      ? { id: 'merge_failure', status: 'blocked', reason: failureReason }
      : reconciliationRequired
      ? {
          id: 'delivery_reconciliation',
          status: 'blocked',
          reasons: reconciliationReasons
        }
      : null,
    updated_at: new Date().toISOString()
  };
  return writeExecutionStateWithLinkedCopies(repoRoot, state, {
    ...options,
    expectedCurrentState: result.state
  });
}

export function renderExecutionStateSummary(result) {
  const state = result.state ?? result;
  const actions = state.next_actions?.length
    ? state.next_actions.map((action) => `- ${action}`).join('\n')
    : '- none';
  const managedWorktree = formatManagedWorktreeSummary(state.managed_worktree);
  const executionDag = formatExecutionDagSummary(state.execution_dag);
  return `# VibePro Execution State

- story: ${state.story_id}
- target: ${state.target}
- status: ${state.completion_status}
- phase: ${state.current_phase}
- delivery: ${state.delivery?.status ?? 'unknown'}
- reconciliation: ${state.reconciliation?.status ?? 'unknown'}
- reconciliation_reasons: ${(state.reconciliation?.reasons ?? []).join('|') || 'none'}
- blocking_gate: ${state.blocking_gate?.id ?? 'none'}
- managed_worktree: ${managedWorktree.headline}
- execution_dag: ${executionDag.headline}
- artifact: ${result.artifact ?? '-'}

## Managed Worktree

${managedWorktree.details}

## Execution DAG

${executionDag.details}

## Next Actions

${actions}
`;
}

export function renderExecutionNextSummary(result) {
  const next = result.next ?? result;
  const state = result.state ?? result;
  const actions = next.next_actions?.length
    ? next.next_actions.map((action) => `- ${action}`).join('\n')
    : '- none';
  const managedWorktree = formatManagedWorktreeSummary(state.managed_worktree);
  const executionDag = formatExecutionDagSummary(state.execution_dag);
  return `# VibePro Next Action

- status: ${next.completion_status}
- phase: ${next.current_phase}
- delivery: ${state.delivery?.status ?? 'unknown'}
- reconciliation: ${state.reconciliation?.status ?? 'unknown'}
- reconciliation_reasons: ${(state.reconciliation?.reasons ?? []).join('|') || 'none'}
- blocking_gate: ${next.blocking_gate?.id ?? 'none'}
- managed_worktree: ${managedWorktree.headline}
- execution_dag: ${executionDag.headline}

## Managed Worktree

${managedWorktree.details}

## Execution DAG

${executionDag.details}

${actions}
`;
}

export function renderExecutionReconcileAllSummary(result) {
  const rows = result.stories?.length
    ? result.stories.map((story) => (
        `- ${story.story_id}: ${story.before_status ?? 'none'} -> ${story.after_status} evidence=${story.evidence.map((item) => item.kind).join('|') || '-'} missing=${story.missing_evidence.join('|') || '-'}`
      )).join('\n')
    : '- none';
  return `# VibePro Merged Reconcile

- status: ${result.status}
- stories: ${result.story_count}
- updated: ${result.updated_story_count}

${rows}
`;
}

function formatManagedWorktreeSummary(managedWorktree) {
  if (!managedWorktree) {
    return {
      headline: 'not_recorded',
      details: '- status: not_recorded'
    };
  }
  const policySync = managedWorktree.policy_sync ?? null;
  // A fail-soft sync failure must be visible on the default text surface, not only in --json:
  // silent policy drift is exactly what this state exists to prevent.
  const policySyncHeadline = policySync?.status === 'failed' ? '/policy_sync_failed' : '';
  const headline = `${managedWorktree.mode ?? 'unknown'}/${managedWorktree.status ?? 'unknown'}${policySyncHeadline}`;
  const policySyncLines = policySync
    ? [
      `- policy_sync: ${policySync.status ?? '-'}${policySync.sections_updated?.length ? ` (${policySync.sections_updated.join(', ')})` : ''}`,
      ...(policySync.status === 'failed' || policySync.status === 'skipped'
        ? [`- policy_sync_reason: ${policySync.reason ?? '-'}`]
        : []),
      ...(policySync.last_event
        ? [`- policy_sync_last_event: ${policySync.last_event.status ?? '-'}${policySync.last_event.sections_updated?.length ? ` (${policySync.last_event.sections_updated.join(', ')})` : ''} at ${policySync.last_event.synced_at ?? '-'}`]
        : [])
    ]
    : ['- policy_sync: not_recorded'];
  return {
    headline,
    details: [
      `- mode: ${managedWorktree.mode ?? '-'}`,
      `- status: ${managedWorktree.status ?? '-'}`,
      `- path: ${managedWorktree.path ?? '-'}`,
      `- branch: ${managedWorktree.branch ?? '-'}`,
      `- actual_branch: ${managedWorktree.actual_branch ?? '-'}`,
      `- current_head_sha: ${managedWorktree.current_head_sha ?? '-'}`,
      `- branch_match: ${managedWorktree.branch_match === false ? 'false' : managedWorktree.branch_match === true ? 'true' : '-'}`,
      `- dirty: ${managedWorktree.dirty === true ? 'true' : managedWorktree.dirty === false ? 'false' : '-'}`,
      `- raw_dirty: ${managedWorktree.raw_dirty === true ? 'true' : managedWorktree.raw_dirty === false ? 'false' : '-'}`,
      `- raw_dirty_fingerprint: ${managedWorktree.raw_dirty_fingerprint ?? '-'}`,
      ...policySyncLines
    ].join('\n')
  };
}

function formatExecutionDagSummary(executionDag) {
  const nodes = Array.isArray(executionDag?.nodes) ? executionDag.nodes : [];
  if (nodes.length === 0) {
    return {
      headline: 'not_recorded',
      details: '- nodes: none'
    };
  }
  const blockers = nodes.filter((node) => ['blocked', 'needs_evidence', 'failed'].includes(node.status));
  return {
    headline: `${nodes.length} nodes, ${blockers.length} blockers`,
    details: nodes
      .map((node) => `- ${node.id}: ${node.status}${node.reason ? ` (${node.reason})` : ''}`)
      .join('\n')
  };
}

async function buildExecutionState(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options.storyId, 'execution state');
  const now = new Date().toISOString();
  const prPreparePath = await resolvePrArtifactFile(root, storyId);
  const verificationEvidencePath = await resolvePrArtifactFile(root, storyId, 'verification-evidence.json');
  const prCreatePath = await resolvePrArtifactFile(root, storyId, 'pr-create.json');
  const prMergePath = await resolvePrArtifactFile(root, storyId, 'pr-merge.json');
  const gateDagPath = await resolveGateArtifactFile(root, storyId);
  const [prPrepare, verificationEvidence, prCreate, prMerge, canonicalPrMerge, canonicalBundle, gateDagArtifact, agentReview] = await Promise.all([
    readJsonIfExists(prPreparePath),
    readJsonIfExists(verificationEvidencePath),
    readJsonIfExists(prCreatePath),
    readJsonIfExists(prMergePath),
    readJsonIfExists(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-merge.json')),
    readJsonIfExists(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json')),
    readJsonIfExists(gateDagPath),
    getAgentReviewStatus(root, { storyId }).catch(() => null)
  ]);
  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  const managedWorktree = options.managedWorktree
    ? await refreshManagedWorktree(root, options.managedWorktree, {
        repairGitExclude: options.repairManagedWorktreeGitExclude !== false,
        syncPolicy: options.syncManagedWorktreePolicy !== false
      }).catch(() => options.managedWorktree)
    : null;
  const expectedHeadSha = await resolveExecutionExpectedHead(root, managedWorktree, currentHeadSha);
  const currentPrPrepare = isCurrentPrLifecycleArtifact(prPrepare, expectedHeadSha) ? prPrepare : null;
  const currentPrCreate = isCurrentPrLifecycleArtifact(prCreate, expectedHeadSha) ? prCreate : null;
  const localCurrentPrMerge = isCurrentPrLifecycleArtifact(prMerge, expectedHeadSha) ? prMerge : null;
  const currentPrMerge = resolveExecutionPrMerge({
    local: localCurrentPrMerge,
    canonical: canonicalPrMerge,
    bundle: canonicalBundle?.merge ?? null,
    expectedBaseRef: options.baseRef
      ?? resolveMergeBase(localCurrentPrMerge)
      ?? currentPrCreate?.base
      ?? currentPrPrepare?.git?.base_ref
      ?? null,
    expectedPrSelector: resolvePrSelector(localCurrentPrMerge)
      ?? currentPrCreate?.pr_url
      ?? null
  });
  const resolvedBaseRef = options.baseRef
    ?? currentPrMerge?.base
    ?? currentPrMerge?.git?.base_branch
    ?? currentPrCreate?.base
    ?? currentPrPrepare?.git?.base_ref
    ?? 'main';
  const currentGateDagArtifact = isCurrentPrLifecycleArtifact(gateDagArtifact, expectedHeadSha)
    ? gateDagArtifact
    : null;
  // pr-prepare is the readiness source of truth. A same-HEAD standalone DAG can
  // still be older because evidence changes do not create a git commit, so it
  // is only a fallback when no current pr-prepare/pr-create artifact exists.
  const gateStatus = currentPrPrepare?.gate_status ?? null;
  const gateDag = currentPrPrepare?.pr_context?.gate_dag
    ?? currentPrCreate?.gate_dag
    ?? currentGateDagArtifact
    ?? null;
  const currentMergeGateStatus = resolveCurrentMergeGateStatus(
    currentPrPrepare,
    expectedHeadSha,
    gateDag
  );
  const mergeGateAuthorization = buildMergeGateAuthorization(
    gateDag,
    currentPrCreate,
    currentMergeGateStatus
  );
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag);
  const blockingGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const executionBlockers = collectRequiredExecutionBlockers(
    buildExecutionDag({
      managedWorktree,
      completedPhases: [],
      completionStatus: 'not_prepared',
      expectedHeadSha
    }),
    { storyId, baseRef: resolvedBaseRef, managedWorktree, expectedHeadSha }
  );
  const executionBlockingGate = executionBlockers[0] ?? null;
  const delivery = currentPrMerge?.delivery ?? null;
  const reconciliation = currentPrMerge?.reconciliation ?? null;
  const hasExplicitDelivery = typeof delivery?.status === 'string';
  const deliveryStatus = delivery?.status ?? currentPrMerge?.status ?? null;
  const deliveryObserved = ['merged', 'merged_externally'].includes(deliveryStatus);
  const reconciliationRequired = deliveryObserved && reconciliation?.status !== 'reconciled';
  const deliveryResolutionRequired = hasExplicitDelivery && (
    !deliveryObserved || reconciliation?.status !== 'reconciled'
  );
  const mergeFailed = currentPrMerge?.status === 'failed';
  const synchronizationRecoveryRequired = currentPrMerge?.execution_state_sync?.status === 'failed';
  const mergeFailureGate = mergeFailed
    ? {
        id: 'merge_failure',
        status: 'blocked',
        reasons: [currentPrMerge?.stop_reason ?? 'merge_failed']
      }
    : null;
  const deliveryReconciliationGate = (deliveryResolutionRequired || reconciliationRequired)
    ? {
        id: 'delivery_reconciliation',
        status: 'blocked',
        reasons: reconciliation?.reasons ?? []
      }
    : null;
  const blockingGate = synchronizationRecoveryRequired
    ? deliveryReconciliationGate
    : mergeFailureGate ?? deliveryReconciliationGate ?? executionBlockingGate ?? pickBlockingGate(blockingGates);
  const prCreated = Boolean(currentPrCreate?.pr_url && currentPrCreate?.dry_run !== true);
  const merged = deliveryObserved || (!hasExplicitDelivery && (
    currentPrMerge?.status === 'merged' || Boolean(currentPrMerge?.merged_at || currentPrMerge?.merge_commit_sha)
  ));
  const agentReviewSatisfied = isGateAgentReviewSatisfied(agentReview);
  const gatesReadyForPrCreate = gateDag
    ? Boolean((currentPrPrepare || currentPrCreate) && gateDag.overall_status === 'ready_for_review' && unresolvedGates.length === 0)
    : gateStatus?.ready_for_pr_create === true && gateStatus?.execution_gate?.status !== 'waiver_required';
  const readyForPrCreate = gatesReadyForPrCreate && !executionBlockingGate;
  const prCreatedReadyForMerge = prCreated && !executionBlockingGate && (
    gateDag ? mergeGateAuthorization.allowed : (!currentPrPrepare || readyForPrCreate)
  );
  const waiverRequired = !prCreatedReadyForMerge && !readyForPrCreate && Boolean(currentPrPrepare) && (
    executionBlockingGate
      ? false
      : gateDag
      ? unresolvedGates.length > 0 && blockingGates.length === 0
      : gateStatus?.execution_gate?.status === 'waiver_required'
  );
  const completionStatus = synchronizationRecoveryRequired
    ? 'merged_reconciliation_required'
    : mergeFailed
    ? 'failed'
    : reconciliationRequired
    ? 'merged_reconciliation_required'
    : deliveryResolutionRequired
    ? 'blocked'
    : merged
    ? 'merged'
    : prCreatedReadyForMerge
    ? 'pr_created'
    : readyForPrCreate
      ? 'ready_for_pr_create'
      : waiverRequired
        ? 'waiver_required'
      : executionBlockingGate
        ? 'blocked'
      : currentPrPrepare
        ? 'blocked'
        : 'not_prepared';
  const currentPhase = synchronizationRecoveryRequired
    ? 'reconcile_delivery'
    : mergeFailed
    ? (deliveryObserved ? 'persist_canonical_audit' : 'merge')
    : deliveryResolutionRequired
    ? 'reconcile_delivery'
    : merged
    ? 'complete'
    : prCreatedReadyForMerge
    ? 'complete'
    : readyForPrCreate
      ? 'create_pr'
      : waiverRequired
        ? 'verification'
        : executionBlockingGate
          ? 'prepare_pr'
        : blockingGate?.id === 'gate:agent_review' || blockingGate?.id?.startsWith('review:')
        ? 'agent_review'
        : blockingGate
          ? 'verification'
          : 'prepare_pr';
  const completedPhases = deriveCompletedPhases({
    prPrepare: currentPrPrepare,
    verificationEvidence,
    agentReviewSatisfied,
    readyForPrCreate,
    prCreated,
    merged,
    hasExplicitDelivery,
    prMerge: currentPrMerge
  });
  const requiredCommands = buildManagedWorktreeCommands({
    pr_prepare: buildPrPrepareCommand({ storyId, baseRef: resolvedBaseRef }),
    pr_create: buildPrCreateCommand({ storyId, baseRef: resolvedBaseRef })
  }, managedWorktree, { expectedHeadSha });
  const retainedPrSelector = resolvePrSelector(currentPrMerge);
  const reconciliationAction = currentPrMerge ? resolveReconciliationAction(currentPrMerge) : null;
  const nextActions = synchronizationRecoveryRequired
    ? reconciliationAction?.commands ?? []
    : mergeFailed
    ? [
        `Resolve ${currentPrMerge?.stop_reason ?? 'the merge failure'} and re-run \`vibepro execute merge . --story-id ${storyId} --base ${resolvedBaseRef}${retainedPrSelector ? ` --pr ${retainedPrSelector}` : ''}\``
      ]
    : deliveryResolutionRequired
    ? reconciliationAction?.commands ?? [
        `Refresh current-head evidence with \`vibepro pr prepare . --story-id ${storyId} --base ${resolvedBaseRef}\``,
        `Re-run \`vibepro execute merge . --story-id ${storyId} --base ${resolvedBaseRef}${retainedPrSelector ? ` --pr ${retainedPrSelector}` : ''}\` after reconciliation`
      ]
    : deriveNextActions({
    storyId,
    baseRef: resolvedBaseRef,
    managedWorktree,
    expectedHeadSha,
    prPrepare: currentPrPrepare,
    gateStatus,
    unresolvedGates,
    blockingGate,
    waiverRequired,
    readyForPrCreate,
    prCreated: prCreatedReadyForMerge,
        merged
      });
  return {
    schema_version: SCHEMA_VERSION,
    story_id: storyId,
    target: options.target ?? DEFAULT_TARGET,
    started_at: options.preserveStartedAt ? (options.startedAt ?? now) : now,
    updated_at: now,
    current_phase: currentPhase,
    completed_phases: completedPhases,
    completion_status: completionStatus,
    blocking_gate: blockingGate,
    delivery,
    reconciliation,
    next_actions: nextActions,
    required_commands: requiredCommands,
    managed_worktree: managedWorktree,
    execution_dag: buildExecutionDag({ managedWorktree, completedPhases, completionStatus, expectedHeadSha, prMerge: currentPrMerge }),
    last_pr_prepare: currentPrPrepare ? await summarizePrPrepare(root, currentPrPrepare) : null,
    last_review_status: agentReview ? summarizeAgentReview(agentReview) : null,
    last_verification_evidence: verificationEvidence ? await summarizeVerificationEvidence(root, verificationEvidence) : null,
    pr_url: currentPrCreate?.pr_url ?? retainedPrSelector ?? null
  };
}

async function resolveExecutionExpectedHead(root, managedWorktree, currentHeadSha) {
  if (!currentHeadSha || !managedWorktree?.current_head_sha || !managedWorktree?.path) return currentHeadSha;
  const currentRoot = path.resolve(root);
  const managedRoot = path.resolve(managedWorktree.path);
  if (currentRoot === managedRoot) return currentHeadSha;
  if (await gitIsAncestor(root, currentHeadSha, managedWorktree.current_head_sha)) {
    return managedWorktree.current_head_sha;
  }
  return currentHeadSha;
}

function deriveCompletedPhases({ prPrepare, verificationEvidence, agentReviewSatisfied, readyForPrCreate, prCreated, merged, hasExplicitDelivery, prMerge }) {
  const phases = [];
  const deliveryMergeReady = hasExplicitDelivery
    ? prMerge.delivery.status === 'merged'
    : ['ready_to_merge', 'merged', 'merged_externally'].includes(prMerge?.status);
  if (prPrepare) phases.push('prepare_pr');
  if ((verificationEvidence?.commands ?? []).length > 0) phases.push('verify');
  if (agentReviewSatisfied || (merged && !hasExplicitDelivery)) {
    phases.push('agent_review');
  }
  if (readyForPrCreate) phases.push('ready_for_pr_create');
  if (prCreated) phases.push('create_pr');
  if (deliveryMergeReady) phases.push('merge_ready');
  if (merged) phases.push('merge');
  return phases;
}

function resolveExecutionPrMerge({ local, canonical, bundle, expectedBaseRef, expectedPrSelector }) {
  // Delivery is an observed, monotonic fact. A current local provider failure
  // may update reconciliation, but it cannot erase a durable positive delivery
  // preserved in canonical or bundle evidence.
  if (typeof local?.delivery?.status === 'string') {
    if (['merged', 'merged_externally'].includes(local.delivery.status)) return local;
    const observedFallback = expectedBaseRef && expectedPrSelector
      ? [canonical, bundle].find((artifact) => (
          ['merged', 'merged_externally'].includes(artifact?.delivery?.status)
          && deliveryIdentityMatches(artifact, { expectedBaseRef, expectedPrSelector })
        ))
      : null;
    if (observedFallback) {
      return {
        ...local,
        delivery: observedFallback.delivery,
        merge_commit_sha: local.merge_commit_sha
          ?? observedFallback.merge_commit_sha
          ?? observedFallback.delivery?.merge_commit_sha
          ?? null,
        merged_at: local.merged_at
          ?? observedFallback.merged_at
          ?? observedFallback.delivery?.merged_at
          ?? null
      };
    }
    return local;
  }
  // A legacy local artifact can still be the only durable merge evidence even
  // though it predates the explicit delivery axis. Keep it in the fallback
  // set instead of dropping it during an upgrade.
  const artifacts = [local, canonical, bundle].filter(Boolean);
  if (local && isMergedArtifact(local)) return local;
  const explicit = artifacts.filter((artifact) => typeof artifact?.delivery?.status === 'string');
  const explicitNegative = explicit.find((artifact) => !['merged', 'merged_externally'].includes(artifact.delivery.status));
  if (explicitNegative) return explicitNegative;
  const identityBoundFallback = expectedBaseRef && expectedPrSelector
    ? artifacts.find((artifact) => (
        isMergedArtifact(artifact)
        && deliveryIdentityMatches(artifact, { expectedBaseRef, expectedPrSelector })
      ))
    : null;
  return identityBoundFallback ?? null;
}

function resolvePrSelector(artifact) {
  return artifact?.pr?.url
    ?? artifact?.pr?.selector
    ?? artifact?.delivery?.pr_url
    ?? artifact?.pr_url
    ?? null;
}

function resolveMergeBase(artifact) {
  return artifact?.base ?? artifact?.git?.base_branch ?? artifact?.git?.base_ref ?? null;
}

function deliveryIdentityMatches(artifact, { expectedBaseRef, expectedPrSelector }) {
  const artifactBase = resolveMergeBase(artifact);
  return Boolean(
    artifactBase
    && resolvePrSelector(artifact) === expectedPrSelector
    && stripRemote(artifactBase) === stripRemote(expectedBaseRef)
  );
}

function stripRemote(ref) {
  return String(ref ?? '')
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/[^/]+\//, '')
    .replace(/^origin\//, '');
}

function isCurrentPrLifecycleArtifact(artifact, currentHeadSha) {
  if (!artifact || !currentHeadSha) return false;
  const artifactHeadSha = artifact.artifact_freshness?.artifact_head_sha
    ?? artifact.current_head_sha
    ?? artifact.git?.head_sha
    ?? artifact.toolchain?.source_git?.commit
    ?? artifact.git_context?.head_sha
    ?? null;
  if (artifact.artifact_freshness) {
    return artifact.artifact_freshness.status === 'current' && artifactHeadSha === currentHeadSha;
  }
  return artifactHeadSha === currentHeadSha;
}

function isGateAgentReviewSatisfied(agentReview) {
  const gateStage = (agentReview?.stages ?? []).find((stage) => stage.stage === 'gate');
  if (!gateStage) return false;
  return gateStage.status === 'pass'
    && (gateStage.missing_count ?? 0) === 0
    && (gateStage.stale_count ?? 0) === 0
    && (gateStage.block_count ?? 0) === 0
    && (gateStage.unverified_agent_count ?? 0) === 0;
}

function deriveNextActions({ storyId, baseRef, managedWorktree, expectedHeadSha, prPrepare, gateStatus, unresolvedGates = [], blockingGate, waiverRequired, readyForPrCreate, prCreated, merged }) {
  const wrap = (command) => isManagedWorktreeCommandSafe(managedWorktree, { expectedHeadSha })
    ? `cd ${shellQuote(managedWorktree.path)} && ${command}`
    : command;
  const routeAction = (action) => routeActionThroughManagedWorktree(action, wrap);
  const wrapActions = (actions) => actions.map(routeAction);
  if (merged) return [];
  if (prCreated) return [wrap(buildExecuteMergeCommand({ storyId, baseRef }))];
  if (!prPrepare && managedWorktree?.status === 'missing' && managedWorktree.mode !== 'disabled') {
    return [buildExecuteStartCommand({ storyId, baseRef })];
  }
  if (!prPrepare) return [wrap(buildPrPrepareCommand({ storyId, baseRef }))];
  if (readyForPrCreate) return [wrap(buildPrCreateCommand({ storyId, baseRef }))];
  if (waiverRequired) {
    const actions = unresolvedGates
      .flatMap((gate) => gate.required_actions?.length ? gate.required_actions : [gate.reason])
      .filter(Boolean);
    if (actions.length > 0) return wrapActions(actions);
    return ['Resolve unresolved non-critical gates or rerun PR create with an explicit verification waiver.'];
  }
  if (blockingGate) {
    if (blockingGate.required_actions?.length) return wrapActions(blockingGate.required_actions);
    return [blockingGate.reason ?? `Resolve ${blockingGate.label ?? blockingGate.id}`];
  }
  const actions = gateStatus?.next_required_actions?.length
    ? gateStatus.next_required_actions
    : gateStatus?.execution_gate?.required_actions ?? [];
  if (actions.length > 0) return wrapActions(actions);
  return [wrap(buildPrPrepareCommand({ storyId, baseRef }))];
}

function routeActionThroughManagedWorktree(action, wrap) {
  const text = String(action ?? '');
  if (/^vibepro\s+/.test(text.trim())) return wrap(text);
  return text.replace(/`(vibepro\s+[^`]+)`/g, (_match, command) => `\`${wrap(command)}\``);
}

async function summarizePrPrepare(root, prPrepare) {
  const storyId = prPrepare.story?.story_id ?? prPrepare.story_id ?? 'unknown';
  return {
    artifact: toWorkspaceRelative(root, await resolvePrArtifactFile(root, storyId, 'pr-prepare.json')),
    created_at: prPrepare.created_at ?? null,
    overall_status: prPrepare.gate_status?.overall_status ?? prPrepare.pr_context?.gate_dag?.overall_status ?? null,
    ready_for_pr_create: prPrepare.gate_status?.ready_for_pr_create === true,
    head_sha: prPrepare.git?.head_sha ?? prPrepare.git?.head_ref ?? null
  };
}

function summarizeAgentReview(agentReview) {
  return {
    status: agentReview.summary?.overall_status ?? agentReview.status ?? null,
    required_review_count: agentReview.summary?.required_review_count ?? 0,
    unmet_required_review_count: agentReview.summary?.unmet_required_review_count ?? 0,
    stages: (agentReview.stages ?? []).map((stage) => ({
      stage: stage.stage,
      status: stage.status,
      missing_count: stage.missing_count,
      stale_count: stage.stale_count,
      block_count: stage.block_count,
      unverified_agent_count: stage.unverified_agent_count
    }))
  };
}

async function summarizeVerificationEvidence(root, evidence) {
  return {
    artifact: toWorkspaceRelative(root, await resolvePrArtifactFile(root, evidence.story_id, 'verification-evidence.json')),
    updated_at: evidence.updated_at ?? null,
    command_count: (evidence.commands ?? []).length,
    kinds: unique((evidence.commands ?? []).map((command) => command.kind).filter(Boolean))
  };
}

function collectUnresolvedRequiredGates(gateDag) {
  const nodes = Array.isArray(gateDag?.nodes) ? gateDag.nodes : [];
  const unresolved = nodes
    .filter((node) => [
      'story',
      'story_source_integrity_gate',
      'engineering_judgment_spine_gate',
      'pr_scope_judgment_gate',
      'pr_route_gate',
      'pr_body_contract_gate',
      'mirror_source_traceability_gate',
      'ci_status_or_waiver_gate',
      'vibepro_artifact_policy_gate',
      'split_resolution_gate',
      'managed_worktree_gate',
      'security_regression_gate',
      'agent_evidence_lifecycle_gate',
      'safety_surface_gate',
      'deploy_verification_gate',
      'bug_physics_triage_gate',
      'bug_physics_profile_gate',
      'bug_physics_feedback_gate',
      'architecture_blueprint_gate',
      'architecture_gate',
      'spec_gate',
      'decision_record_gate',
      'verification_gate',
      'requirement_gate',
      'responsibility_authority_gate',
      'failure_mode_coverage_gate',
      'path_surface_matrix_gate',
      'review_inspection_required_gate',
      'visual_qa_gate',
      'design_quality_gate',
      'workflow_heavy_gate',
      'validation_sequencing_gate',
      'pr_freshness_gate',
      'artifact_consistency_gate',
      'agent_review_dispatch_batch_gate',
      'agent_review_dispatch_preflight_gate',
      'agent_review_prepare_gate',
      'agent_review_role_gate',
      'agent_review_record_gate',
      'agent_review_stage_join_gate',
      'agent_review_gate'
    ].includes(node.type))
    .filter((node) => node.required)
    .filter((node) => isUnresolvedStatus(node.status));
  if (gateDag && gateDag.overall_status !== 'ready_for_review') {
    unresolved.unshift({
      id: 'gate:overall_status',
      type: 'artifact_consistency_gate',
      label: 'Gate DAG overall status',
      status: gateDag.overall_status ?? 'unknown',
      required: true,
      reason: `Gate DAG overall_status=${gateDag.overall_status ?? 'unknown'} is not ready_for_review`
    });
  }
  return unresolved;
}

function collectRequiredExecutionBlockers(executionDag, { storyId, baseRef, managedWorktree, expectedHeadSha }) {
  const nodes = Array.isArray(executionDag?.nodes) ? executionDag.nodes : [];
  const blockers = nodes
    .filter((node) => node.required)
    .filter((node) => ['blocked', 'needs_evidence', 'failed'].includes(node.status))
    .map((node) => ({
      id: `execution:${node.id}`,
      label: node.id,
      status: node.status,
      reason: node.reason ?? null,
      required_actions: buildExecutionBlockerActions(node, { storyId, baseRef, managedWorktree })
    }));
  return blockers;
}

function buildExecutionBlockerActions(node, { storyId, baseRef, managedWorktree }) {
  const executeStart = buildExecuteStartCommand({ storyId, baseRef });
  if (node.id === 'worktree_created' && managedWorktree?.status === 'branch_mismatch') {
    return [
      `Restore ${managedWorktree.path} to ${managedWorktree.branch} or rerun ${executeStart} with a clean managed worktree path before PR preparation.`
    ];
  }
  if (node.id === 'branch_bound' && managedWorktree?.branch_match === false) {
    return [
      `Resolve the managed worktree branch mismatch (${managedWorktree.actual_branch ?? 'detached'} != ${managedWorktree.branch}) before running PR preparation.`
    ];
  }
  if (node.id === 'head_bound' && managedWorktree?.current_head_sha) {
    return [
      `Update the managed worktree at ${managedWorktree.path} to the current execution HEAD before PR preparation.`
    ];
  }
  if (node.id === 'worktree_created') {
    return [
      `Run ${executeStart} to create or rebind the VibePro managed worktree before PR preparation.`
    ];
  }
  return [
    `Resolve Execution DAG node ${node.id} before PR preparation.`
  ];
}

function isUnresolvedStatus(status) {
  return [
    'candidate',
    'missing',
    'transient',
    'implicit',
    'inferred_empty',
    'needs_evidence',
    'needs_setup',
    'needs_review',
    'needs_rebase',
    'needs_changes',
    'contradicted',
    'stale',
    'block',
    'failed'
  ].includes(status);
}

function pickBlockingGate(gates) {
  if (!gates.length) return null;
  const preferred = gates.find((gate) => gate.id === 'gate:agent_review')
    ?? gates.find((gate) => gate.id?.startsWith('review:'))
    ?? gates.find((gate) => gate.status === 'failed' || gate.status === 'block' || gate.status === 'contradicted')
    ?? gates[0];
  return {
    id: preferred.id,
    label: preferred.label ?? preferred.id,
    status: preferred.status,
    reason: preferred.reason ?? null,
    required_actions: preferred.required_actions ?? []
  };
}

function isCriticalUnresolvedGate(gate) {
  if (gate.id === 'story' && gate.status === 'transient') return true;
  if (gate.id === 'architecture' && gate.status === 'needs_review') return true;
  if (gate.id === 'spec' && ['implicit', 'inferred_empty', 'needs_review'].includes(gate.status)) return true;
  if (gate.id === 'gate:e2e' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:visual_qa' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:design_quality' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:requirement' && ['needs_review', 'contradicted'].includes(gate.status)) return true;
  if (gate.id === 'gate:responsibility_authority' && !['passed', 'not_applicable'].includes(gate.status)) return true;
  if (gate.id === 'gate:network_contract' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_route_classification' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_body_contract' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:mirror_source_traceability' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:ci_status_or_waiver' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:vibepro_artifact_policy' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:split_resolution' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:managed_worktree' && gate.required && gate.status !== 'satisfied') return true;
  if (gate.id === 'gate:decision_record' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_freshness' && gate.status !== 'passed') return true;
  if (gate.type === 'workflow_heavy_gate' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:agent_review' && gate.status !== 'passed') return true;
  return gate.status === 'failed' || gate.status === 'contradicted';
}

async function writeExecutionStateWithLinkedCopies(repoRoot, state, options = {}) {
  const currentRoot = path.resolve(repoRoot);
  const roots = unique([
    ...collectLinkedExecutionRoots(state).filter((target) => path.resolve(target) !== currentRoot),
    currentRoot
  ]);
  const lockTransaction = options.withStoryTransactionLocks ?? withStoryTransactionLocks;
  return lockTransaction(roots, state.story_id, () => writeExecutionStateWithLinkedCopiesUnlocked(
    currentRoot,
    roots,
    state,
    options
  ));
}

async function writeExecutionStateWithLinkedCopiesUnlocked(currentRoot, roots, state, options = {}) {
  const snapshots = await Promise.all(roots.map(async (root) => {
    const filePath = getExecutionStatePath(root, state.story_id);
    return {
      root,
      file_path: filePath,
      ...(await readFileSnapshot(filePath))
    };
  }));
  const syncArtifacts = options.syncManagedWorktreeArtifactsToSource ?? syncManagedWorktreeArtifactsToSource;
  const writeState = options.writeExecutionStateAtomic ?? writeJsonAtomic;
  const restoreSnapshot = options.restoreExecutionStateSnapshot ?? restoreFileSnapshot;
  const snapshotArtifacts = options.snapshotManagedWorktreeArtifacts ?? snapshotManagedWorktreeArtifacts;
  const restoreArtifactSnapshots = options.restoreManagedWorktreeArtifactSnapshots ?? restoreManagedWorktreeArtifactSnapshots;
  const cleanupArtifactSnapshots = options.cleanupManagedWorktreeArtifactSnapshots ?? cleanupManagedWorktreeArtifactSnapshots;
  const artifactSnapshots = await snapshotArtifacts(currentRoot, state);
  const attemptedStateSnapshots = [];
  let pendingError = null;

  try {
    if (options.expectedCurrentState !== undefined) {
      const existingSnapshots = snapshots.filter((snapshot) => snapshot.existed);
      const conflictingSnapshot = existingSnapshots.find(
        (snapshot) => !jsonBytesEqualValue(snapshot.bytes, options.expectedCurrentState)
      );
      const expectedStateMatches = options.expectedCurrentState === null
        ? existingSnapshots.length === 0
        : existingSnapshots.length > 0 && !conflictingSnapshot;
      if (!expectedStateMatches) {
        const conflictPath = conflictingSnapshot?.file_path
          ?? existingSnapshots[0]?.file_path
          ?? getExecutionStatePath(currentRoot, state.story_id);
        const conflict = new Error(`execution state changed concurrently; refusing to overwrite newer state: ${conflictPath}`);
        conflict.code = 'execution_state_transaction_conflict';
        conflict.artifact_path = conflictPath;
        throw conflict;
      }
    }
    // Source artifacts and every execution-state authority form one transaction.
    // The current checkout is written last so it remains the commit point.
    await syncArtifacts(currentRoot, state, {
      onArtifactWillWrite: (targetPath) => captureManagedWorktreeArtifactBeforeWrite(artifactSnapshots, targetPath),
      onArtifactWritten: (targetPath) => captureManagedWorktreeArtifactWrite(artifactSnapshots, targetPath)
    });
    for (const snapshot of snapshots) {
      attemptedStateSnapshots.push(snapshot);
      await mkdir(path.dirname(snapshot.file_path), { recursive: true });
      await writeState(snapshot.file_path, state);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const snapshot of [...attemptedStateSnapshots].reverse()) {
      try {
        await restoreExecutionStateSnapshotIfOwned(snapshot, state, restoreSnapshot);
      } catch (restoreError) {
        restoreErrors.push({
          path: snapshot.file_path,
          message: restoreError instanceof Error ? restoreError.message : String(restoreError)
        });
      }
    }
    try {
      await restoreArtifactSnapshots(artifactSnapshots);
    } catch (restoreError) {
      const artifactRestoreErrors = Array.isArray(restoreError?.restore_errors)
        ? restoreError.restore_errors.map((item) => ({ path: item.artifact_path, message: item.message }))
        : [{
            path: restoreError?.artifact_path ?? artifactSnapshots?.snapshot_root ?? 'managed-worktree-artifacts',
            message: restoreError instanceof Error ? restoreError.message : String(restoreError)
          }];
      restoreErrors.push(...artifactRestoreErrors);
    }
    if (restoreErrors.length > 0) {
      const transactionError = new Error(
        `execution state transaction failed and rollback was incomplete: ${restoreErrors.map((item) => item.path).join(', ')}`,
        { cause: error }
      );
      transactionError.code = 'execution_state_transaction_restore_failed';
      transactionError.restore_errors = restoreErrors;
      pendingError = transactionError;
      throw transactionError;
    }
    pendingError = error;
    throw error;
  } finally {
    try {
      await cleanupArtifactSnapshots(artifactSnapshots);
    } catch (cleanupError) {
      if (!pendingError) throw cleanupError;
      pendingError.cleanup_error = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    }
  }

  return {
    state,
    artifact: toWorkspaceRelative(currentRoot, getExecutionStatePath(currentRoot, state.story_id)),
    found: true
  };
}

async function restoreExecutionStateSnapshotIfOwned(snapshot, state, restoreSnapshot) {
  const current = await readFileSnapshot(snapshot.file_path);
  if (fileSnapshotsEqual(current, snapshot)) return;
  if (current.existed && jsonBytesEqualValue(current.bytes, state)) {
    await restoreSnapshot(snapshot);
    return;
  }
  const error = new Error(`execution state changed concurrently; refusing to overwrite it during rollback: ${snapshot.file_path}`);
  error.code = 'execution_state_transaction_conflict';
  error.artifact_path = snapshot.file_path;
  throw error;
}

function fileSnapshotsEqual(left, right) {
  if (left.existed !== right.existed) return false;
  if (!left.existed) return true;
  return Buffer.compare(Buffer.from(left.bytes), Buffer.from(right.bytes)) === 0;
}

function jsonBytesEqualValue(bytes, value) {
  try {
    return JSON.stringify(JSON.parse(Buffer.from(bytes).toString('utf8'))) === JSON.stringify(value);
  } catch {
    return false;
  }
}

async function snapshotManagedWorktreeArtifacts(repoRoot, state) {
  const locations = await managedWorktreeArtifactLocations(repoRoot, state);
  return {
    snapshot_root: null,
    entries: [],
    allowed_roots: locations?.allowed_roots ?? []
  };
}

async function captureManagedWorktreeArtifactBeforeWrite(snapshotSet, targetPath) {
  const artifactPath = path.resolve(targetPath);
  if (snapshotSet?.entries?.some((entry) => entry.artifact_path === artifactPath)) return;
  if (!isManagedWorktreeArtifactPathAllowed(snapshotSet, artifactPath)) {
    const error = new Error(`managed worktree sync reported an artifact outside its ownership boundary: ${artifactPath}`);
    error.code = 'managed_worktree_artifact_ownership_invalid';
    error.artifact_path = artifactPath;
    throw error;
  }
  if (!snapshotSet.snapshot_root) {
    snapshotSet.snapshot_root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-linked-artifacts-'));
  }
  snapshotSet.entries.push(await snapshotManagedWorktreeArtifactFile(
    snapshotSet.snapshot_root,
    snapshotSet.entries.length,
    artifactPath
  ));
}

async function captureManagedWorktreeArtifactWrite(snapshotSet, targetPath) {
  const artifactPath = path.resolve(targetPath);
  const snapshot = snapshotSet?.entries?.find((entry) => entry.artifact_path === artifactPath);
  if (!snapshot) {
    const error = new Error(`managed worktree sync reported a write without a file-level pre-write snapshot: ${artifactPath}`);
    error.code = 'managed_worktree_artifact_ownership_unknown';
    error.artifact_path = artifactPath;
    throw error;
  }
  snapshot.written_fingerprint = await fingerprintPath(snapshot.artifact_path);
}

async function restoreManagedWorktreeArtifactSnapshots(snapshotSet) {
  const errors = [];
  const ownedSnapshots = (snapshotSet?.entries ?? []).filter((snapshot) => snapshot.written_fingerprint);
  for (const snapshot of [...ownedSnapshots].reverse()) {
    try {
      const currentFingerprint = await fingerprintPath(snapshot.artifact_path);
      if (currentFingerprint === snapshot.original_fingerprint) continue;
      if (!snapshot.written_fingerprint || currentFingerprint !== snapshot.written_fingerprint) {
        const conflict = new Error(`managed worktree artifact changed concurrently; refusing to overwrite it during rollback: ${snapshot.artifact_path}`);
        conflict.code = 'managed_worktree_artifact_transaction_conflict';
        throw conflict;
      }
      await rm(snapshot.artifact_path, { force: true });
      if (!snapshot.existed) continue;
      await mkdir(path.dirname(snapshot.artifact_path), { recursive: true });
      await cp(snapshot.backup_path, snapshot.artifact_path, { force: true });
    } catch (error) {
      errors.push({
        artifact_path: snapshot.artifact_path,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (errors.length > 0) {
    const error = new Error(`managed worktree artifact rollback was incomplete: ${errors.map((item) => item.artifact_path).join(', ')}`);
    error.code = 'managed_worktree_artifact_restore_failed';
    error.artifact_path = errors[0].artifact_path;
    error.restore_errors = errors;
    throw error;
  }
}

async function snapshotManagedWorktreeArtifactFile(snapshotRoot, index, targetPath) {
  const artifactPath = path.resolve(targetPath);
  const backupPath = path.join(snapshotRoot, String(index));
  try {
    const metadata = await lstat(artifactPath);
    if (metadata.isDirectory()) {
      const error = new Error(`managed worktree artifact ownership must be reported per file: ${artifactPath}`);
      error.code = 'managed_worktree_artifact_directory_ownership_invalid';
      error.artifact_path = artifactPath;
      throw error;
    }
    await cp(artifactPath, backupPath, { force: true });
    return {
      artifact_path: artifactPath,
      backup_path: backupPath,
      existed: true,
      original_fingerprint: await fingerprintPath(artifactPath),
      written_fingerprint: null
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      artifact_path: artifactPath,
      backup_path: backupPath,
      existed: false,
      original_fingerprint: 'missing',
      written_fingerprint: null
    };
  }
}

async function fingerprintPath(targetPath) {
  try {
    const metadata = await lstat(targetPath);
    if (!metadata.isDirectory()) {
      const bytes = await readFile(targetPath);
      return `file:${createHash('sha256').update(bytes).digest('hex')}`;
    }
    const hash = createHash('sha256');
    for (const entry of (await readdir(targetPath)).sort()) {
      hash.update(entry);
      hash.update('\0');
      hash.update(await fingerprintPath(path.join(targetPath, entry)));
      hash.update('\0');
    }
    return `dir:${hash.digest('hex')}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

async function cleanupManagedWorktreeArtifactSnapshots(snapshotSet) {
  if (!snapshotSet?.snapshot_root) return;
  await rm(snapshotSet.snapshot_root, { recursive: true, force: true });
}

async function managedWorktreeArtifactLocations(repoRoot, state) {
  const currentRoot = path.resolve(repoRoot);
  const managedPath = state?.managed_worktree?.path ? path.resolve(state.managed_worktree.path) : null;
  const sourceRepo = state?.managed_worktree?.source_repo ? path.resolve(state.managed_worktree.source_repo) : null;
  if (!managedPath || !sourceRepo || currentRoot !== managedPath || sourceRepo === currentRoot) return null;
  const workspace = getWorkspaceDir(currentRoot);
  const sourceWorkspace = getWorkspaceDir(sourceRepo);
  const managedManifest = await readJsonIfExists(path.join(workspace, 'vibepro-manifest.json'));
  const storyFlowRunIds = unique((managedManifest?.flow_verification_runs ?? [])
    .filter((run) => run?.story_id === state.story_id && typeof run?.run_id === 'string')
    .map((run) => run.run_id));
  const [managedPrFile, sourcePrFile, managedPrRoute, sourcePrRoute, managedReviewRoute, sourceReviewRoute] = await Promise.all([
    resolvePrArtifactFile(currentRoot, state.story_id),
    resolvePrArtifactFile(sourceRepo, state.story_id),
    resolveArtifactRoute(currentRoot, 'pr', { storyId: state.story_id }),
    resolveArtifactRoute(sourceRepo, 'pr', { storyId: state.story_id }),
    resolveArtifactRoute(currentRoot, 'review', { storyId: state.story_id }),
    resolveArtifactRoute(sourceRepo, 'review', { storyId: state.story_id })
  ]);
  const managedPrDirectory = path.dirname(managedPrFile);
  const sourcePrDirectory = path.dirname(sourcePrFile);
  const prDirectoryIsStoryScoped = prRouteDirectoryIsStoryScoped(managedPrRoute)
    && prRouteDirectoryIsStoryScoped(sourcePrRoute);
  const prArtifactFileNames = [
    'pr-prepare.json',
    'pr-create.json',
    'verification-evidence.json',
    'decision-records.json',
    'pr-merge.json'
  ];
  const file_pairs = prDirectoryIsStoryScoped
    ? []
    : await Promise.all(prArtifactFileNames.map(async (fileName) => ({
      source: await resolvePrArtifactFile(currentRoot, state.story_id, fileName),
      target: await resolvePrArtifactFile(sourceRepo, state.story_id, fileName)
    })));
  const directory_pairs = [
    ...(prDirectoryIsStoryScoped ? [{ source: managedPrDirectory, target: sourcePrDirectory }] : []),
    {
      source: managedReviewRoute.canonical.absolute_path,
      target: sourceReviewRoute.canonical.absolute_path
    },
    {
      source: path.join(workspace, 'verification', state.story_id),
      target: path.join(sourceWorkspace, 'verification', state.story_id)
    },
    ...storyFlowRunIds.map((runId) => ({
      source: path.join(workspace, 'verification', runId),
      target: path.join(sourceWorkspace, 'verification', runId)
    }))
  ];
  const manifest = {
    source: path.join(workspace, 'vibepro-manifest.json'),
    target: path.join(sourceWorkspace, 'vibepro-manifest.json')
  };
  return {
    file_pairs,
    directory_pairs,
    manifest,
    allowed_roots: [
      ...file_pairs.map((entry) => entry.target),
      ...directory_pairs.map((entry) => entry.target),
      manifest.target
    ]
  };
}

function prRouteDirectoryIsStoryScoped(route) {
  const templateDirectory = path.posix.dirname(route.canonical.template);
  return /\{(?:story_id|feature_slug)\}/.test(templateDirectory);
}

async function listRelativeFiles(root, relativePath = '') {
  const currentPath = relativePath ? path.join(root, relativePath) : root;
  try {
    const metadata = await lstat(currentPath);
    if (!metadata.isDirectory()) return [relativePath];
    const files = [];
    for (const entry of (await readdir(currentPath)).sort()) {
      files.push(...await listRelativeFiles(root, path.join(relativePath, entry)));
    }
    return files;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function isManagedWorktreeArtifactPathAllowed(snapshotSet, artifactPath) {
  return (snapshotSet?.allowed_roots ?? []).some((root) => (
    artifactPath === root || artifactPath.startsWith(`${root}${path.sep}`)
  ));
}

async function readFileSnapshot(filePath) {
  try {
    return { existed: true, bytes: await readFile(filePath) };
  } catch (error) {
    if (error.code === 'ENOENT') return { existed: false, bytes: null };
    throw error;
  }
}

async function restoreFileSnapshot(snapshot) {
  if (!snapshot.existed) {
    await rm(snapshot.file_path, { force: true });
    return;
  }
  await mkdir(path.dirname(snapshot.file_path), { recursive: true });
  await writeBytesAtomic(snapshot.file_path, snapshot.bytes);
}

async function syncManagedWorktreeArtifactsToSource(repoRoot, state, options = {}) {
  const locations = await managedWorktreeArtifactLocations(repoRoot, state);
  if (!locations) return;
  for (const pair of locations.file_pairs) {
    await copyFileIfExists(pair.source, pair.target, options);
  }
  for (const pair of locations.directory_pairs) {
    await copyDirectoryIfExists(pair.source, pair.target, options);
  }
  await mergeManifestFileIfExists(
    locations.manifest.source,
    locations.manifest.target,
    options
  );
}

function compileArtifactTemplateMatcher(template) {
  const variables = [];
  let source = '^';
  let cursor = 0;
  for (const match of template.matchAll(/\{([a-z_][a-z0-9_]*)\}/g)) {
    source += template.slice(cursor, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    source += '([^/]+)';
    variables.push(match[1]);
    cursor = match.index + match[0].length;
  }
  source += template.slice(cursor).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { regex: new RegExp(`${source}$`), variables };
}

async function collectRoutedPrStoryIds(root) {
  const { routing } = await readArtifactRoutingConfig(root);
  const canonicalTemplates = routing?.schema_version === '0.2.0'
    ? Object.values(routing.profiles ?? {})
      .map((profile) => profile?.artifacts?.pr?.canonical)
      .filter((template) => typeof template === 'string' && template)
    : [routing?.artifacts?.pr?.canonical ?? DEFAULT_ARTIFACT_TEMPLATES.pr];
  const storyIds = new Set();
  for (const canonicalTemplate of new Set(canonicalTemplates)) {
    const mergeTemplate = routing?.schema_version === '0.2.0'
      ? path.posix.join(path.posix.dirname(canonicalTemplate), 'pr-merge.json')
      : derivePrArtifactTemplate(canonicalTemplate, 'pr-merge.json');
    const firstVariable = mergeTemplate.search(/\{[a-z_][a-z0-9_]*\}/);
    const prefixSource = firstVariable === -1
      ? path.posix.dirname(mergeTemplate)
      : mergeTemplate.slice(0, firstVariable);
    const scanRoot = firstVariable === -1
      ? prefixSource
      : prefixSource.slice(0, Math.max(0, prefixSource.lastIndexOf('/')));
    const { regex, variables } = compileArtifactTemplateMatcher(mergeTemplate);
    for (const relativePath of await listRelativeFiles(root, scanRoot)) {
      const normalizedPath = relativePath.split(path.sep).join('/');
      const match = regex.exec(normalizedPath);
      if (!match) continue;
      const artifact = await readJsonIfExists(path.join(root, relativePath));
      const capturedStoryId = variables.indexOf('story_id');
      const storyId = artifact?.story?.story_id
        ?? artifact?.story_id
        ?? (capturedStoryId === -1 ? null : match[capturedStoryId + 1]);
      if (typeof storyId === 'string' && storyId.trim()) storyIds.add(storyId.trim());
    }
  }
  return [...storyIds].sort();
}

async function collectMergedStoryIds(root) {
  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  const facts = new Map();
  const ensureFacts = (storyId) => {
    if (!facts.has(storyId)) {
      facts.set(storyId, {
        current_local_delivery_status: null,
        fallback_delivery_statuses: [],
        legacy_merged: false,
        expected_base_ref: null,
        expected_pr_selector: null
      });
    }
    return facts.get(storyId);
  };
  const recordArtifact = (storyId, artifact, { currentLocal = false } = {}) => {
    if (!artifact) return;
    const storyFacts = ensureFacts(storyId);
    if (currentLocal && isCurrentPrLifecycleArtifact(artifact, currentHeadSha)) {
      storyFacts.expected_base_ref = resolveMergeBase(artifact) ?? storyFacts.expected_base_ref;
      storyFacts.expected_pr_selector = resolvePrSelector(artifact) ?? storyFacts.expected_pr_selector;
      storyFacts.current_local_delivery_status = typeof artifact?.delivery?.status === 'string'
        ? artifact.delivery.status
        : isMergedArtifact(artifact) ? 'merged' : 'unverified';
      return;
    }
    if (typeof artifact?.delivery?.status === 'string') {
      if (
        ['merged', 'merged_externally'].includes(artifact.delivery.status)
        && !deliveryIdentityMatches(artifact, {
          expectedBaseRef: storyFacts.expected_base_ref,
          expectedPrSelector: storyFacts.expected_pr_selector
        })
      ) return;
      storyFacts.fallback_delivery_statuses.push(artifact.delivery.status);
      return;
    }
    storyFacts.legacy_merged ||= Boolean(
      isMergedArtifact(artifact)
      && deliveryIdentityMatches(artifact, {
        expectedBaseRef: storyFacts.expected_base_ref,
        expectedPrSelector: storyFacts.expected_pr_selector
      })
    );
  };
  const auditRoot = path.join(root, 'docs', 'management', 'audit-artifacts');
  const mergedStoryDocs = await collectMergedStoryDocs(root);
  const candidateStoryIds = new Set([
    ...await collectRoutedPrStoryIds(root),
    ...await safeReaddir(auditRoot),
    ...mergedStoryDocs.map((story) => story.story_id)
  ]);
  for (const storyId of [...candidateStoryIds].sort()) {
    const prCreate = await readJsonIfExists(await resolvePrArtifactFile(root, storyId, 'pr-create.json'));
    if (isCurrentPrLifecycleArtifact(prCreate, currentHeadSha)) {
      const storyFacts = ensureFacts(storyId);
      storyFacts.expected_base_ref = resolveMergeBase(prCreate);
      storyFacts.expected_pr_selector = resolvePrSelector(prCreate);
    }
    const merge = await readJsonIfExists(await resolvePrArtifactFile(root, storyId, 'pr-merge.json'));
    recordArtifact(storyId, merge, { currentLocal: true });
  }
  for (const storyId of await safeReaddir(auditRoot)) {
    const merge = await readJsonIfExists(path.join(auditRoot, storyId, 'pr', 'pr-merge.json'));
    const bundle = await readJsonIfExists(path.join(auditRoot, storyId, 'audit-bundle.json'));
    recordArtifact(storyId, merge);
    recordArtifact(storyId, bundle?.merge);
  }
  for (const story of mergedStoryDocs) {
    ensureFacts(story.story_id).legacy_merged = true;
  }
  return [...facts.entries()]
    .filter(([, storyFacts]) => (
      storyFacts.current_local_delivery_status !== null
        ? ['merged', 'merged_externally'].includes(storyFacts.current_local_delivery_status)
        : storyFacts.fallback_delivery_statuses.length > 0
          ? storyFacts.fallback_delivery_statuses.every((status) => ['merged', 'merged_externally'].includes(status))
        : storyFacts.legacy_merged
    ))
    .map(([storyId]) => storyId)
    .sort();
}

async function collectMergedStoryDocs(root) {
  const dirs = [
    path.join(root, 'docs', 'management', 'stories', 'active'),
    path.join(root, 'docs', 'management', 'stories', 'completed'),
    path.join(root, 'docs', 'management', 'stories', 'done')
  ];
  const stories = [];
  for (const dir of dirs) {
    for (const entry of await safeReaddir(dir)) {
      if (!entry.endsWith('.md')) continue;
      const filePath = path.join(dir, entry);
      const content = await readFile(filePath, 'utf8').catch(() => '');
      const storyId = content.match(/^story_id:\s*([^\n]+)/m)?.[1]?.trim();
      const status = content.match(/^status:\s*([^\n]+)/m)?.[1]?.trim()?.toLowerCase();
      if (storyId && ['merged', 'closed', 'done', 'completed'].includes(status)) {
        stories.push({ story_id: storyId, path: filePath });
      }
    }
  }
  return stories;
}

async function collectMergedReconcileEvidence(root, storyId) {
  const reviewRoot = (await resolveArtifactRoute(root, 'review', { storyId })).canonical.absolute_path;
  const candidates = [
    ['pr_create', await resolvePrArtifactFile(root, storyId, 'pr-create.json')],
    ['pr_merge', await resolvePrArtifactFile(root, storyId, 'pr-merge.json')],
    ['review_summary', path.join(reviewRoot, 'gate', 'review-summary.json')],
    ['canonical_pr_create', path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-create.json')],
    ['canonical_pr_merge', path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'pr', 'pr-merge.json')],
    ['canonical_bundle', path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json')]
  ];
  const evidence = [];
  for (const [kind, filePath] of candidates) {
    if (await readJsonIfExists(filePath)) {
      evidence.push({
        kind,
        artifact: toWorkspaceRelative(root, filePath)
      });
    }
  }
  return evidence;
}

function inferMissingMergedEvidence(state, evidence) {
  if (state.completion_status === 'merged') return [];
  const kinds = new Set(evidence.map((item) => item.kind));
  const missing = [];
  if (!kinds.has('pr_merge') && !kinds.has('canonical_pr_merge') && !kinds.has('canonical_bundle')) missing.push('pr_merge');
  if (!kinds.has('pr_create') && !kinds.has('canonical_pr_create')) missing.push('pr_create');
  return missing;
}

function isMergedArtifact(artifact) {
  if (typeof artifact?.delivery?.status === 'string') {
    return ['merged', 'merged_externally'].includes(artifact.delivery.status);
  }
  return artifact?.status === 'merged'
    || artifact?.status === 'merged_externally'
    || Boolean(artifact?.merged_at)
    || Boolean(artifact?.merge_commit_sha)
    || (artifact?.merge ? isMergedArtifact(artifact.merge) : false);
}

export async function safeReaddir(dir) {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    // ENOENT: dir does not exist. ENOTDIR: a file exists where a directory was
    // expected (corrupt/partial workspace). Both mean "no entries to scan".
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

function collectLinkedExecutionRoots(state) {
  if (!state?.managed_worktree || state.managed_worktree.mode === 'disabled') return [];
  return unique([
    state.managed_worktree.path,
    state.managed_worktree.source_repo
  ].filter(Boolean).map((target) => path.resolve(target)));
}

async function copyDirectoryIfExists(source, target, options = {}) {
  for (const relativePath of await listRelativeFiles(source)) {
    const sourcePath = relativePath ? path.join(source, relativePath) : source;
    const targetPath = relativePath ? path.join(target, relativePath) : target;
    await options.onArtifactWillWrite?.(targetPath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });
    await options.onArtifactWritten?.(targetPath);
  }
}

async function copyFileIfExists(source, target, options = {}) {
  try {
    await lstat(source);
    await options.onArtifactWillWrite?.(target);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: true });
    await options.onArtifactWritten?.(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

async function mergeManifestFileIfExists(source, target, options = {}) {
  const managed = await readJsonIfExists(source);
  if (!managed) return;
  const existing = await readJsonIfExists(target);
  const merged = mergeWorkspaceManifest(existing, managed);
  await options.onArtifactWillWrite?.(target);
  await mkdir(path.dirname(target), { recursive: true });
  await writeJsonAtomic(target, merged);
  await options.onArtifactWritten?.(target);
}

function mergeWorkspaceManifest(existing, managed) {
  const merged = {
    ...(existing ?? {}),
    ...managed
  };
  if (existing?.artifacts || managed?.artifacts) {
    merged.artifacts = {
      ...(existing?.artifacts ?? {}),
      ...(managed?.artifacts ?? {})
    };
  }
  if (Array.isArray(existing?.flow_verification_runs) || Array.isArray(managed?.flow_verification_runs)) {
    merged.flow_verification_runs = mergeRunsById(
      existing?.flow_verification_runs ?? [],
      managed?.flow_verification_runs ?? []
    );
  }
  return merged;
}

function mergeRunsById(existingRuns, managedRuns) {
  const byId = new Map();
  const anonymous = [];
  for (const run of existingRuns) {
    if (run?.run_id) byId.set(run.run_id, run);
    else anonymous.push(run);
  }
  for (const run of managedRuns) {
    if (run?.run_id) byId.set(run.run_id, { ...(byId.get(run.run_id) ?? {}), ...run });
    else anonymous.push(run);
  }
  return [...anonymous, ...byId.values()];
}

async function readExecutionState(repoRoot, storyId) {
  const filePath = getExecutionStatePath(repoRoot, storyId);
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      const backupPath = `${filePath}.corrupt-${Date.now()}-${process.pid}.bak`;
      await rename(filePath, backupPath);
      throw new Error(`execution state JSON is corrupt: ${toWorkspaceRelative(repoRoot, filePath)}. Moved it to ${toWorkspaceRelative(repoRoot, backupPath)}.`);
    }
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJsonAtomic(filePath, value) {
  await writeBytesAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeBytesAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, value);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

export const __testing__ = {
  restoreMergeFollowupStateOrThrow,
  writeExecutionStateWithLinkedCopies
};

async function gitOptional(repoRoot, args) {
  try {
    const result = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function gitIsAncestor(repoRoot, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  if (ancestor === descendant) return true;
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd: repoRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

function getExecutionStatePath(repoRoot, storyId) {
  return path.join(getWorkspaceDir(repoRoot), 'executions', storyId, 'state.json');
}

async function assertWorkspaceInitialized(repoRoot, commandName) {
  try {
    await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${commandName} requires an initialized VibePro workspace. Run \`vibepro init <repo>\` first.`);
    }
    throw error;
  }
}

function buildPrPrepareCommand({ storyId, baseRef }) {
  const base = baseRef ? ` --base ${shellQuote(baseRef)}` : ' --base <base-ref>';
  return `vibepro pr prepare . --story-id ${shellQuote(storyId)}${base}`;
}

function buildPrCreateCommand({ storyId, baseRef }) {
  const base = baseRef ? ` --base ${shellQuote(baseRef)}` : ' --base <base-ref>';
  return `vibepro pr create . --story-id ${shellQuote(storyId)}${base}`;
}

function buildExecuteMergeCommand({ storyId, baseRef }) {
  const base = baseRef ? ` --base ${shellQuote(baseRef)}` : ' --base <base-ref>';
  return `vibepro execute merge . --story-id ${shellQuote(storyId)}${base}`;
}

function buildExecuteStartCommand({ storyId, baseRef }) {
  const base = baseRef ? ` --base ${shellQuote(baseRef)}` : ' --base <base-ref>';
  return `vibepro execute start . --story-id ${shellQuote(storyId)}${base}`;
}

function shellQuote(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:=@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function requireStoryId(storyId, commandName) {
  if (!storyId) throw new Error(`${commandName} requires --story-id <story-id>`);
  return storyId;
}

function unique(values) {
  return [...new Set(values)];
}
