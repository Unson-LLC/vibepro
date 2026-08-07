import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { assertArtifactWritePath, resolveArtifactRoute } from './artifact-routing.js';
import { getWorkspaceDir } from './workspace.js';

const SCHEMA_VERSION = '0.3.0';
const MODEL = 'vibepro-senior-engineering-judgment-dag';
export const STANDARD_JUDGMENT_AXES = Object.freeze([
  'public_contract',
  'rollback_sensitive',
  'security_boundary',
  'data_state',
  'execution_topology',
  'ux_surface',
  'performance_semantic',
  'scope_reviewability',
  'release_ops'
]);

const ALLOWED = Object.freeze({
  frameStatus: new Set(['valid', 'invalid', 'uncertain']),
  materiality: new Set(['low', 'medium', 'high']),
  reversibility: new Set(['easy', 'costly', 'irreversible']),
  blastRadius: new Set(['local', 'multi_component', 'systemic']),
  activation: new Set(['active', 'inactive']),
  freshness: new Set(['current', 'stale', 'unknown']),
  evidenceRelation: new Set(['supports', 'refutes', 'non_discriminating']),
  constraintKind: new Set(['invariant', 'preference']),
  residualRisk: new Set(['low', 'medium', 'high', 'unknown']),
  historyBoundaryKind: new Set(['initial', 'verified_external_outcome', 'simplification_baseline']),
  batchChangeKind: new Set(['addition', 'simplification', 'validation', 'external_value']),
  structuralEffect: new Set(['increase', 'neutral', 'decrease', 'unknown']),
  externalOutcome: new Set(['improved', 'unchanged', 'regressed', 'unknown']),
  constraintStatus: new Set(['verified', 'hypothesized', 'unknown']),
  currentConstraintKind: new Set(['value_constraint', 'structural_excess']),
  decisionEvidenceStatus: new Set(['sufficient', 'insufficient', 'unknown']),
  optionAction: new Set(['build', 'fix', 'delete', 'consolidate', 'redesign', 'retire', 'measure', 'experiment'])
});

const MODE_ALLOWED_OPTION_ACTIONS = Object.freeze({
  VALUE: Object.freeze(['build', 'fix', 'delete', 'consolidate', 'redesign', 'retire']),
  SIMPLIFY: Object.freeze(['delete', 'consolidate', 'redesign', 'retire']),
  VALIDATE: Object.freeze(['measure', 'experiment'])
});

export function evaluateSeniorJudgment(input) {
  const normalized = validateSeniorJudgmentInput(input);
  const analysisDepth = deriveAnalysisDepth(normalized);
  const frameStatus = normalized.problem_frame.status;
  const frameValid = frameStatus === 'valid';
  const modeDecision = frameValid ? deriveDevelopmentMode(normalized.development_cycle) : null;
  const developmentMode = modeDecision?.mode ?? null;
  const allowedOptionActions = developmentMode ? [...MODE_ALLOWED_OPTION_ACTIONS[developmentMode]] : [];
  const safeToDefer = isSafeToDeferProfile(normalized.decision_profile);
  const activeAxes = frameValid
    ? normalized.axes.filter((axis) => axis.activation === 'active').map((axis) => axis.id)
    : [];
  const inactiveAxes = normalized.axes
    .filter((axis) => axis.activation === 'inactive')
    .map((axis) => axis.id);
  const unreachableAxes = normalized.axes
    .filter((axis) => !activeAxes.includes(axis.id))
    .map((axis) => axis.id);

  const hypothesisOutcomes = [];
  for (const axis of normalized.axes) {
    const reachable = frameValid && axis.activation === 'active';
    for (const hypothesis of axis.hypotheses) {
      hypothesisOutcomes.push(evaluateHypothesis(axis, hypothesis, {
        reachable,
        safeToDefer
      }));
    }
  }

  const constraintsById = new Map(normalized.constraints.map((constraint) => [constraint.id, constraint]));
  const { viableOptions, prunedOptions } = pruneOptions(
    normalized.options,
    constraintsById,
    developmentMode
  );
  const reachableOutcomes = hypothesisOutcomes.filter((outcome) => outcome.reachable);
  const recommendation = deriveRecommendation({
    frameStatus,
    outcomes: reachableOutcomes,
    viableOptions,
    prunedOptions,
    optionCount: normalized.options.length
  });
  const unknowns = buildUnknowns(reachableOutcomes);
  const nextActions = buildNextActions({
    frameStatus,
    outcomes: reachableOutcomes,
    viableOptions,
    recommendation,
    developmentMode
  });
  const graph = buildJudgmentGraph(normalized, {
    analysisDepth,
    activeAxes,
    hypothesisOutcomes,
    recommendation,
    developmentMode,
    developmentModeReasons: modeDecision?.reasons ?? []
  });
  const topologicalOrder = validateJudgmentGraph(graph);

  return {
    schema_version: SCHEMA_VERSION,
    model: MODEL,
    story_id: normalized.story_id,
    run_id: normalized.run_id,
    parent_run_id: normalized.parent_run_id,
    development_mode: developmentMode,
    development_mode_reasons: modeDecision?.reasons ?? [],
    allowed_option_actions: allowedOptionActions,
    analysis_depth: analysisDepth,
    nodes: graph.nodes,
    edges: graph.edges,
    topological_order: topologicalOrder,
    active_axes: activeAxes,
    inactive_axes: inactiveAxes,
    unreachable_axes: unreachableAxes,
    hypothesis_outcomes: hypothesisOutcomes,
    viable_options: viableOptions,
    pruned_options: prunedOptions,
    recommendation,
    reasons: buildRecommendationReasons({
      frameStatus,
      outcomes: reachableOutcomes,
      viableOptions,
      recommendation,
      developmentMode,
      developmentModeReasons: modeDecision?.reasons ?? []
    }),
    unknowns,
    next_actions: nextActions,
    advisory: true,
    authority: 'human_ci_repository_rules'
  };
}

