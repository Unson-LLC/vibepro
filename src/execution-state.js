import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getAgentReviewStatus } from './agent-review.js';
import {
  buildExecutionDag,
  buildManagedWorktreeCommands,
  ensureManagedWorktree,
  refreshManagedWorktree
} from './managed-worktree.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const SCHEMA_VERSION = '0.1.0';
const DEFAULT_TARGET = 'pr_create';

export async function startExecution(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute start');
  await assertWorkspaceInitialized(repoRoot, 'execute start');
  const existing = await readExecutionState(repoRoot, storyId);
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
  return writeExecutionState(repoRoot, state);
}

export async function getExecutionStatus(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute status');
  const existing = await readExecutionState(repoRoot, storyId);
  if (existing) {
    const managedWorktree = await refreshManagedWorktree(repoRoot, existing.managed_worktree).catch(() => existing.managed_worktree ?? null);
    const state = managedWorktree
      ? {
          ...existing,
          managed_worktree: managedWorktree,
          execution_dag: buildExecutionDag({
            managedWorktree,
            completedPhases: existing.completed_phases ?? [],
            completionStatus: existing.completion_status
          })
        }
      : existing;
    return {
      state,
      artifact: toWorkspaceRelative(repoRoot, getExecutionStatePath(repoRoot, storyId)),
      found: true
    };
  }
  const state = await buildExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? DEFAULT_TARGET
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
      next_actions: result.state.next_actions
    }
  };
}

export async function reconcileExecutionState(repoRoot, options = {}) {
  const storyId = requireStoryId(options.storyId, 'execute reconcile');
  await assertWorkspaceInitialized(repoRoot, 'execute reconcile');
  const existing = await readExecutionState(repoRoot, storyId);
  const state = await buildExecutionState(repoRoot, {
    ...options,
    storyId,
    target: options.target ?? existing?.target ?? DEFAULT_TARGET,
    startedAt: existing?.started_at,
    managedWorktree: await refreshManagedWorktree(repoRoot, existing?.managed_worktree).catch(() => existing?.managed_worktree ?? null),
    preserveStartedAt: true
  });
  return writeExecutionState(repoRoot, state);
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
  return writeExecutionState(repoRoot, state);
}

export function renderExecutionStateSummary(result) {
  const state = result.state ?? result;
  const actions = state.next_actions?.length
    ? state.next_actions.map((action) => `- ${action}`).join('\n')
    : '- none';
  return `# VibePro Execution State

- story: ${state.story_id}
- target: ${state.target}
- status: ${state.completion_status}
- phase: ${state.current_phase}
- blocking_gate: ${state.blocking_gate?.id ?? 'none'}
- artifact: ${result.artifact ?? '-'}

## Next Actions

${actions}
`;
}

export function renderExecutionNextSummary(result) {
  const next = result.next ?? result;
  const actions = next.next_actions?.length
    ? next.next_actions.map((action) => `- ${action}`).join('\n')
    : '- none';
  return `# VibePro Next Action

- status: ${next.completion_status}
- phase: ${next.current_phase}
- blocking_gate: ${next.blocking_gate?.id ?? 'none'}

${actions}
`;
}

async function buildExecutionState(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const storyId = requireStoryId(options.storyId, 'execution state');
  const now = new Date().toISOString();
  const [prPrepare, verificationEvidence, prCreate, gateDagArtifact, agentReview] = await Promise.all([
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-prepare.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'verification-evidence.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-create.json')),
    readJsonIfExists(path.join(getWorkspaceDir(root), 'pr', storyId, 'gate-dag.json')),
    getAgentReviewStatus(root, { storyId }).catch(() => null)
  ]);
  const gateStatus = prPrepare?.gate_status ?? null;
  const gateDag = gateDagArtifact ?? prPrepare?.pr_context?.gate_dag ?? prCreate?.gate_dag ?? null;
  const unresolvedGates = collectUnresolvedRequiredGates(gateDag);
  const blockingGates = unresolvedGates.filter(isCriticalUnresolvedGate);
  const blockingGate = pickBlockingGate(blockingGates);
  const prCreated = Boolean(prCreate?.pr_url && prCreate?.dry_run !== true);
  const readyForPrCreate = gateDag
    ? Boolean(prPrepare && unresolvedGates.length === 0)
    : gateStatus?.ready_for_pr_create === true && gateStatus?.execution_gate?.status !== 'waiver_required';
  const waiverRequired = !prCreated && !readyForPrCreate && Boolean(prPrepare) && (
    gateDag
      ? unresolvedGates.length > 0 && blockingGates.length === 0
      : gateStatus?.execution_gate?.status === 'waiver_required'
  );
  const completionStatus = prCreated
    ? 'pr_created'
    : readyForPrCreate
      ? 'ready_for_pr_create'
      : waiverRequired
        ? 'waiver_required'
      : prPrepare
        ? 'blocked'
        : 'not_prepared';
  const currentPhase = prCreated
    ? 'complete'
    : readyForPrCreate
      ? 'create_pr'
      : waiverRequired
        ? 'verification'
      : blockingGate?.id === 'gate:agent_review' || blockingGate?.id?.startsWith('review:')
        ? 'agent_review'
        : blockingGate
          ? 'verification'
          : 'prepare_pr';
  const completedPhases = deriveCompletedPhases({
    prPrepare,
    verificationEvidence,
    agentReview,
    readyForPrCreate,
    prCreated
  });
  const managedWorktree = options.managedWorktree
    ? await refreshManagedWorktree(root, options.managedWorktree).catch(() => options.managedWorktree)
    : null;
  const requiredCommands = buildManagedWorktreeCommands({
    pr_prepare: buildPrPrepareCommand({ storyId, baseRef: options.baseRef }),
    pr_create: buildPrCreateCommand({ storyId, baseRef: options.baseRef })
  }, managedWorktree);
  const nextActions = deriveNextActions({
    storyId,
    baseRef: options.baseRef,
    managedWorktree,
    prPrepare,
    gateStatus,
    unresolvedGates,
    blockingGate,
    waiverRequired,
    readyForPrCreate,
    prCreated
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
    execution_dag: buildExecutionDag({ managedWorktree, completedPhases, completionStatus }),
    last_pr_prepare: prPrepare ? summarizePrPrepare(root, prPrepare) : null,
    last_review_status: agentReview ? summarizeAgentReview(agentReview) : null,
    last_verification_evidence: verificationEvidence ? summarizeVerificationEvidence(root, verificationEvidence) : null,
    pr_url: prCreate?.pr_url ?? null
  };
}

