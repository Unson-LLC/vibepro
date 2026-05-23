import path from 'node:path';

import { getAgentReviewStatus } from './agent-review.js';
import { preparePullRequest } from './pr-manager.js';

const CHECKPOINTS = {
  story: {
    label: 'Story / Architecture / Spec checkpoint',
    description: 'Blocks implementation until Story, Architecture, and Spec gates are explicit.',
    gate_ids: ['story', 'architecture', 'spec'],
    review_stages: []
  },
  'implementation-start': {
    label: 'Implementation Start checkpoint',
    description: 'Blocks coding until design gates and planning/spec reviews are complete.',
    gate_ids: ['story', 'architecture', 'spec', 'gate:requirement'],
    review_stages: ['planning_spec', 'architecture_spec']
  },
  'test-plan': {
    label: 'Test Plan checkpoint',
    description: 'Blocks implementation handoff until the test plan review is complete.',
    gate_ids: ['story', 'architecture', 'spec', 'gate:requirement'],
    review_stages: ['test_plan']
  },
  'implementation-complete': {
    label: 'Implementation Complete checkpoint',
    description: 'Blocks completion until implementation review and runtime gates are complete.',
    gate_ids: ['gate:network_contract', 'gate:requirement', 'gate:unit', 'gate:integration', 'gate:e2e', 'gate:visual_qa'],
    review_stages: ['implementation']
  },
  verification: {
    label: 'Verification checkpoint',
    description: 'Blocks PR handoff until verification, gate review, and current-head evidence are complete.',
    gate_ids: ['gate:network_contract', 'gate:unit', 'gate:integration', 'gate:e2e', 'gate:visual_qa'],
    review_stages: ['gate']
  },
  pr: {
    label: 'PR checkpoint',
    description: 'Blocks PR creation until every required Gate DAG item is complete.',
    gate_ids: null,
    review_stages: []
  }
};

const UNRESOLVED_STATUSES = new Set([
  'candidate',
  'missing',
  'transient',
  'implicit',
  'inferred_empty',
  'needs_evidence',
  'needs_setup',
  'needs_review',
  'needs_changes',
  'contradicted',
  'stale',
  'block',
  'failed',
  'not_generated'
]);

export function listCheckpointStages() {
  return Object.entries(CHECKPOINTS).map(([stage, policy]) => ({
    stage,
    label: policy.label,
    description: policy.description,
    gate_ids: policy.gate_ids,
    review_stages: policy.review_stages
  }));
}

export async function runCheckpoint(repoRoot, options = {}) {
  const stage = normalizeCheckpointStage(options.stage);
  const root = path.resolve(repoRoot);
  const policy = CHECKPOINTS[stage];
  const prepareResult = await preparePullRequest(root, {
    storyId: options.storyId,
    taskId: options.taskId,
    groupId: options.groupId,
    baseRef: options.baseRef,
    headRef: options.headRef,
    branchName: options.branchName,
    strict: options.strict,
    allowExtraFiles: options.allowExtraFiles,
    language: options.language
  });
  const preparation = prepareResult.preparation;
  const gateDag = preparation.pr_context?.gate_dag ?? null;
  const gateFindings = collectCheckpointGateFindings(gateDag, policy);
  const reviewFindings = await collectCheckpointReviewFindings(root, preparation.story.story_id, policy);
  const findings = [...gateFindings, ...reviewFindings];
  const status = findings.some((finding) => finding.severity === 'block') ? 'blocked' : 'passed';
  return {
    schema_version: '0.1.0',
    stage,
    label: policy.label,
    description: policy.description,
    status,
    story_id: preparation.story.story_id,
    generated_at: new Date().toISOString(),
    required_gate_ids: policy.gate_ids ?? 'all_required',
    required_review_stages: policy.review_stages,
    findings,
    artifacts: prepareResult.artifacts,
    gate_dag_summary: gateDag ? {
      overall_status: gateDag.overall_status,
      needs_evidence_count: gateDag.summary?.needs_evidence_count ?? 0,
      required_gate_count: gateDag.summary?.required_gate_count ?? 0
    } : null,
    next_actions: findings.map((finding) => finding.action).filter(Boolean)
  };
}