export async function evaluateSeniorJudgmentRun(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  requireText(options.storyId, 'judgment evaluate --id');
  requireText(options.inputPath, 'judgment evaluate --input');
  await assertInitializedWorkspace(root);

  const inputPath = path.resolve(options.inputPath);
  const inputBytes = await readFile(inputPath, 'utf8');
  let input;
  try {
    input = JSON.parse(inputBytes);
  } catch (error) {
    throw new Error(`Invalid senior judgment input JSON: ${error.message}`);
  }
  if (input.story_id !== options.storyId) {
    throw new Error(`judgment evaluate --id ${options.storyId} does not match input story_id ${String(input.story_id)}`);
  }

  const evaluation = evaluateSeniorJudgment(input);
  const reviewRoute = await resolveArtifactRoute(root, 'review', { storyId: options.storyId });
  const reviewRoot = await assertArtifactWritePath(root, reviewRoute.canonical.relative_path);
  const judgmentRoot = path.join(reviewRoot, 'senior-judgment');
  const runsRoot = path.join(judgmentRoot, 'runs');
  const runJsonPath = await assertArtifactWritePath(root, path.relative(root, path.join(runsRoot, `${evaluation.run_id}.json`)));
  const runMarkdownPath = await assertArtifactWritePath(root, path.relative(root, path.join(runsRoot, `${evaluation.run_id}.md`)));
  const currentJsonPath = await assertArtifactWritePath(root, path.relative(root, path.join(reviewRoot, 'senior-judgment.json')));
  const currentMarkdownPath = await assertArtifactWritePath(root, path.relative(root, path.join(reviewRoot, 'senior-judgment.md')));

  if (await pathExists(runJsonPath) || await pathExists(runMarkdownPath)) {
    throw new Error(`Senior judgment run ${evaluation.run_id} already exists and is immutable`);
  }
  const current = await readJsonIfExists(currentJsonPath);
  const parent = await resolveParentRun({
    current,
    parentRunId: evaluation.parent_run_id,
    runsRoot,
    storyId: evaluation.story_id
  });
  const artifacts = {
    run_json: toRelative(root, runJsonPath),
    run_markdown: toRelative(root, runMarkdownPath),
    current_json: toRelative(root, currentJsonPath),
    current_markdown: toRelative(root, currentMarkdownPath)
  };
  const recorded = {
    ...evaluation,
    recorded_at: new Date().toISOString(),
    input_sha256: createHash('sha256').update(inputBytes).digest('hex'),
    decision_context: {
      goal: input.goal,
      observations: input.observations,
      contradictions: input.contradictions,
      problem_frame: input.problem_frame,
      development_cycle: input.development_cycle,
      decision_profile: input.decision_profile,
      axes: input.axes,
      constraints: input.constraints,
      options: input.options
    },
    decision_delta: buildDecisionDelta(parent, evaluation, input),
    artifacts
  };
  const markdown = renderSeniorJudgmentMarkdown(recorded);

  await mkdir(runsRoot, { recursive: true });
  await writeFile(runJsonPath, `${JSON.stringify(recorded, null, 2)}\n`, { flag: 'wx' });
  await writeFile(runMarkdownPath, markdown, { flag: 'wx' });
  await writeFile(currentJsonPath, `${JSON.stringify(recorded, null, 2)}\n`);
  await writeFile(currentMarkdownPath, markdown);
  return recorded;
}

export function renderSeniorJudgmentSummary(result) {
  return [
    `Senior judgment run: ${result.run_id}`,
    `Story: ${result.story_id}`,
    `Development mode: ${result.development_mode ?? 'not_selected'}`,
    `Analysis depth: ${result.analysis_depth}`,
    `Advisory recommendation: ${result.recommendation}`,
    `Active axes: ${result.active_axes.join(', ') || 'none'}`,
    `Unknowns: ${result.unknowns.length}`,
    `Artifact: ${result.artifacts.current_markdown}`,
    'Final authority remains with humans, CI, and repository rules.',
    ''
  ].join('\n');
}

