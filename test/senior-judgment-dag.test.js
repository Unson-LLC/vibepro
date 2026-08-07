import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STANDARD_JUDGMENT_AXES,
  evaluateSeniorJudgment,
  validateSeniorJudgmentInput,
  validateJudgmentGraph
} from '../src/senior-judgment-dag.js';

function createInput(overrides = {}) {
  const { axes = [], ...rest } = overrides;
  return {
    schema_version: '0.2.0',
    story_id: 'story-senior-judgment',
    run_id: 'judgment-001',
    parent_run_id: null,
    goal: {
      statement: 'Ship the smallest change that fixes the actual problem',
      success_criteria: ['The observed failure no longer occurs']
    },
    observations: [{
      id: 'obs-1',
      statement: 'The current implementation fails for the target path',
      source_ref: 'test/failure.test.js',
      freshness: 'current'
    }],
    contradictions: [],
    problem_frame: {
      status: 'valid',
      statement: 'The target path violates the expected contract',
      reason: 'A current failing test reproduces the contract mismatch'
    },
    development_cycle: {
      history_boundary: {
        kind: 'initial',
        source_ref: 'docs/stories/story-senior-judgment.md'
      },
      adopted_batches: [],
      current_constraint: {
        status: 'verified',
        statement: 'The current target path blocks the declared external outcome',
        source_refs: ['test/failure.test.js']
      },
      proposed_batch: {
        id: 'batch-current',
        story_ids: ['story-senior-judgment'],
        change_kind: 'external_value',
        directly_addresses_constraint: true,
        source_refs: ['docs/stories/story-senior-judgment.md']
      }
    },
    decision_profile: {
      materiality: 'medium',
      reversibility: 'costly',
      blast_radius: 'multi_component'
    },
    axes: completeAxes(axes),
    constraints: [],
    options: [],
    ...rest
  };
}

test('SEJ-000 portfolio history and one selected development mode precede story-local axes', () => {
  const result = evaluateSeniorJudgment(createInput());
  const order = new Map(result.topological_order.map((id, index) => [id, index]));

  assert.equal(result.development_mode, 'VALUE');
  assert.ok(order.get('goal_contract') < order.get('portfolio_history'));
  assert.ok(order.get('portfolio_history') < order.get('contradiction_scan'));
  assert.ok(order.get('problem_frame') < order.get('development_mode_route'));
  assert.ok(order.get('development_mode_route') < order.get('mode:value'));
  assert.ok(order.get('mode:value') < order.get('decision_profile'));
  assert.ok(order.get('decision_profile') < order.get('axis:data_state'));
  assert.equal(result.nodes.find((node) => node.id === 'mode:value').state, 'active');
  assert.equal(result.nodes.find((node) => node.id === 'mode:simplify').state, 'not_reached');
  assert.equal(result.nodes.find((node) => node.id === 'mode:validate').state, 'not_reached');
});

test('SEJ-MODE-1 verified current constraint directly addressed by the batch selects VALUE', () => {
  const result = evaluateSeniorJudgment(createInput({
    options: [{
      id: 'fix-current-constraint',
      summary: 'Fix the current user-facing failure',
      action: 'fix',
      addresses: [],
      violates: [],
      residual_risk: 'low'
    }]
  }));

  assert.equal(result.development_mode, 'VALUE');
  assert.deepEqual(result.allowed_option_actions, ['build', 'fix', 'delete', 'consolidate', 'redesign', 'retire']);
  assert.deepEqual(result.viable_options.map((option) => option.id), ['fix-current-constraint']);
});

