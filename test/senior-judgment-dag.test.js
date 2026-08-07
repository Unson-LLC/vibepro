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
    schema_version: '0.1.0',
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
});