export function renderSeniorJudgmentMarkdown(result) {
  const context = result.decision_context;
  const hypothesesById = new Map(
    (context.axes ?? []).flatMap((axis) => axis.hypotheses.map((hypothesis) => [hypothesis.id, hypothesis]))
  );
  const outcomes = result.hypothesis_outcomes.length > 0
    ? result.hypothesis_outcomes.flatMap((outcome) => {
      const hypothesis = hypothesesById.get(outcome.hypothesis_id);
      const lines = [
        `- \`${outcome.axis_id}/${outcome.hypothesis_id}\`: **${outcome.outcome}** — ${outcome.reason}`
      ];
      if (!hypothesis) return lines;
      lines.push(`  - Claim: ${hypothesis.claim}`);
      for (const prediction of hypothesis.predictions) {
        lines.push(`  - Prediction \`${prediction.id}\`: ${prediction.statement}`);
        const evidence = hypothesis.evidence.filter((item) => item.prediction_id === prediction.id);
        if (evidence.length === 0) {
          lines.push('    - Evidence: none');
        } else {
          lines.push(...evidence.map((item) => (
            `    - Evidence \`${item.id}\`: ${item.relation}, ${item.freshness}, \`${item.source_ref}\` — ${item.summary}`
          )));
        }
      }
      return lines;
    })
    : ['- No hypothesis branch was reachable.'];
  const viable = result.viable_options.length > 0
    ? result.viable_options.map((option) => `- \`${option.id}\`: ${option.summary} (action: ${option.action}, residual risk: ${option.residual_risk})`)
    : ['- None'];
  const pruned = result.pruned_options.length > 0
    ? result.pruned_options.map((option) => `- \`${option.id}\`: ${option.reason} (${option.pruned_by.join(', ')})`)
    : ['- None'];
  const unknowns = result.unknowns.length > 0
    ? result.unknowns.map((unknown) => (
      `- \`${unknown.hypothesis_id}\`: ${unknown.disposition}; missing predictions: ${unknown.missing_predictions.join(', ') || 'none'}; conflicting predictions: ${unknown.conflicting_predictions.join(', ') || 'none'}`
    ))
    : ['- None'];
  const actions = result.next_actions.length > 0
    ? result.next_actions.map((action) => `- ${action.type}${action.hypothesis_id ? ` for \`${action.hypothesis_id}\`` : ''}`)
    : ['- None'];
  const delta = renderDecisionDelta(result.decision_delta);
  const modeReasons = result.development_mode_reasons.length > 0
    ? result.development_mode_reasons.map((reason) => `- ${reason}`)
    : ['- Development mode was not selected because the problem frame did not reach the mode route.'];
  const developmentCycle = context.development_cycle;

  return [
    '# Senior Engineering Judgment',
    '',
    `- Story: \`${result.story_id}\``,
    `- Run: \`${result.run_id}\``,
    `- Parent run: ${result.parent_run_id ? `\`${result.parent_run_id}\`` : 'none'}`,
    `- Analysis depth: **${result.analysis_depth}**`,
    `- Advisory recommendation: **${result.recommendation}**`,
    '',
    '> This is decision support, not merge or release authority. Final authority remains with humans, CI, and repository rules.',
    '',
    '## Goal',
    '',
    context.goal.statement,
    '',
    '## Problem frame',
    '',
    `- Status: **${context.problem_frame.status}**`,
    `- Statement: ${context.problem_frame.statement}`,
    `- Reason: ${context.problem_frame.reason}`,
    '',
    '## Development mode',
    '',
    `- Development mode: **${result.development_mode ?? 'not_selected'}**`,
    `- History boundary: ${developmentCycle.history_boundary.kind} (\`${developmentCycle.history_boundary.source_ref}\`)`,
    `- Adopted batches since boundary: ${developmentCycle.adopted_batches.length}`,
    `- Current constraint: **${developmentCycle.current_constraint.kind} / ${developmentCycle.current_constraint.status}** — ${developmentCycle.current_constraint.statement}`,
    `- Decision evidence: **${developmentCycle.current_constraint.decision_evidence.status}** — ${developmentCycle.current_constraint.decision_evidence.reason}`,
    `- Decision evidence sources: ${developmentCycle.current_constraint.decision_evidence.source_refs.map((sourceRef) => `\`${sourceRef}\``).join(', ')}`,
    `- Proposed batch: \`${developmentCycle.proposed_batch.id}\``,
    `- Allowed option actions: ${result.allowed_option_actions.map((action) => `\`${action}\``).join(', ') || 'none'}`,
    '',
    ...modeReasons,
    '',
    '## Reachability',
    '',
    `- Active axes: ${result.active_axes.map((axis) => `\`${axis}\``).join(', ') || 'none'}`,
    `- Inactive axes: ${result.inactive_axes.map((axis) => `\`${axis}\``).join(', ') || 'none'}`,
    `- Unreachable axes: ${result.unreachable_axes.map((axis) => `\`${axis}\``).join(', ') || 'none'}`,
    '',
    '## Hypothesis outcomes',
    '',
    ...outcomes,
    '',
    '## Viable options',
    '',
    ...viable,
    '',
    '## Pruned options',
    '',
    ...pruned,
    '',
    '## Unknowns',
    '',
    ...unknowns,
    '',
    '## Next actions',
    '',
    ...actions,
    '',
    '## Decision delta',
    '',
    ...delta,
    ''
  ].join('\n');
}

export function validateSeniorJudgmentInput(input) {
  assertPlainObject(input, 'input');
  if (input.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported senior judgment schema_version: ${String(input.schema_version)}`);
  }
  requireText(input.story_id, 'story_id');
  requireText(input.run_id, 'run_id');
  if (input.parent_run_id !== null && input.parent_run_id !== undefined) {
    requireText(input.parent_run_id, 'parent_run_id');
    if (input.parent_run_id === input.run_id) {
      throw new Error('parent_run_id must differ from run_id');
    }
  }

  assertPlainObject(input.goal, 'goal');
  requireText(input.goal.statement, 'goal.statement');
  assertNonEmptyTextArray(input.goal.success_criteria, 'goal.success_criteria');
  assertArray(input.observations, 'observations');
  assertArray(input.contradictions, 'contradictions');
  assertPlainObject(input.problem_frame, 'problem_frame');
  assertEnum(input.problem_frame.status, ALLOWED.frameStatus, 'problem_frame.status');
  requireText(input.problem_frame.statement, 'problem_frame.statement');
  requireText(input.problem_frame.reason, 'problem_frame.reason');
  assertPlainObject(input.development_cycle, 'development_cycle');
  assertPlainObject(input.decision_profile, 'decision_profile');
  assertEnum(input.decision_profile.materiality, ALLOWED.materiality, 'decision_profile.materiality');
  assertEnum(input.decision_profile.reversibility, ALLOWED.reversibility, 'decision_profile.reversibility');
  assertEnum(input.decision_profile.blast_radius, ALLOWED.blastRadius, 'decision_profile.blast_radius');
  assertArray(input.axes, 'axes');
  assertArray(input.constraints, 'constraints');
  assertArray(input.options, 'options');

  const allIds = new Set();
  validateDevelopmentCycle(input.development_cycle, input.story_id, allIds);
  const observationIds = new Set();
  for (const observation of input.observations) {
    assertPlainObject(observation, 'observation');
    registerId(observation.id, 'observation.id', allIds);
    observationIds.add(observation.id);
    requireText(observation.statement, `observation ${observation.id}.statement`);
    requireText(observation.source_ref, `observation ${observation.id}.source_ref`);
    assertEnum(observation.freshness, ALLOWED.freshness, `observation ${observation.id}.freshness`);
  }

  for (const contradiction of input.contradictions) {
    assertPlainObject(contradiction, 'contradiction');
    registerId(contradiction.id, 'contradiction.id', allIds);
    requireText(contradiction.statement, `contradiction ${contradiction.id}.statement`);
    assertNonEmptyTextArray(contradiction.observation_refs, `contradiction ${contradiction.id}.observation_refs`);
    for (const observationRef of contradiction.observation_refs) {
      if (!observationIds.has(observationRef)) {
        throw new Error(`Dangling observation reference: ${observationRef}`);
      }
    }
  }

  const hypothesisIds = new Set();
  const axisIds = new Set();
  for (const axis of input.axes) {
    assertPlainObject(axis, 'axis');
    registerId(axis.id, 'axis.id', allIds);
    axisIds.add(axis.id);
    assertEnum(axis.activation, ALLOWED.activation, `axis ${axis.id}.activation`);
    requireText(axis.activation_reason, `axis ${axis.id}.activation_reason`);
    assertArray(axis.hypotheses, `axis ${axis.id}.hypotheses`);
    if (axis.activation === 'active' && axis.hypotheses.length === 0) {
      throw new Error(`Active axis ${axis.id} must declare at least one hypothesis`);
    }
    for (const hypothesis of axis.hypotheses) {
      assertPlainObject(hypothesis, 'hypothesis');
      registerId(hypothesis.id, 'hypothesis.id', allIds);
      hypothesisIds.add(hypothesis.id);
      requireText(hypothesis.claim, `hypothesis ${hypothesis.id}.claim`);
      assertArray(hypothesis.predictions, `hypothesis ${hypothesis.id}.predictions`);
      if (hypothesis.predictions.length === 0) {
        throw new Error(`Hypothesis ${hypothesis.id} must declare at least one prediction`);
      }
      assertArray(hypothesis.evidence, `hypothesis ${hypothesis.id}.evidence`);
      const predictionIds = new Set();
      for (const prediction of hypothesis.predictions) {
        assertPlainObject(prediction, 'prediction');
        registerId(prediction.id, 'prediction.id', allIds);
        predictionIds.add(prediction.id);
        requireText(prediction.statement, `prediction ${prediction.id}.statement`);
      }
      for (const evidence of hypothesis.evidence) {
        assertPlainObject(evidence, 'evidence');
        registerId(evidence.id, 'evidence.id', allIds);
        requireText(evidence.prediction_id, `evidence ${evidence.id}.prediction_id`);
        if (!predictionIds.has(evidence.prediction_id)) {
          throw new Error(`Dangling prediction reference: ${evidence.prediction_id}`);
        }
        assertEnum(evidence.relation, ALLOWED.evidenceRelation, `evidence ${evidence.id}.relation`);
        assertEnum(evidence.freshness, ALLOWED.freshness, `evidence ${evidence.id}.freshness`);
        requireText(evidence.source_ref, `evidence ${evidence.id}.source_ref`);
        requireText(evidence.summary, `evidence ${evidence.id}.summary`);
      }
    }
  }
  const missingStandardAxes = STANDARD_JUDGMENT_AXES.filter((axisId) => !axisIds.has(axisId));
  if (missingStandardAxes.length > 0) {
    throw new Error(`Missing standard judgment axes: ${missingStandardAxes.join(', ')}`);
  }

  const constraintIds = new Set();
  for (const constraint of input.constraints) {
    assertPlainObject(constraint, 'constraint');
    registerId(constraint.id, 'constraint.id', allIds);
    constraintIds.add(constraint.id);
    assertEnum(constraint.kind, ALLOWED.constraintKind, `constraint ${constraint.id}.kind`);
    requireText(constraint.statement, `constraint ${constraint.id}.statement`);
  }

  for (const option of input.options) {
    assertPlainObject(option, 'option');
    registerId(option.id, 'option.id', allIds);
    requireText(option.summary, `option ${option.id}.summary`);
    assertEnum(option.action, ALLOWED.optionAction, `option ${option.id}.action`);
    assertArray(option.addresses, `option ${option.id}.addresses`);
    assertArray(option.violates, `option ${option.id}.violates`);
    assertEnum(option.residual_risk, ALLOWED.residualRisk, `option ${option.id}.residual_risk`);
    for (const hypothesisRef of option.addresses) {
      requireText(hypothesisRef, `option ${option.id}.addresses[]`);
      if (!hypothesisIds.has(hypothesisRef)) {
        throw new Error(`Dangling hypothesis reference: ${hypothesisRef}`);
      }
    }
    for (const constraintRef of option.violates) {
      requireText(constraintRef, `option ${option.id}.violates[]`);
      if (!constraintIds.has(constraintRef)) {
        throw new Error(`Dangling constraint reference: ${constraintRef}`);
      }
    }
  }

  return {
    ...input,
    parent_run_id: input.parent_run_id ?? null
  };
}