export function renderCheckpointSummary(result) {
  const lines = [
    '# VibePro Checkpoint',
    '',
    `- stage: ${result.stage}`,
    `- status: ${result.status}`,
    `- story: ${result.story_id}`,
    `- gate_dag: ${result.gate_dag_summary?.overall_status ?? '-'}`,
    `- findings: ${result.findings.length}`,
    ''
  ];
  if (result.findings.length > 0) {
    lines.push('## Blocking Findings', '');
    for (const finding of result.findings) {
      lines.push(`- ${finding.kind}: ${finding.label} is ${finding.status} - ${finding.reason}`);
      if (finding.action) lines.push(`  action: ${finding.action}`);
    }
    lines.push('');
  }
  if (result.next_actions.length > 0) {
    lines.push('## Next Actions', '');
    for (const action of result.next_actions) {
      lines.push(`- ${action}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function normalizeCheckpointStage(stage) {
  const normalized = stage ?? 'pr';
  if (!CHECKPOINTS[normalized]) {
    throw new Error(`Unknown checkpoint stage: ${normalized}. Supported stages: ${Object.keys(CHECKPOINTS).join(', ')}`);
  }
  return normalized;
}

function collectCheckpointGateFindings(gateDag, policy) {
  if (!gateDag) {
    return [{
      kind: 'gate_dag_missing',
      severity: 'block',
      label: 'Gate DAG',
      status: 'missing',
      reason: 'Gate DAG could not be generated',
      action: 'Run `vibepro pr prepare` and resolve setup errors.'
    }];
  }
  const gates = policy.gate_ids === null
    ? gateDag.nodes.filter((node) => node.required === true)
    : policy.gate_ids
      .map((id) => gateDag.nodes.find((node) => node.id === id))
      .filter(Boolean)
      .filter((node) => node.required !== false);
  return gates
    .filter((gate) => UNRESOLVED_STATUSES.has(gate.status))
    .map((gate) => ({
      kind: 'gate_unresolved',
      severity: 'block',
      gate_id: gate.id,
      label: gate.label ?? gate.id,
      status: gate.status,
      reason: gate.reason ?? 'Gate is unresolved',
      action: buildGateAction(gate)
    }));
}

async function collectCheckpointReviewFindings(root, storyId, policy) {
  const findings = [];
  for (const stage of policy.review_stages) {
    const status = await getAgentReviewStatus(root, { storyId, stage });
    const stageSummary = status.stages.find((item) => item.stage === stage);
    if (stageSummary?.status === 'pass') continue;
    findings.push({
      kind: 'review_stage_unresolved',
      severity: 'block',
      review_stage: stage,
      label: `Agent Review ${stage}`,
      status: stageSummary?.status ?? 'missing',
      reason: stageSummary
        ? `${stageSummary.missing_count ?? 0} missing, ${stageSummary.stale_count ?? 0} stale, ${stageSummary.block_count ?? 0} blocking review role(s)`
        : 'Agent review stage was not generated',
      action: `Run \`vibepro review prepare . --id ${storyId} --stage ${stage}\`, dispatch the generated Codex/Claude Code subagents in parallel, record every role with parallel_subagent provenance, then rerun this checkpoint.`
    });
  }
  return findings;
}

function buildGateAction(gate) {
  if (gate.id === 'story') return 'Create or select an explicit Story before continuing.';
  if (gate.id === 'architecture') return 'Add an ADR or explicit architecture decision before implementation.';
  if (gate.id === 'spec') return 'Write or regenerate the internal Spec before implementation.';
  if (gate.id === 'gate:requirement') return 'Resolve Requirement Gate gaps or contradictions in Story/Spec/Architecture.';
  if (gate.id === 'gate:unit') return `Record current-head unit evidence: \`vibepro verify record . --kind unit --status pass --command "${gate.command ?? 'npm test'}"\`.`;
  if (gate.id === 'gate:integration') return `Record current-head integration evidence: \`vibepro verify record . --kind integration --status pass --command "${gate.command ?? 'npm run typecheck'}"\`.`;
  if (gate.id === 'gate:e2e') return 'Record current-head E2E evidence and Story acceptance coverage.';
  if (gate.id === 'gate:visual_qa') return 'Record Visual QA evidence for the current UI state.';
  if (gate.id === 'gate:network_contract') return 'Resolve API route/network contract findings or record network-aware E2E evidence.';
  if (gate.id === 'gate:agent_review') return 'Run and record required Agent Review stages with Codex/Claude Code parallel subagent provenance.';
  return `Resolve ${gate.label ?? gate.id}.`;
}