test('SEJ-MODE-2/5 ineffective structural addition selects SIMPLIFY and prunes additive options', () => {
  const input = createInput({
    development_cycle: {
      history_boundary: {
        kind: 'verified_external_outcome',
        source_ref: 'analytics/release-40'
      },
      adopted_batches: [{
        id: 'batch-41',
        story_ids: ['story-gate-addition', 'story-evidence-addition'],
        change_kind: 'addition',
        structural_effect: 'increase',
        external_outcome: 'unchanged',
        source_refs: ['git/release-41', 'analytics/release-41']
      }],
      current_constraint: {
        status: 'verified',
        statement: 'External completion did not improve',
        source_refs: ['analytics/release-41']
      },
      proposed_batch: {
        id: 'batch-42',
        story_ids: ['story-senior-judgment', 'story-next-control'],
        change_kind: 'addition',
        directly_addresses_constraint: true,
        source_refs: ['docs/stories/story-next-control.md']
      }
    },
    options: [
      {
        id: 'add-another-gate',
        summary: 'Add another control surface',
        action: 'build',
        addresses: [],
        violates: [],
        residual_risk: 'medium'
      },
      {
        id: 'consolidate-controls',
        summary: 'Consolidate the existing control surfaces',
        action: 'consolidate',
        addresses: [],
        violates: [],
        residual_risk: 'low'
      }
    ]
  });
  const result = evaluateSeniorJudgment(input);

  assert.equal(result.development_mode, 'SIMPLIFY');
  assert.deepEqual(result.viable_options.map((option) => option.id), ['consolidate-controls']);
  assert.equal(result.pruned_options.find((option) => option.id === 'add-another-gate').reason, 'development_mode_mismatch');

  const incompatibleOnly = evaluateSeniorJudgment({
    ...input,
    run_id: 'judgment-002',
    options: [input.options[0]]
  });
  assert.equal(incompatibleOnly.recommendation, 'revise_options');
  assert.ok(incompatibleOnly.next_actions.some((action) => action.type === 'design_mode_compatible_option'));
});

test('SEJ-MODE-3/4 unknown outcome selects VALIDATE without counting parallel stories as repeated additions', () => {
  const result = evaluateSeniorJudgment(createInput({
    development_cycle: {
      history_boundary: {
        kind: 'initial',
        source_ref: 'docs/management/REBUILD.md'
      },
      adopted_batches: [{
        id: 'parallel-batch',
        story_ids: ['story-a', 'story-b', 'story-c', 'story-d'],
        change_kind: 'addition',
        structural_effect: 'increase',
        external_outcome: 'unknown',
        source_refs: ['git/parallel-batch']
      }],
      current_constraint: {
        status: 'verified',
        statement: 'A current external constraint is known',
        source_refs: ['analytics/current']
      },
      proposed_batch: {
        id: 'next-batch',
        story_ids: ['story-senior-judgment', 'story-next'],
        change_kind: 'addition',
        directly_addresses_constraint: true,
        source_refs: ['docs/stories/story-next.md']
      }
    },
    options: [
      {
        id: 'ship-next-batch',
        summary: 'Ship another implementation batch',
        action: 'fix',
        addresses: [],
        violates: [],
        residual_risk: 'low'
      },
      {
        id: 'measure-current-outcome',
        summary: 'Measure the current external outcome',
        action: 'measure',
        addresses: [],
        violates: [],
        residual_risk: 'low'
      }
    ]
  }));

  const historyNode = result.nodes.find((node) => node.id === 'portfolio_history');
  assert.equal(result.development_mode, 'VALIDATE');
  assert.equal(historyNode.adopted_batch_count, 1);
  assert.equal(historyNode.adopted_story_count, 4);
  assert.deepEqual(result.viable_options.map((option) => option.id), ['measure-current-outcome']);
  assert.equal(result.pruned_options.find((option) => option.id === 'ship-next-batch').reason, 'development_mode_mismatch');
});

function completeAxes(axes) {
  const supplied = new Map(axes.map((axis) => [axis.id, axis]));
  return [
    ...STANDARD_JUDGMENT_AXES.map((axisId) => supplied.get(axisId) ?? ({
      id: axisId,
      activation: 'inactive',
      activation_reason: 'The scope scan found no reachable concern for this axis',
      hypotheses: []
    })),
    ...axes.filter((axis) => !STANDARD_JUDGMENT_AXES.includes(axis.id))
  ];
}

function hypothesisAxis({
  axisId = 'data_state',
  activation = 'active',
  hypothesisId = 'h-1',
  predictions = [{ id: 'p-1', statement: 'The predicted effect is observable' }],
  evidence = []
} = {}) {
  return {
    id: axisId,
    activation,
    activation_reason: activation === 'active' ? 'The change reaches this boundary' : 'No reachable change touches this boundary',
    hypotheses: [{
      id: hypothesisId,
      claim: 'The change creates a material risk',
      predictions,
      evidence
    }]
  };
}