function validateDevelopmentCycle(cycle, storyId, allIds) {
  assertPlainObject(cycle.history_boundary, 'development_cycle.history_boundary');
  assertEnum(
    cycle.history_boundary.kind,
    ALLOWED.historyBoundaryKind,
    'development_cycle.history_boundary.kind'
  );
  requireText(cycle.history_boundary.source_ref, 'development_cycle.history_boundary.source_ref');
  assertArray(cycle.adopted_batches, 'development_cycle.adopted_batches');

  for (const batch of cycle.adopted_batches) {
    assertPlainObject(batch, 'development_cycle adopted batch');
    registerId(batch.id, 'development_cycle.adopted_batches[].id', allIds);
    assertUniqueTextArray(batch.story_ids, `adopted batch ${batch.id}.story_ids`);
    assertEnum(batch.change_kind, ALLOWED.batchChangeKind, `adopted batch ${batch.id}.change_kind`);
    assertEnum(batch.structural_effect, ALLOWED.structuralEffect, `adopted batch ${batch.id}.structural_effect`);
    assertEnum(batch.external_outcome, ALLOWED.externalOutcome, `adopted batch ${batch.id}.external_outcome`);
    assertNonEmptyTextArray(batch.source_refs, `adopted batch ${batch.id}.source_refs`);
    if (batch.external_outcome === 'improved') {
      throw new Error(
        `history boundary must move past adopted batch ${batch.id} because external_outcome is improved`
      );
    }
  }

  assertPlainObject(cycle.current_constraint, 'development_cycle.current_constraint');
  assertEnum(
    cycle.current_constraint.status,
    ALLOWED.constraintStatus,
    'development_cycle.current_constraint.status'
  );
  assertEnum(
    cycle.current_constraint.kind,
    ALLOWED.currentConstraintKind,
    'development_cycle.current_constraint.kind'
  );
  requireText(cycle.current_constraint.statement, 'development_cycle.current_constraint.statement');
  assertNonEmptyTextArray(
    cycle.current_constraint.source_refs,
    'development_cycle.current_constraint.source_refs'
  );
  assertPlainObject(
    cycle.current_constraint.decision_evidence,
    'development_cycle.current_constraint.decision_evidence'
  );
  assertEnum(
    cycle.current_constraint.decision_evidence.status,
    ALLOWED.decisionEvidenceStatus,
    'development_cycle.current_constraint.decision_evidence.status'
  );
  requireText(
    cycle.current_constraint.decision_evidence.reason,
    'development_cycle.current_constraint.decision_evidence.reason'
  );
  assertNonEmptyTextArray(
    cycle.current_constraint.decision_evidence.source_refs,
    'development_cycle.current_constraint.decision_evidence.source_refs'
  );

  const proposed = cycle.proposed_batch;
  assertPlainObject(proposed, 'development_cycle.proposed_batch');
  registerId(proposed.id, 'development_cycle.proposed_batch.id', allIds);
  assertUniqueTextArray(proposed.story_ids, 'development_cycle.proposed_batch.story_ids');
  if (!proposed.story_ids.includes(storyId)) {
    throw new Error(`development_cycle.proposed_batch.story_ids must include story_id ${storyId}`);
  }
  assertNonEmptyTextArray(proposed.source_refs, 'development_cycle.proposed_batch.source_refs');
}