function deriveCompletedPhases({ prPrepare, verificationEvidence, agentReview, readyForPrCreate, prCreated }) {
  const phases = [];
  if (prPrepare) phases.push('prepare_pr');
  if ((verificationEvidence?.commands ?? []).length > 0) phases.push('verify');
  if (agentReview?.summary?.required_review_count > 0 && agentReview.summary.unmet_required_review_count === 0) {
    phases.push('agent_review');
  }
  if (readyForPrCreate) phases.push('ready_for_pr_create');
  if (prCreated) phases.push('create_pr');
  return phases;
}

function deriveNextActions({ storyId, baseRef, managedWorktree, prPrepare, gateStatus, unresolvedGates = [], blockingGate, waiverRequired, readyForPrCreate, prCreated }) {
  const wrap = (command) => managedWorktree?.path && managedWorktree.mode !== 'disabled'
    ? `cd ${shellQuote(managedWorktree.path)} && ${command}`
    : command;
  if (prCreated) return [];
  if (!prPrepare) return [wrap(buildPrPrepareCommand({ storyId, baseRef }))];
  if (readyForPrCreate) return [wrap(buildPrCreateCommand({ storyId, baseRef }))];
  if (waiverRequired) {
    const actions = unresolvedGates
      .flatMap((gate) => gate.required_actions?.length ? gate.required_actions : [gate.reason])
      .filter(Boolean);
    if (actions.length > 0) return actions;
    return ['Resolve unresolved non-critical gates or rerun PR create with an explicit verification waiver.'];
  }
  if (blockingGate) {
    if (blockingGate.required_actions?.length) return blockingGate.required_actions;
    return [blockingGate.reason ?? `Resolve ${blockingGate.label ?? blockingGate.id}`];
  }
  const actions = gateStatus?.next_required_actions?.length
    ? gateStatus.next_required_actions
    : gateStatus?.execution_gate?.required_actions ?? [];
  if (actions.length > 0) return actions;
  return [wrap(buildPrPrepareCommand({ storyId, baseRef }))];
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
  return nodes
    .filter((node) => [
      'story',
      'pr_route_gate',
      'pr_body_contract_gate',
      'mirror_source_traceability_gate',
      'ci_status_or_waiver_gate',
      'vibepro_artifact_policy_gate',
      'split_resolution_gate',
      'architecture_gate',
      'spec_gate',
      'decision_record_gate',
      'verification_gate',
      'requirement_gate',
      'visual_qa_gate',
      'design_quality_gate',
      'design_diagrams_gate',
      'workflow_heavy_gate',
      'pr_freshness_gate',
      'agent_review_prepare_gate',
      'agent_review_role_gate',
      'agent_review_record_gate',
      'agent_review_gate'
    ].includes(node.type))
    .filter((node) => node.required)
    .filter((node) => isUnresolvedStatus(node.status));
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
  if (gate.blocking === true && gate.status !== 'passed') return true;
  if (gate.id === 'story' && gate.status === 'transient') return true;
  if (gate.id === 'architecture' && gate.status === 'needs_review') return true;
  if (gate.id === 'spec' && ['implicit', 'inferred_empty', 'needs_review'].includes(gate.status)) return true;
  if (gate.id === 'gate:e2e' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:visual_qa' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:design_quality' && gate.status !== 'ready_for_review') return true;
  if (gate.id === 'gate:design_diagrams' && gate.status !== 'satisfied') return true;
  if (gate.id === 'gate:requirement' && ['needs_review', 'contradicted'].includes(gate.status)) return true;
  if (gate.id === 'gate:network_contract' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_route_classification' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:pr_body_contract' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:mirror_source_traceability' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:ci_status_or_waiver' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:vibepro_artifact_policy' && gate.status !== 'passed') return true;
  if (gate.id === 'gate:split_resolution' && gate.status !== 'passed') return true;
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