test('SEJ-001 invalid problem frame short-circuits judgment axes', () => {
  const result = evaluateSeniorJudgment(createInput({
    problem_frame: {
      status: 'invalid',
      statement: 'The originally reported symptom is the root problem',
      reason: 'The observed facts identify a different generating mechanism'
    },
    axes: [hypothesisAxis()]
  }));

  assert.equal(result.recommendation, 'revise_problem');
  assert.equal(result.development_mode, null);
  assert.equal(result.nodes.find((node) => node.id === 'development_mode_route').state, 'not_reached');
  assert.equal(result.nodes.find((node) => node.id === 'axis:data_state').state, 'not_reached');
  assert.deepEqual(result.active_axes, []);
  assert.equal(result.advisory, true);
  assert.equal('ready_for_pr_create' in result, false);
});

test('SEJ-002 inactive axes are visible but excluded from reachable fan-in', () => {
  const result = evaluateSeniorJudgment(createInput({
    axes: [
      hypothesisAxis({ axisId: 'data_state', activation: 'active', evidence: [{
        id: 'ev-refute',
        prediction_id: 'p-1',
        relation: 'refutes',
        source_ref: 'test/current.test.js',
        freshness: 'current',
        summary: 'The predicted effect does not occur'
      }] }),
      hypothesisAxis({
        axisId: 'security_boundary',
        activation: 'inactive',
        hypothesisId: 'h-security',
        predictions: [{ id: 'p-security', statement: 'Privileges expand' }]
      })
    ]
  }));

  assert.equal(result.recommendation, 'proceed');
  assert.deepEqual(result.active_axes, ['data_state']);
  assert.ok(result.inactive_axes.includes('security_boundary'));
  assert.equal(result.inactive_axes.length, STANDARD_JUDGMENT_AXES.length - 1);
  assert.equal(result.nodes.find((node) => node.id === 'hypothesis:h-security:verdict').state, 'not_reached');
  assert.deepEqual(result.unknowns, []);
});

test('SEJ-003 fresh refuting evidence closes a hypothesis branch without residual evidence demands', () => {
  const result = evaluateSeniorJudgment(createInput({
    axes: [hypothesisAxis({
      predictions: [
        { id: 'p-1', statement: 'One predicted effect occurs' },
        { id: 'p-2', statement: 'Another predicted effect occurs' }
      ],
      evidence: [{
        id: 'ev-refute',
        prediction_id: 'p-1',
        relation: 'refutes',
        source_ref: 'runtime/current.log',
        freshness: 'current',
        summary: 'The first discriminating prediction is false'
      }]
    })]
  }));

  assert.equal(result.hypothesis_outcomes[0].outcome, 'hypothesis_refuted');
  assert.deepEqual(result.hypothesis_outcomes[0].missing_predictions, []);
  assert.deepEqual(result.unknowns, []);
  assert.equal(result.recommendation, 'proceed');
});

test('SEJ-003b conflicting current evidence stays inconclusive instead of closing the hypothesis', () => {
  const result = evaluateSeniorJudgment(createInput({
    axes: [hypothesisAxis({
      evidence: [
        {
          id: 'ev-support',
          prediction_id: 'p-1',
          relation: 'supports',
          source_ref: 'test/a.test.js',
          freshness: 'current',
          summary: 'The prediction occurs in one current reproduction'
        },
        {
          id: 'ev-refute',
          prediction_id: 'p-1',
          relation: 'refutes',
          source_ref: 'test/b.test.js',
          freshness: 'current',
          summary: 'The prediction does not occur in another current reproduction'
        }
      ]
    })]
  }));

  assert.equal(result.hypothesis_outcomes[0].outcome, 'inconclusive');
  assert.deepEqual(result.hypothesis_outcomes[0].conflicting_predictions, ['p-1']);
  assert.equal(result.recommendation, 'needs_investigation');
  assert.ok(result.next_actions.some((action) => action.type === 'resolve_conflicting_evidence'));
});