export function validateJudgmentGraph(graph) {
  assertPlainObject(graph, 'graph');
  assertArray(graph.nodes, 'graph.nodes');
  assertArray(graph.edges, 'graph.edges');
  const nodesById = new Map();
  for (const node of graph.nodes) {
    assertPlainObject(node, 'graph node');
    requireText(node.id, 'graph node.id');
    if (nodesById.has(node.id)) throw new Error(`Duplicate graph node ID: ${node.id}`);
    nodesById.set(node.id, node);
  }

  const indegree = new Map([...nodesById.keys()].map((id) => [id, 0]));
  const outbound = new Map([...nodesById.keys()].map((id) => [id, []]));
  for (const edge of graph.edges) {
    assertPlainObject(edge, 'graph edge');
    requireText(edge.from, 'graph edge.from');
    requireText(edge.to, 'graph edge.to');
    if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) {
      throw new Error(`Dangling graph edge: ${edge.from} -> ${edge.to}`);
    }
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outbound.get(edge.from).push(edge.to);
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort();
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of outbound.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (order.length !== graph.nodes.length) {
    throw new Error('Senior judgment graph contains a cycle');
  }
  return order;
}

function evaluateHypothesis(axis, hypothesis, context) {
  if (!context.reachable) {
    return {
      axis_id: axis.id,
      hypothesis_id: hypothesis.id,
      reachable: false,
      outcome: 'not_reached',
      decisive_evidence: [],
      missing_predictions: [],
      conflicting_predictions: [],
      reason: 'The parent judgment axis was not reachable.'
    };
  }

  const currentEvidence = hypothesis.evidence.filter((evidence) => evidence.freshness === 'current');
  const supportedPredictionIds = new Set(
    currentEvidence
      .filter((evidence) => evidence.relation === 'supports')
      .map((evidence) => evidence.prediction_id)
  );
  const refutedPredictionIds = new Set(
    currentEvidence
      .filter((evidence) => evidence.relation === 'refutes')
      .map((evidence) => evidence.prediction_id)
  );
  const cleanRefutations = [...refutedPredictionIds]
    .filter((predictionId) => !supportedPredictionIds.has(predictionId));
  const conflictingPredictions = [...refutedPredictionIds]
    .filter((predictionId) => supportedPredictionIds.has(predictionId));
  if (cleanRefutations.length > 0) {
    return {
      axis_id: axis.id,
      hypothesis_id: hypothesis.id,
      reachable: true,
      outcome: 'hypothesis_refuted',
      decisive_evidence: currentEvidence
        .filter((evidence) => (
          evidence.relation === 'refutes' && cleanRefutations.includes(evidence.prediction_id)
        ))
        .map((evidence) => evidence.id),
      missing_predictions: [],
      conflicting_predictions: [],
      reason: 'At least one current discriminating prediction was refuted.'
    };
  }

  const missingPredictions = hypothesis.predictions
    .map((prediction) => prediction.id)
    .filter((predictionId) => !supportedPredictionIds.has(predictionId));
  if (conflictingPredictions.length > 0) {
    return {
      axis_id: axis.id,
      hypothesis_id: hypothesis.id,
      reachable: true,
      outcome: context.safeToDefer ? 'safe_to_defer' : 'inconclusive',
      decisive_evidence: [],
      missing_predictions: missingPredictions.filter((predictionId) => !conflictingPredictions.includes(predictionId)),
      conflicting_predictions: conflictingPredictions,
      reason: 'Current evidence both supports and refutes the same prediction.'
    };
  }
  if (missingPredictions.length === 0) {
    return {
      axis_id: axis.id,
      hypothesis_id: hypothesis.id,
      reachable: true,
      outcome: 'risk_confirmed',
      decisive_evidence: currentEvidence
        .filter((evidence) => evidence.relation === 'supports')
        .map((evidence) => evidence.id),
      missing_predictions: [],
      conflicting_predictions: [],
      reason: 'Every declared prediction has current supporting evidence and none is refuted.'
    };
  }

  return {
    axis_id: axis.id,
    hypothesis_id: hypothesis.id,
    reachable: true,
    outcome: context.safeToDefer ? 'safe_to_defer' : 'inconclusive',
    decisive_evidence: [],
    missing_predictions: missingPredictions,
    conflicting_predictions: [],
    reason: context.safeToDefer
      ? 'Evidence is inconclusive, but the decision profile is low-impact, local, and easily reversible.'
      : 'Current discriminating evidence is insufficient to support or refute every prediction.'
  };
}

function deriveDevelopmentMode(cycle) {
  const ineffectiveGrowth = cycle.adopted_batches.filter((batch) => (
    batch.structural_effect === 'increase'
    && ['unchanged', 'regressed'].includes(batch.external_outcome)
  ));
  if (ineffectiveGrowth.length > 0) {
    return {
      mode: 'SIMPLIFY',
      reasons: [
        `Structural growth failed to improve the external outcome in adopted batch(es): ${ineffectiveGrowth.map((batch) => batch.id).join(', ')}.`
      ]
    };
  }

  if (cycle.current_constraint.status !== 'verified') {
    return {
      mode: 'VALIDATE',
      reasons: [`The current constraint is ${cycle.current_constraint.status}, not verified.`]
    };
  }

  if (cycle.current_constraint.decision_evidence.status !== 'sufficient') {
    return {
      mode: 'VALIDATE',
      reasons: [
        `Decision evidence is ${cycle.current_constraint.decision_evidence.status}, not sufficient to select an intervention direction.`
      ]
    };
  }

  const unmeasuredGrowth = cycle.adopted_batches.filter((batch) => (
    batch.structural_effect === 'increase' && batch.external_outcome === 'unknown'
  ));
  if (unmeasuredGrowth.length > 0) {
    return {
      mode: 'VALIDATE',
      reasons: [
        `External outcome is unknown after structural growth in adopted batch(es): ${unmeasuredGrowth.map((batch) => batch.id).join(', ')}.`
      ]
    };
  }

  if (cycle.current_constraint.kind === 'structural_excess') {
    return {
      mode: 'SIMPLIFY',
      reasons: ['Sufficient decision evidence identifies the verified current constraint as structural excess.']
    };
  }

  return {
    mode: 'VALUE',
    reasons: ['Sufficient decision evidence identifies the verified current constraint as a value constraint.']
  };
}

