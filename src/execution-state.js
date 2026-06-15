import { execFile } from 'node:child_process';
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { getAgentReviewStatus } from './agent-review.js';
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
  return writeExecutionStateWithLinkedCopies(repoRoot, state);
}

export async function getExecutionStatus(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute status');
  const existing = await readManagedExecutionState(repoRoot, storyId);
  if (existing) {
    const managedWorktree = await refreshManagedWorktree(repoRoot, existing.managed_worktree).catch(() => existing.managed_worktree ?? null);
    const state = await buildExecutionState(repoRoot, {
      ...options,
      storyId,
      target: options.target ?? existing.target ?? DEFAULT_TARGET,
      startedAt: existing.started_at,
      managedWorktree,
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
    managedWorktree
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
  const existing = await readManagedExecutionState(repoRoot, storyId);
  const state = await buildExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? existing?.target ?? DEFAULT_TARGET,
    startedAt: existing?.started_at,
    managedWorktree: await refreshManagedWorktree(repoRoot, existing?.managed_worktree).catch(() => existing?.managed_worktree ?? null),
    preserveStartedAt: true
  });
  return writeExecutionStateWithLinkedCopies(repoRoot, state);
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
  return writeExecutionStateWithLinkedCopies(repoRoot, state);
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
  if (!merge || merge.status !== 'merged') return result;
  const state = {
    ...result.state,
    completion_status: 'merged',
    current_phase: 'complete',
    completed_phases: unique([...result.state.completed_phases, 'merge_ready', 'merge']),
    pr_url: merge.pr?.url ?? result.state.pr_url ?? null,
    next_actions: [],
    blocking_gate: null,
    updated_at: new Date().toISOString()
  };
  return writeExecutionStateWithLinkedCopies(repoRoot, state);
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

function formatManagedWorktreeSummary(managedWorktree) {
  if (!managedWorktree) {
    return {
      headline: 'not_recorded',
      details: '- status: not_recorded'
    };
  }
  const headline = `${managedWorktree.mode ?? 'unknown'}/${managedWorktree.status ?? 'unknown'}`;
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
      `- raw_dirty_fingerprint: ${managedWorktree.raw_dirty_fingerprint ?? '-'}`
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
  const [prPrepare, verificationEvidence, prCreate, prMerge, gateDagArtifact, agentReview] = await Promise.all([
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-prepare.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'verification-evidence.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-create.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-merge.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'gate-dag.json')),
    getAgentReviewStatus(root, { storyId }).catch(() => null)
  ]);
  const currentHeadSha = await gitOptional(root, ['rev-parse', 'HEAD']);
  const currentPrCreate = isCurrentPrLifecycleArtifact(prCreate, currentHeadSha) ? prCreate : null;
  const currentPrMerge = isCurrentPrLifecycleArtifact(prMerge, currentHeadSha) ? prMerge : null;
  const gateStatus = prPrepare?.gate_status ?? null;
  const gateDag = gateDagArtifact ?? prPrepare?.pr_context?.gate_dag ?? currentPrCreate?.gate_dag ?? null;
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag);
  const blockingGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const managedWorktree = options.managedWorktree
    ? await refreshManagedWorktree(root, options.managedWorktree).catch(() => options.managedWorktree)
    : null;
  const expectedHeadSha = await resolveExecutionExpectedHead(root, managedWorktree, currentHeadSha);
  const executionBlockers = collectRequiredExecutionBlockers(
    buildExecutionDag({
      managedWorktree,
      completedPhases: [],
      completionStatus: 'not_prepared',
      expectedHeadSha
    }),
    { storyId, baseRef: options.baseRef, managedWorktree, expectedHeadSha }
  );
  const executionBlockingGate = executionBlockers[0] ?? null;
  const blockingGate = executionBlockingGate ?? pickBlockingGate(blockingGates);
  const prCreated = Boolean(currentPrCreate?.pr_url && currentPrCreate?.dry_run !== true);
  const merged = currentPrMerge?.status === 'merged' || Boolean(currentPrMerge?.merged_at || currentPrMerge?.merge_commit_sha);
  const agentReviewSatisfied = isGateAgentReviewSatisfied(agentReview);
  const gatesReadyForPrCreate = gateDag
    ? Boolean(prPrepare && gateDag.overall_status === 'ready_for_review' && unresolvedGates.length === 0)
    : gateStatus?.ready_for_pr_create === true && gateStatus?.execution_gate?.status !== 'waiver_required';
  const readyForPrCreate = gatesReadyForPrCreate && !executionBlockingGate;
  const prCreatedReadyForMerge = prCreated && (gateDag ? readyForPrCreate : (!prPrepare || readyForPrCreate));
  const waiverRequired = !prCreatedReadyForMerge && !readyForPrCreate && Boolean(prPrepare) && (
    executionBlockingGate
      ? false
      : gateDag
      ? unresolvedGates.length > 0 && blockingGates.length === 0
      : gateStatus?.execution_gate?.status === 'waiver_required'
  );
  const completionStatus = merged
    ? 'merged'
    : prCreatedReadyForMerge
    ? 'pr_created'
    : readyForPrCreate
      ? 'ready_for_pr_create'
      : waiverRequired
        ? 'waiver_required'
      : executionBlockingGate
        ? 'blocked'
      : prPrepare
        ? 'blocked'
        : 'not_prepared';
  const currentPhase = merged
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
    prPrepare,
    verificationEvidence,
    agentReviewSatisfied,
    readyForPrCreate,
    prCreated,
    merged,
    prMerge: currentPrMerge
  });
  const requiredCommands = buildManagedWorktreeCommands({
    pr_prepare: buildPrPrepareCommand({ storyId, baseRef: options.baseRef }),
    pr_create: buildPrCreateCommand({ storyId, baseRef: options.baseRef })
  }, managedWorktree, { expectedHeadSha });
  const nextActions = deriveNextActions({
    storyId,
    baseRef: options.baseRef,
    managedWorktree,
    expectedHeadSha,
    prPrepare,
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
    next_actions: nextActions,
    required_commands: requiredCommands,
    managed_worktree: managedWorktree,
    execution_dag: buildExecutionDag({ managedWorktree, completedPhases, completionStatus, expectedHeadSha, prMerge: currentPrMerge }),
    last_pr_prepare: prPrepare ? summarizePrPrepare(root, prPrepare) : null,
    last_review_status: agentReview ? summarizeAgentReview(agentReview) : null,
    last_verification_evidence: verificationEvidence ? summarizeVerificationEvidence(root, verificationEvidence) : null,
    pr_url: currentPrCreate?.pr_url ?? currentPrMerge?.pr?.url ?? null
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

function deriveCompletedPhases({ prPrepare, verificationEvidence, agentReviewSatisfied, readyForPrCreate, prCreated, merged, prMerge }) {
  const phases = [];
  if (prPrepare) phases.push('prepare_pr');
  if ((verificationEvidence?.commands ?? []).length > 0) phases.push('verify');
  if (agentReviewSatisfied || merged) {
    phases.push('agent_review');
  }
  if (readyForPrCreate) phases.push('ready_for_pr_create');
  if (prCreated) phases.push('create_pr');
  if (prMerge?.status === 'ready_to_merge' || prMerge?.status === 'merged') phases.push('merge_ready');
  if (merged) phases.push('merge');
  return phases;
}

function isCurrentPrLifecycleArtifact(artifact, currentHeadSha) {
  if (!artifact || !currentHeadSha) return false;
  const artifactHeadSha = artifact.artifact_freshness?.artifact_head_sha
    ?? artifact.current_head_sha
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

function summarizePrPrepare(root, prPrepare) {
  return {
    artifact: toWorkspaceRelative(root, path.join(getWorkspaceDir(root), 'pr', prPrepare.story?.story_id ?? prPrepare.story_id ?? 'unknown', 'pr-prepare.json')),
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

function summarizeVerificationEvidence(root, evidence) {
  return {
    artifact: toWorkspaceRelative(root, path.join(getWorkspaceDir(root), 'pr', evidence.story_id, 'verification-evidence.json')),
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
      'failure_mode_coverage_gate',
      'path_surface_matrix_gate',
      'review_inspection_required_gate',
      'visual_qa_gate',
      'design_quality_gate',
      'workflow_heavy_gate',
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

async function writeExecutionState(repoRoot, state) {
  const root = path.resolve(repoRoot);
  const filePath = getExecutionStatePath(root, state.story_id);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonAtomic(filePath, state);
  return {
    state,
    artifact: toWorkspaceRelative(root, filePath),
    found: true
  };
}

async function writeExecutionStateWithLinkedCopies(repoRoot, state) {
  const result = await writeExecutionState(repoRoot, state);
  await writeLinkedExecutionStateCopies(repoRoot, state);
  await syncManagedWorktreeArtifactsToSource(repoRoot, state);
  return result;
}

async function writeLinkedExecutionStateCopies(repoRoot, state) {
  const currentRoot = path.resolve(repoRoot);
  const targets = collectLinkedExecutionRoots(state)
    .filter((target) => path.resolve(target) !== currentRoot);
  for (const target of targets) {
    const filePath = getExecutionStatePath(target, state.story_id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeJsonAtomic(filePath, state);
  }
}

async function syncManagedWorktreeArtifactsToSource(repoRoot, state) {
  const currentRoot = path.resolve(repoRoot);
  const managedPath = state?.managed_worktree?.path ? path.resolve(state.managed_worktree.path) : null;
  const sourceRepo = state?.managed_worktree?.source_repo ? path.resolve(state.managed_worktree.source_repo) : null;
  if (!managedPath || !sourceRepo || currentRoot !== managedPath || sourceRepo === currentRoot) return;
  const workspace = getWorkspaceDir(currentRoot);
  const sourceWorkspace = getWorkspaceDir(sourceRepo);
  await copyDirectoryIfExists(
    path.join(workspace, 'pr', state.story_id),
    path.join(sourceWorkspace, 'pr', state.story_id)
  );
  await copyDirectoryIfExists(
    path.join(workspace, 'reviews', state.story_id),
    path.join(sourceWorkspace, 'reviews', state.story_id)
  );
  await copyDirectoryIfExists(
    path.join(workspace, 'verification'),
    path.join(sourceWorkspace, 'verification')
  );
  await mergeManifestFileIfExists(
    path.join(workspace, 'vibepro-manifest.json'),
    path.join(sourceWorkspace, 'vibepro-manifest.json')
  );
}

function collectLinkedExecutionRoots(state) {
  if (!state?.managed_worktree || state.managed_worktree.mode === 'disabled') return [];
  return unique([
    state.managed_worktree.path,
    state.managed_worktree.source_repo
  ].filter(Boolean).map((target) => path.resolve(target)));
}

async function copyDirectoryIfExists(source, target) {
  try {
    await cp(source, target, { recursive: true, force: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

async function copyFileIfExists(source, target) {
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { force: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

async function mergeManifestFileIfExists(source, target) {
  const managed = await readJsonIfExists(source);
  if (!managed) return;
  const existing = await readJsonIfExists(target);
  const merged = mergeWorkspaceManifest(existing, managed);
  await mkdir(path.dirname(target), { recursive: true });
  await writeJsonAtomic(target, merged);
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
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

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