test('SEJ-004 inconclusive evidence routes by materiality, reversibility, and blast radius', async (t) => {
  await t.test('high-impact uncertainty needs investigation', () => {
    const result = evaluateSeniorJudgment(createInput({
      decision_profile: {
        materiality: 'high',
        reversibility: 'costly',
        blast_radius: 'multi_component'
      },
      axes: [hypothesisAxis()]
    }));

    assert.equal(result.analysis_depth, 'deep');
    assert.equal(result.recommendation, 'needs_investigation');
    assert.equal(result.hypothesis_outcomes[0].outcome, 'inconclusive');
  });

  await t.test('local reversible uncertainty is explicit safe-to-defer', () => {
    const result = evaluateSeniorJudgment(createInput({
      decision_profile: {
        materiality: 'low',
        reversibility: 'easy',
        blast_radius: 'local'
      },
      axes: [hypothesisAxis()]
    }));

    assert.equal(result.analysis_depth, 'light');
    assert.equal(result.recommendation, 'proceed_with_followup');
    assert.equal(result.hypothesis_outcomes[0].outcome, 'safe_to_defer');
    assert.ok(result.next_actions.some((action) => action.hypothesis_id === 'h-1'));
  });
});

test('SEJ-004b fan-in preserves inconclusive work when another hypothesis is confirmed', () => {
  const result = evaluateSeniorJudgment(createInput({
    axes: [{
      id: 'data_state',
      activation: 'active',
      activation_reason: 'The change reaches persisted state',
      hypotheses: [
        {
          id: 'h-confirmed',
          claim: 'One risk is present',
          predictions: [{ id: 'p-confirmed', statement: 'The confirmed effect occurs' }],
          evidence: [{
            id: 'ev-confirmed',
            prediction_id: 'p-confirmed',
            relation: 'supports',
            source_ref: 'test/confirmed.test.js',
            freshness: 'current',
            summary: 'The effect occurs'
          }]
        },
        {
          id: 'h-unknown',
          claim: 'Another risk may be present',
          predictions: [{ id: 'p-unknown', statement: 'The unknown effect occurs' }],
          evidence: []
        }
      ]
    }]
  }));

  assert.equal(result.recommendation, 'needs_investigation');
  assert.equal(result.nodes.find((node) => node.id === 'axis:data_state:fan_in').state, 'inconclusive');
  assert.equal(result.nodes.find((node) => node.id === 'active_branch_fan_in').state, 'inconclusive');
});

test('SEJ-005/006 invariant pruning affects advice and graph validation rejects cycles', () => {
  const result = evaluateSeniorJudgment(createInput({
    axes: [hypothesisAxis({ evidence: [{
      id: 'ev-support',
      prediction_id: 'p-1',
      relation: 'supports',
      source_ref: 'test/current.test.js',
      freshness: 'current',
      summary: 'The discriminating prediction occurs'
    }] })],
    constraints: [{ id: 'inv-no-loss', kind: 'invariant', statement: 'Existing data must not be lost' }],
    options: [{
      id: 'unsafe-option',
      summary: 'Drop and recreate the data',
      action: 'redesign',
      addresses: ['h-1'],
      violates: ['inv-no-loss'],
      residual_risk: 'high'
    }]
  }));

  assert.equal(result.recommendation, 'do_not_proceed');
  assert.deepEqual(result.viable_options, []);
  assert.equal(result.pruned_options[0].id, 'unsafe-option');
  const unknownResidual = evaluateSeniorJudgment(createInput({
    axes: [hypothesisAxis({ evidence: [{
      id: 'ev-support',
      prediction_id: 'p-1',
      relation: 'supports',
      source_ref: 'test/current.test.js',
      freshness: 'current',
      summary: 'The discriminating prediction occurs'
    }] })],
    options: [{
      id: 'unmeasured-option',
      summary: 'Apply a mitigation whose residual risk has not been measured',
      action: 'fix',
      addresses: ['h-1'],
      violates: [],
      residual_risk: 'unknown'
    }]
  }));
  assert.equal(unknownResidual.recommendation, 'needs_investigation');
  assert.throws(() => validateJudgmentGraph({
    nodes: [{ id: 'a' }, { id: 'b' }],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' }
    ]
  }), /cycle/i);
  assert.throws(() => validateSeniorJudgmentInput({
    ...createInput(),
    axes: []
  }), /missing standard judgment axes/i);
  assert.throws(() => validateSeniorJudgmentInput(createInput({
    development_cycle: {
      ...createInput().development_cycle,
      adopted_batches: [{
        id: 'stale-boundary-batch',
        story_ids: ['story-improved'],
        change_kind: 'external_value',
        structural_effect: 'neutral',
        external_outcome: 'improved',
        source_refs: ['analytics/improved']
      }]
    }
  })), /history boundary.*improved/i);
});