function pruneOptions(options, constraintsById, developmentMode) {
  const viableOptions = [];
  const prunedOptions = [];
  const allowedActions = new Set(MODE_ALLOWED_OPTION_ACTIONS[developmentMode] ?? []);
  for (const option of options) {
    if (developmentMode && !allowedActions.has(option.action)) {
      prunedOptions.push({
        ...option,
        pruned_by: [`development_mode:${developmentMode}`],
        reason: 'development_mode_mismatch'
      });
      continue;
    }
    const violatedInvariants = option.violates.filter(
      (constraintId) => constraintsById.get(constraintId)?.kind === 'invariant'
    );
    const preferenceTradeoffs = option.violates.filter(
      (constraintId) => constraintsById.get(constraintId)?.kind === 'preference'
    );
    if (violatedInvariants.length > 0) {
      prunedOptions.push({
        ...option,
        pruned_by: violatedInvariants,
        reason: 'violates_invariant'
      });
    } else {
      viableOptions.push({
        ...option,
        preference_tradeoffs: preferenceTradeoffs
      });
    }
  }
  return { viableOptions, prunedOptions };
}

function deriveRecommendation({ frameStatus, outcomes, viableOptions, prunedOptions, optionCount }) {
  if (frameStatus === 'invalid') return 'revise_problem';
  if (frameStatus === 'uncertain') return 'human_decision_required';
  if (
    optionCount > 0
    && viableOptions.length === 0
    && prunedOptions.some((option) => option.reason === 'development_mode_mismatch')
  ) return 'revise_options';
  if (outcomes.some((outcome) => outcome.outcome === 'inconclusive')) return 'needs_investigation';

  const confirmed = outcomes.filter((outcome) => outcome.outcome === 'risk_confirmed');
  const residualUnknown = confirmed.filter((outcome) => {
    const addressing = viableOptions.filter((option) => option.addresses.includes(outcome.hypothesis_id));
    return addressing.length > 0
      && !addressing.some((option) => ['low', 'medium'].includes(option.residual_risk))
      && addressing.some((option) => option.residual_risk === 'unknown');
  });
  if (residualUnknown.length > 0) return 'needs_investigation';
  const uncovered = confirmed.filter((outcome) => (
    !viableOptions.some((option) => (
      option.addresses.includes(outcome.hypothesis_id)
      && ['low', 'medium'].includes(option.residual_risk)
    ))
  ));
  if (uncovered.length > 0) return 'do_not_proceed';
  if (confirmed.length > 0) return 'proceed_with_followup';
  if (outcomes.some((outcome) => outcome.outcome === 'safe_to_defer')) return 'proceed_with_followup';
  return 'proceed';
}

function buildUnknowns(outcomes) {
  return outcomes
    .filter((outcome) => ['inconclusive', 'safe_to_defer'].includes(outcome.outcome))
    .map((outcome) => ({
      axis_id: outcome.axis_id,
      hypothesis_id: outcome.hypothesis_id,
      disposition: outcome.outcome,
      missing_predictions: outcome.missing_predictions,
      conflicting_predictions: outcome.conflicting_predictions
    }));
}

function buildNextActions({ frameStatus, outcomes, viableOptions, recommendation, developmentMode }) {
  if (frameStatus === 'invalid') {
    return [{ type: 'reframe_problem', reason: 'The current problem frame was judged invalid.' }];
  }
  if (frameStatus === 'uncertain') {
    return [{ type: 'human_decision', reason: 'The problem frame could not be established.' }];
  }

  const actions = [];
  if (developmentMode === 'SIMPLIFY') {
    actions.push({
      type: 'prioritize_simplification_batch',
      allowed_actions: [...MODE_ALLOWED_OPTION_ACTIONS.SIMPLIFY]
    });
  } else if (developmentMode === 'VALIDATE') {
    actions.push({
      type: 'validate_external_outcome_before_next_delivery_batch',
      allowed_actions: [...MODE_ALLOWED_OPTION_ACTIONS.VALIDATE]
    });
  }
  if (recommendation === 'revise_options') {
    actions.push({
      type: 'design_mode_compatible_option',
      development_mode: developmentMode,
      allowed_actions: [...(MODE_ALLOWED_OPTION_ACTIONS[developmentMode] ?? [])]
    });
  }
  for (const outcome of outcomes) {
    if (outcome.outcome === 'inconclusive') {
      actions.push({
        type: outcome.conflicting_predictions.length > 0
          ? 'resolve_conflicting_evidence'
          : 'collect_discriminating_evidence',
        hypothesis_id: outcome.hypothesis_id,
        prediction_ids: outcome.conflicting_predictions.length > 0
          ? outcome.conflicting_predictions
          : outcome.missing_predictions,
        missing_prediction_ids: outcome.missing_predictions
      });
    } else if (outcome.outcome === 'safe_to_defer') {
      actions.push({
        type: 'follow_up_after_change',
        hypothesis_id: outcome.hypothesis_id,
        prediction_ids: outcome.missing_predictions
      });
    } else if (outcome.outcome === 'risk_confirmed') {
      const optionIds = viableOptions
        .filter((option) => option.addresses.includes(outcome.hypothesis_id))
        .map((option) => option.id);
      actions.push({
        type: optionIds.length > 0 ? 'review_mitigation_option' : 'design_mitigation',
        hypothesis_id: outcome.hypothesis_id,
        option_ids: optionIds
      });
    }
  }
  if (recommendation === 'proceed' && actions.length === 0) {
    actions.push({ type: 'hand_off_to_human_ci', reason: 'All reachable hypotheses were refuted or no risk axis was active.' });
  }
  return actions;
}

function buildRecommendationReasons({
  frameStatus,
  outcomes,
  viableOptions,
  recommendation,
  developmentMode,
  developmentModeReasons
}) {
  if (frameStatus === 'invalid') return ['The problem frame was judged invalid before risk-axis evaluation.'];
  if (frameStatus === 'uncertain') return ['The problem frame remains uncertain and requires explicit human judgment.'];
  const counts = Object.create(null);
  for (const outcome of outcomes) counts[outcome.outcome] = (counts[outcome.outcome] ?? 0) + 1;
  return [
    `Development mode: ${developmentMode}.`,
    ...developmentModeReasons,
    `Reachable hypotheses: ${outcomes.length}.`,
    `Outcomes: ${Object.entries(counts).map(([state, count]) => `${state}=${count}`).join(', ') || 'none'}.`,
    `Viable mitigation options: ${viableOptions.length}.`,
    `Advisory recommendation: ${recommendation}.`
  ];
}

function buildJudgmentGraph(input, context) {
  const nodes = [];
  const edges = [];
  const addNode = (id, type, state, details = {}) => nodes.push({ id, type, state, ...details });
  const addEdge = (from, to, condition, traversed) => edges.push({ from, to, condition, traversed });
  const frameStatus = input.problem_frame.status;
  const frameValid = frameStatus === 'valid';
  const developmentMode = context.developmentMode;
  const adoptedStoryCount = input.development_cycle.adopted_batches
    .reduce((count, batch) => count + batch.story_ids.length, 0);

  addNode('input_integrity', 'common_spine', 'satisfied');
  addNode('goal_contract', 'common_spine', 'satisfied');
  addNode('portfolio_history', 'common_spine', 'satisfied', {
    boundary_kind: input.development_cycle.history_boundary.kind,
    boundary_source_ref: input.development_cycle.history_boundary.source_ref,
    adopted_batch_count: input.development_cycle.adopted_batches.length,
    adopted_story_count: adoptedStoryCount
  });
  addNode('contradiction_scan', 'common_spine', 'satisfied', { contradiction_count: input.contradictions.length });
  addNode('problem_frame', 'common_spine', frameStatus === 'valid'
    ? 'satisfied'
    : frameStatus === 'invalid' ? 'reframe_required' : 'human_decision_required');
  addNode('development_mode_route', 'mode_route', frameValid ? 'satisfied' : 'not_reached', {
    development_mode: developmentMode,
    reasons: context.developmentModeReasons
  });
  for (const mode of ['VALUE', 'SIMPLIFY', 'VALIDATE']) {
    addNode(`mode:${mode.toLowerCase()}`, 'development_mode', frameValid && developmentMode === mode
      ? 'active'
      : 'not_reached');
  }
  addNode('decision_profile', 'common_spine', frameValid ? 'satisfied' : 'not_reached');
  addNode('depth_route', 'common_spine', frameValid ? 'satisfied' : 'not_reached', { depth: context.analysisDepth });
  addNode('active_branch_fan_in', 'fan_in', frameValid ? deriveFanInState(context.hypothesisOutcomes) : 'not_reached');
  addNode('option_pruning', 'constraint_pruning', frameValid ? 'satisfied' : 'not_reached', {
    development_mode: developmentMode,
    allowed_actions: developmentMode ? [...MODE_ALLOWED_OPTION_ACTIONS[developmentMode]] : []
  });
  addNode('recommendation', 'terminal', recommendationState(context.recommendation), {
    recommendation: context.recommendation,
    advisory: true
  });

  addEdge('input_integrity', 'goal_contract', 'valid_input', true);
  addEdge('goal_contract', 'portfolio_history', 'goal_fixed', true);
  addEdge('portfolio_history', 'contradiction_scan', 'causal_history_boundary_fixed', true);
  addEdge('contradiction_scan', 'problem_frame', 'observations_recorded', true);
  addEdge('problem_frame', 'development_mode_route', 'problem_frame == valid', frameValid);
  addEdge('problem_frame', 'recommendation', 'problem_frame != valid', !frameValid);
  for (const mode of ['VALUE', 'SIMPLIFY', 'VALIDATE']) {
    const modeNodeId = `mode:${mode.toLowerCase()}`;
    const selected = frameValid && developmentMode === mode;
    addEdge('development_mode_route', modeNodeId, `development_mode == ${mode}`, selected);
    addEdge(modeNodeId, 'decision_profile', 'selected_mode_enters_story_judgment', selected);
  }
  addEdge('decision_profile', 'depth_route', 'development_mode_selected', frameValid);

  const outcomeByHypothesis = new Map(context.hypothesisOutcomes.map((outcome) => [outcome.hypothesis_id, outcome]));
  for (const axis of input.axes) {
    const axisReachable = frameValid && axis.activation === 'active';
    const axisNodeId = `axis:${axis.id}`;
    const axisFanInId = `axis:${axis.id}:fan_in`;
    addNode(axisNodeId, 'judgment_axis', axisReachable ? 'active' : 'not_reached', {
      activation_reason: axis.activation_reason
    });
    addNode(axisFanInId, 'fan_in', axisReachable
      ? deriveFanInState(axis.hypotheses.map((hypothesis) => outcomeByHypothesis.get(hypothesis.id)))
      : 'not_reached');
    addEdge('depth_route', axisNodeId, `axis ${axis.id} is active`, axisReachable);

    for (const hypothesis of axis.hypotheses) {
      const claimId = `hypothesis:${hypothesis.id}:claim`;
      const verdictId = `hypothesis:${hypothesis.id}:verdict`;
      const outcome = outcomeByHypothesis.get(hypothesis.id);
      addNode(claimId, 'hypothesis_claim', axisReachable ? 'active' : 'not_reached', { claim: hypothesis.claim });
      addNode(verdictId, 'hypothesis_verdict', axisReachable ? outcome.outcome : 'not_reached', {
        outcome: axisReachable ? outcome.outcome : 'not_reached'
      });
      addEdge(axisNodeId, claimId, 'axis_reachable', axisReachable);

      for (const prediction of hypothesis.predictions) {
        const predictionId = `prediction:${prediction.id}`;
        const predictionEvidence = hypothesis.evidence.filter((evidence) => evidence.prediction_id === prediction.id);
        addNode(predictionId, 'prediction', axisReachable ? 'active' : 'not_reached', { statement: prediction.statement });
        addEdge(claimId, predictionId, 'prediction_derived_from_hypothesis', axisReachable);
        if (predictionEvidence.length === 0) {
          addEdge(predictionId, verdictId, 'no_evidence_recorded', axisReachable);
        }
        for (const evidence of predictionEvidence) {
          const evidenceId = `evidence:${evidence.id}`;
          const discriminating = evidence.freshness === 'current' && evidence.relation !== 'non_discriminating';
          addNode(evidenceId, 'evidence', axisReachable
            ? discriminating ? 'satisfied' : 'candidate'
            : 'not_reached', {
            relation: evidence.relation,
            freshness: evidence.freshness,
            source_ref: evidence.source_ref
          });
          addEdge(predictionId, evidenceId, 'evidence_tests_prediction', axisReachable);
          addEdge(evidenceId, verdictId, 'evidence_contributes_to_verdict', axisReachable);
        }
      }
      addEdge(verdictId, axisFanInId, 'hypothesis_branch_completed', axisReachable);
    }
    addEdge(axisFanInId, 'active_branch_fan_in', 'reachable_axis_completed', axisReachable);
  }

  addEdge('depth_route', 'active_branch_fan_in', 'no_active_axes', frameValid && context.activeAxes.length === 0);
  addEdge('active_branch_fan_in', 'option_pruning', 'reachable_branches_completed', frameValid);
  addEdge('option_pruning', 'recommendation', 'constraints_applied', frameValid);
  return { nodes, edges };
}

function deriveFanInState(outcomes) {
  const reachable = outcomes.filter((outcome) => outcome?.reachable);
  if (reachable.some((outcome) => outcome.outcome === 'inconclusive')) return 'inconclusive';
  if (reachable.some((outcome) => outcome.outcome === 'risk_confirmed')) return 'risk_confirmed';
  if (reachable.some((outcome) => outcome.outcome === 'safe_to_defer')) return 'safe_to_defer';
  return 'satisfied';
}

function recommendationState(recommendation) {
  if (recommendation === 'revise_problem') return 'reframe_required';
  if (recommendation === 'human_decision_required') return 'human_decision_required';
  if (recommendation === 'needs_investigation') return 'inconclusive';
  return 'satisfied';
}

function deriveAnalysisDepth(input) {
  const profile = input.decision_profile;
  return profile.materiality === 'high'
    || profile.reversibility === 'irreversible'
    || profile.blast_radius === 'systemic'
    || input.contradictions.length > 0
    ? 'deep'
    : 'light';
}

function isSafeToDeferProfile(profile) {
  return profile.materiality === 'low'
    && profile.reversibility === 'easy'
    && profile.blast_radius === 'local';
}

async function assertInitializedWorkspace(repoRoot) {
  const manifestPath = path.join(getWorkspaceDir(repoRoot), 'vibepro-manifest.json');
  try {
    await access(manifestPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('judgment evaluate requires an initialized VibePro workspace. Run `vibepro init <repo>` first.');
    }
    throw error;
  }
}

async function resolveParentRun({ current, parentRunId, runsRoot, storyId }) {
  if (!current && parentRunId === null) return null;
  if (current && parentRunId === null) {
    throw new Error(`parent_run_id must reference current run ${current.run_id}`);
  }
  const parentPath = path.join(runsRoot, `${parentRunId}.json`);
  const parent = await readJsonIfExists(parentPath);
  if (!parent) throw new Error(`Parent run ${parentRunId} does not exist`);
  if (parent.story_id !== storyId || parent.run_id !== parentRunId) {
    throw new Error(`Parent run ${parentRunId} does not belong to story ${storyId}`);
  }
  if (current && current.run_id !== parentRunId) {
    throw new Error(`parent_run_id must reference current run ${current.run_id}`);
  }
  return parent;
}

function buildDecisionDelta(parent, evaluation, input) {
  if (!parent) return null;
  const previousOutcomes = new Map(
    (parent.hypothesis_outcomes ?? []).map((outcome) => [outcome.hypothesis_id, outcome.outcome])
  );
  const currentOutcomes = new Map(
    evaluation.hypothesis_outcomes.map((outcome) => [outcome.hypothesis_id, outcome.outcome])
  );
  const hypothesisIds = [...new Set([...previousOutcomes.keys(), ...currentOutcomes.keys()])].sort();
  return {
    problem_frame: {
      from: parent.decision_context?.problem_frame?.status ?? 'absent',
      to: input.problem_frame.status
    },
    development_mode: {
      from: parent.development_mode ?? 'not_selected',
      to: evaluation.development_mode ?? 'not_selected'
    },
    analysis_depth: { from: parent.analysis_depth, to: evaluation.analysis_depth },
    recommendation: { from: parent.recommendation, to: evaluation.recommendation },
    activated_axes: evaluation.active_axes.filter((axis) => !(parent.active_axes ?? []).includes(axis)),
    deactivated_axes: (parent.active_axes ?? []).filter((axis) => !evaluation.active_axes.includes(axis)),
    hypothesis_changes: hypothesisIds
      .map((hypothesisId) => ({
        hypothesis_id: hypothesisId,
        from: previousOutcomes.get(hypothesisId) ?? 'absent',
        to: currentOutcomes.get(hypothesisId) ?? 'absent'
      }))
      .filter((change) => change.from !== change.to)
  };
}

function renderDecisionDelta(delta) {
  if (!delta) return ['- Initial judgment run.'];
  const lines = [
    `- Problem frame: ${delta.problem_frame.from} -> ${delta.problem_frame.to}`,
    `- Development mode: ${delta.development_mode.from} -> ${delta.development_mode.to}`,
    `- Analysis depth: ${delta.analysis_depth.from} -> ${delta.analysis_depth.to}`,
    `- Recommendation: ${delta.recommendation.from} -> ${delta.recommendation.to}`,
    `- Activated axes: ${delta.activated_axes.map((axis) => `\`${axis}\``).join(', ') || 'none'}`,
    `- Deactivated axes: ${delta.deactivated_axes.map((axis) => `\`${axis}\``).join(', ') || 'none'}`
  ];
  if (delta.hypothesis_changes.length === 0) {
    lines.push('- Hypothesis changes: none');
  } else {
    lines.push('- Hypothesis changes:');
    lines.push(...delta.hypothesis_changes.map((change) => (
      `  - \`${change.hypothesis_id}\`: ${change.from} -> ${change.to}`
    )));
  }
  return lines;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function toRelative(repoRoot, filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function registerId(value, label, ids) {
  requireText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error(`${label} contains unsupported characters: ${value}`);
  }
  if (ids.has(value)) throw new Error(`Duplicate ID: ${value}`);
  ids.add(value);
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label} must be one of: ${[...allowed].join(', ')}`);
  }
}

function assertNonEmptyTextArray(value, label) {
  assertArray(value, label);
  if (value.length === 0) throw new Error(`${label} must not be empty`);
  value.forEach((item, index) => requireText(item, `${label}[${index}]`));
}

function assertUniqueTextArray(value, label) {
  assertNonEmptyTextArray(value, label);
  if (new Set(value).size !== value.length) throw new Error(`${label} must not contain duplicates`);
}

function assertArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}
