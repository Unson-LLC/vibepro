import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPERT_DECISION_PATHS,
  EXPERT_DETAIL_KINDS,
  evaluateDecisionPaths,
  validateDecisionPaths
} from '../src/expert-judgment-steps.js';
import {
  EXPERT_JUDGMENT_DAG,
  renderExpertJudgmentSummary,
  suggestExpertJudgments
} from '../src/expert-judgment.js';

const SOURCE = 'evidence/current-run.json';
const OMIT = Symbol('omit decision_paths');

function observation(id, kind, value, sourceRefs = [SOURCE]) {
  return { id, kind, value, source_refs: sourceRefs };
}

// The old observations deliberately remain the only default context. A 0.1 input
// must not become an implicit request to assess every new detailed path.
const CONTEXT = {
  delivery_outcome_defined: true,
  necessary_for_committed_job: true,
  required_protection: false,
  owner_value_choice_required: false,
  existing_authority_covers_action: true,
  change_scope_known: true,
  shared_contract_change: false,
  information_boundary_crossed: false,
  recipient_scope_authorized: false,
  execution_topology_known: true,
  dependency_available: true,
  fallback_preserves_contract: false,
  production_data_isolated: true,
  independently_required_check: false
};

function input(observations = [], decisionPaths = OMIT) {
  const result = {
    schema_version: '0.1.0',
    case_id: 'case-expert-steps',
    observations: [
      ...Object.entries(CONTEXT)
        .filter(([kind]) => !observations.some((item) => item.kind === kind))
        .map(([kind, value]) => observation(`context-${kind}`, kind, value)),
      ...observations
    ]
  };
  if (decisionPaths !== OMIT) result.decision_paths = decisionPaths;
  return result;
}

function node(result, id) {
  const candidate = result.nodes.find((item) => item.node_id === id);
  assert.ok(candidate, `node ${id} is present`);
  return candidate;
}

function entries(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function pathId(value) {
  if (typeof value === 'string') return value;
  return value?.path_id ?? value?.id;
}

function pathIds(value) {
  return entries(value).map(pathId).filter(Boolean);
}

function detailPath(result, nodeId, pathIdToFind) {
  const found = entries(node(result, nodeId).detail_paths)
    .find((item) => pathId(item) === pathIdToFind);
  assert.ok(found, `detail path ${pathIdToFind} is present on ${nodeId}`);
  return found;
}

function detailStep(path, stepId) {
  const found = entries(path.steps)
    .find((item) => (item.step_id ?? item.id) === stepId);
  assert.ok(found, `detail step ${stepId} is present on ${path.path_id}`);
  return found;
}

function priorityStepIds(candidate) {
  const checks = candidate.nodes
    ? candidate.priority_checks
    : entries(candidate.detail_paths).flatMap((path) => entries(path.next_checks));
  return entries(checks)
    .map((item) => item.step_id ?? item.id ?? item.kind)
    .filter(Boolean);
}

function allDetailPathIds(result) {
  return result.nodes.flatMap((candidate) => pathIds(candidate.detail_paths));
}

test('the five routes expose the new boolean kinds and reject an invalid route', () => {
  assert.deepEqual(EXPERT_DECISION_PATHS.map((path) => path.id), [
    'target-alignment',
    'existing-mechanism',
    'recurrence-prevention',
    'interaction-contract',
    'responsibility-handoff'
  ]);
  assert.deepEqual(EXPERT_DETAIL_KINDS, [
    'same_product_and_scope',
    'same_entry_and_state',
    'same_actor_and_job',
    'existing_mechanism_present',
    'existing_mechanism_contract_compatible',
    'reuse_reduces_independent_state',
    'current_state_restored',
    'state_origin_identified',
    'recurrence_path_controlled',
    'primary_user_job_known',
    'defaults_match_primary_job',
    'conditional_inputs_match_mode',
    'reset_preserves_input_contract',
    'decision_responsibilities_known',
    'invocation_preserves_selected_operation',
    'proposal_distinct_from_commit'
  ]);
  assert.deepEqual(validateDecisionPaths(undefined), []);
  assert.deepEqual(validateDecisionPaths(['target-alignment']), ['target-alignment']);
  assert.throws(
    () => validateDecisionPaths(['target-alignment', 'target-alignment']),
    /decision_paths|判断経路/
  );
  assert.throws(
    () => suggestExpertJudgments(input([], ['route-that-does-not-exist'])),
    /decision_paths|判断経路/
  );
});

test('selected routes preserve the eight-node, ten-edge advisory DAG and unselected routes stay unassessed', () => {
  const result = suggestExpertJudgments(input([], EXPERT_DECISION_PATHS.map((path) => path.id)));

  assert.equal(result.schema_version, '0.3.0');
  assert.equal(result.input_schema_version, '0.1.0');
  assert.equal(result.rule_version, '3');
  assert.equal(result.nodes.length, 8);
  assert.equal(result.dag.edges.length, 10);
  assert.deepEqual(result.dag, EXPERT_JUDGMENT_DAG);
  assert.equal(result.advisory, true);
  assert.equal(result.blocking, false);
  assert.ok(Array.isArray(result.priority_checks));

  for (const candidate of result.nodes) {
    assert.ok(Array.isArray(candidate.detail_paths));
    assert.ok(Array.isArray(candidate.next_checks));
    assert.ok(Array.isArray(candidate.not_assessed_paths));
    assert.equal(candidate.advisory, true);
    assert.equal(candidate.blocking, false);
    for (const path of candidate.detail_paths) {
      assert.equal(path.advisory, true);
      assert.equal(path.blocking, false);
      assert.equal(path.interpretation_status, 'candidate');
    }
  }

  const oldInput = suggestExpertJudgments(input());
  assert.equal(allDetailPathIds(oldInput).length, 0);
  assert.deepEqual(
    new Set(oldInput.nodes.flatMap((candidate) => pathIds(candidate.not_assessed_paths))),
    new Set(EXPERT_DECISION_PATHS.map((path) => path.id))
  );
  assert.ok(oldInput.nodes.every((candidate) =>
    candidate.unknowns.every((kind) => !EXPERT_DETAIL_KINDS.includes(kind))
  ));
});

test('a target mismatch defers dependent checks and propagates to downstream nodes, then advances after an update', () => {
  const mismatch = suggestExpertJudgments(input([
    observation('wrong-product', 'same_product_and_scope', false)
  ], ['target-alignment']));
  const firstPath = detailPath(mismatch, 'outcome-scope', 'target-alignment');

  assert.equal(firstPath.status, 'action_required');
  assert.equal(detailStep(firstPath, 'product-scope').status, 'action_required');
  assert.equal(detailStep(firstPath, 'product-scope').value, false);
  assert.equal(detailStep(firstPath, 'entry-state').status, 'deferred');
  assert.equal(detailStep(firstPath, 'actor-job').status, 'deferred');
  assert.ok(priorityStepIds(mismatch).some((id) => id.includes('product-scope')));
  assert.ok(priorityStepIds(node(mismatch, 'outcome-scope')).some((id) => id.includes('product-scope')));
  assert.ok(node(mismatch, 'decision-authority').upstream_unknowns
    .some((item) => item.node_id === 'outcome-scope'));

  const revised = suggestExpertJudgments(input([
    observation('same-product', 'same_product_and_scope', true),
    observation('same-entry', 'same_entry_and_state', true),
    observation('different-job', 'same_actor_and_job', false)
  ], ['target-alignment']));
  const revisedPath = detailPath(revised, 'outcome-scope', 'target-alignment');

  assert.equal(detailStep(revisedPath, 'product-scope').status, 'supported');
  assert.equal(detailStep(revisedPath, 'entry-state').status, 'supported');
  assert.equal(detailStep(revisedPath, 'actor-job').status, 'action_required');
  assert.ok(priorityStepIds(revised).some((id) => id.includes('actor-job')));
  assert.ok(priorityStepIds(node(revised, 'outcome-scope')).some((id) => id.includes('actor-job')));
  assert.notDeepEqual(
    firstPath.steps.map((step) => step.status),
    revisedPath.steps.map((step) => step.status)
  );
});

test('existing-mechanism absence is an evidenced alternative, while missing evidence is unknown and contract mismatch never forces reuse', () => {
  const absent = suggestExpertJudgments(input([
    observation('no-existing-path', 'existing_mechanism_present', false)
  ], ['existing-mechanism']));
  const absentPath = detailPath(absent, 'structural-simplification', 'existing-mechanism');
  assert.equal(detailStep(absentPath, 'existing-path').status, 'alternative');
  assert.equal(detailStep(absentPath, 'existing-path').value, false);
  assert.equal(detailStep(absentPath, 'contract-fit').status, 'deferred');
  assert.equal(detailStep(absentPath, 'state-reduction').status, 'deferred');
  assert.deepEqual(absentPath.unknowns, []);
  assert.deepEqual(priorityStepIds(node(absent, 'structural-simplification')), []);

  const incompatible = suggestExpertJudgments(input([
    observation('has-existing-path', 'existing_mechanism_present', true),
    observation('contract-does-not-fit', 'existing_mechanism_contract_compatible', false)
  ], ['existing-mechanism']));
  const incompatiblePath = detailPath(incompatible, 'structural-simplification', 'existing-mechanism');
  assert.equal(detailStep(incompatiblePath, 'existing-path').status, 'supported');
  assert.equal(detailStep(incompatiblePath, 'contract-fit').status, 'alternative');
  assert.equal(detailStep(incompatiblePath, 'state-reduction').status, 'deferred');
  assert.deepEqual(incompatiblePath.unknowns, []);
  assert.deepEqual(priorityStepIds(node(incompatible, 'structural-simplification')), []);

  const unknown = suggestExpertJudgments(input([
    observation('existing-path-unverified', 'existing_mechanism_present', false, [])
  ], ['existing-mechanism']));
  const unknownPath = detailPath(unknown, 'structural-simplification', 'existing-mechanism');
  assert.equal(unknownPath.status, 'insufficient');
  assert.equal(detailStep(unknownPath, 'existing-path').status, 'unknown');
  assert.equal(detailStep(unknownPath, 'existing-path').value, null);
  assert.equal(detailStep(unknownPath, 'contract-fit').status, 'deferred');
  assert.deepEqual(unknownPath.unknowns, ['existing_mechanism_present']);
  assert.ok(priorityStepIds(node(unknown, 'structural-simplification'))
    .some((id) => id.includes('existing-path')));
});

test('a repaired current state does not imply recurrence prevention; updates move from origin to re-entry', () => {
  const repairedOnly = suggestExpertJudgments(input([
    observation('state-restored', 'current_state_restored', true)
  ], ['recurrence-prevention']));
  const firstPath = detailPath(repairedOnly, 'runtime-reachability', 'recurrence-prevention');
  assert.equal(detailStep(firstPath, 'current-state').status, 'supported');
  assert.equal(detailStep(firstPath, 'state-origin').status, 'unknown');
  assert.equal(detailStep(firstPath, 'reentry').status, 'deferred');
  assert.equal(firstPath.status, 'insufficient');
  assert.deepEqual(firstPath.unknowns, ['state_origin_identified']);
  assert.ok(priorityStepIds(node(repairedOnly, 'runtime-reachability')).some((id) => id.includes('state-origin')));

  const causeKnown = suggestExpertJudgments(input([
    observation('state-restored', 'current_state_restored', true),
    observation('origin-known', 'state_origin_identified', true),
    observation('reentry-uncontrolled', 'recurrence_path_controlled', false)
  ], ['recurrence-prevention']));
  const secondPath = detailPath(causeKnown, 'runtime-reachability', 'recurrence-prevention');
  assert.equal(detailStep(secondPath, 'current-state').status, 'supported');
  assert.equal(detailStep(secondPath, 'state-origin').status, 'supported');
  assert.equal(detailStep(secondPath, 'reentry').status, 'action_required');
  assert.equal(secondPath.status, 'action_required');
  assert.ok(priorityStepIds(node(causeKnown, 'runtime-reachability')).some((id) => id.includes('reentry')));

  const controlled = suggestExpertJudgments(input([
    observation('state-restored', 'current_state_restored', true),
    observation('origin-known', 'state_origin_identified', true),
    observation('reentry-controlled', 'recurrence_path_controlled', true)
  ], ['recurrence-prevention']));
  const finalPath = detailPath(controlled, 'runtime-reachability', 'recurrence-prevention');
  assert.equal(finalPath.status, 'candidate');
  assert.ok(finalPath.steps.every((step) => step.status === 'supported'));
  assert.deepEqual(priorityStepIds(node(controlled, 'runtime-reachability')), []);
});

test('source_refs without evidence stay unknown even when the boolean value is true', () => {
  const result = suggestExpertJudgments(input([
    observation('restored-without-proof', 'current_state_restored', true, [])
  ], ['recurrence-prevention']));
  const path = detailPath(result, 'runtime-reachability', 'recurrence-prevention');
  assert.equal(path.status, 'insufficient');
  assert.equal(detailStep(path, 'current-state').status, 'unknown');
  assert.equal(detailStep(path, 'current-state').value, null);
  assert.equal(detailStep(path, 'state-origin').status, 'deferred');
  assert.deepEqual(path.unknowns, ['current_state_restored']);
});

test('interaction defaults can defer conditional input checks and each update changes the next check', () => {
  const defaultsWrong = suggestExpertJudgments(input([
    observation('job-known', 'primary_user_job_known', true),
    observation('wrong-defaults', 'defaults_match_primary_job', false),
    observation('conditional-unknown-yet', 'conditional_inputs_match_mode', true),
    observation('reset-contract', 'reset_preserves_input_contract', true)
  ], ['interaction-contract']));
  const firstPath = detailPath(defaultsWrong, 'outcome-scope', 'interaction-contract');
  assert.equal(detailStep(firstPath, 'primary-job').status, 'supported');
  assert.equal(detailStep(firstPath, 'defaults').status, 'action_required');
  assert.equal(detailStep(firstPath, 'conditional-input').status, 'deferred');
  assert.equal(detailStep(firstPath, 'reset-transition').status, 'deferred');
  assert.ok(priorityStepIds(node(defaultsWrong, 'outcome-scope')).some((id) => id.includes('defaults')));

  const conditionalWrong = suggestExpertJudgments(input([
    observation('job-known', 'primary_user_job_known', true),
    observation('defaults-fit', 'defaults_match_primary_job', true),
    observation('conditional-does-not-fit', 'conditional_inputs_match_mode', false),
    observation('reset-contract', 'reset_preserves_input_contract', true)
  ], ['interaction-contract']));
  const secondPath = detailPath(conditionalWrong, 'outcome-scope', 'interaction-contract');
  assert.equal(detailStep(secondPath, 'defaults').status, 'supported');
  assert.equal(detailStep(secondPath, 'conditional-input').status, 'action_required');
  assert.equal(detailStep(secondPath, 'reset-transition').status, 'deferred');
  assert.ok(priorityStepIds(node(conditionalWrong, 'outcome-scope')).some((id) => id.includes('conditional-input')));

  const resetWrong = suggestExpertJudgments(input([
    observation('job-known', 'primary_user_job_known', true),
    observation('defaults-fit', 'defaults_match_primary_job', true),
    observation('conditional-fits', 'conditional_inputs_match_mode', true),
    observation('reset-breaks-contract', 'reset_preserves_input_contract', false)
  ], ['interaction-contract']));
  const thirdPath = detailPath(resetWrong, 'outcome-scope', 'interaction-contract');
  assert.equal(detailStep(thirdPath, 'conditional-input').status, 'supported');
  assert.equal(detailStep(thirdPath, 'reset-transition').status, 'action_required');
  assert.ok(priorityStepIds(node(resetWrong, 'outcome-scope')).some((id) => id.includes('reset-transition')));

  const valid = suggestExpertJudgments(input([
    observation('job-known', 'primary_user_job_known', true),
    observation('defaults-fit', 'defaults_match_primary_job', true),
    observation('conditional-fits', 'conditional_inputs_match_mode', true),
    observation('reset-contract', 'reset_preserves_input_contract', true)
  ], ['interaction-contract']));
  const finalPath = detailPath(valid, 'outcome-scope', 'interaction-contract');
  assert.equal(finalPath.status, 'candidate');
  assert.ok(finalPath.steps.every((step) => step.status === 'supported'));
  assert.deepEqual(priorityStepIds(node(valid, 'outcome-scope')), []);
  assert.match(renderExpertJudgmentSummary(valid), /自動採用は行いません/);
});

test('responsibility handoff advances from unknown to invocation and proposal checks without forcing physical separation', () => {
  const responsibilityUnknown = suggestExpertJudgments(input([], ['responsibility-handoff']));
  const unknownPath = detailPath(responsibilityUnknown, 'execution-boundary', 'responsibility-handoff');
  assert.equal(unknownPath.status, 'insufficient');
  assert.equal(detailStep(unknownPath, 'responsibility-map').status, 'unknown');
  assert.equal(detailStep(unknownPath, 'responsibility-map').value, null);
  assert.equal(detailStep(unknownPath, 'invocation-contract').status, 'deferred');
  assert.equal(detailStep(unknownPath, 'proposal-commit').status, 'deferred');
  assert.ok(priorityStepIds(responsibilityUnknown).some((id) => id.includes('responsibility-map')));
  assert.ok(priorityStepIds(node(responsibilityUnknown, 'execution-boundary'))
    .some((id) => id.includes('responsibility-map')));

  const invocationMismatch = suggestExpertJudgments(input([
    observation('responsibilities-known', 'decision_responsibilities_known', true),
    observation('invocation-reselects', 'invocation_preserves_selected_operation', false)
  ], ['responsibility-handoff']));
  const invocationPath = detailPath(invocationMismatch, 'execution-boundary', 'responsibility-handoff');
  assert.equal(detailStep(invocationPath, 'responsibility-map').status, 'supported');
  assert.equal(detailStep(invocationPath, 'invocation-contract').status, 'action_required');
  assert.equal(detailStep(invocationPath, 'proposal-commit').status, 'deferred');
  assert.equal(invocationPath.status, 'action_required');
  assert.ok(priorityStepIds(invocationMismatch).some((id) => id.includes('invocation-contract')));
  assert.ok(priorityStepIds(node(invocationMismatch, 'execution-boundary'))
    .some((id) => id.includes('invocation-contract')));

  const proposalMismatch = suggestExpertJudgments(input([
    observation('responsibilities-known', 'decision_responsibilities_known', true),
    observation('invocation-keeps-selection', 'invocation_preserves_selected_operation', true),
    observation('proposal-commits', 'proposal_distinct_from_commit', false)
  ], ['responsibility-handoff']));
  const proposalPath = detailPath(proposalMismatch, 'execution-boundary', 'responsibility-handoff');
  assert.equal(detailStep(proposalPath, 'responsibility-map').status, 'supported');
  assert.equal(detailStep(proposalPath, 'invocation-contract').status, 'supported');
  assert.equal(detailStep(proposalPath, 'proposal-commit').status, 'action_required');
  assert.equal(proposalPath.status, 'action_required');
  assert.ok(priorityStepIds(proposalMismatch).some((id) => id.includes('proposal-commit')));
  assert.ok(priorityStepIds(node(proposalMismatch, 'execution-boundary'))
    .some((id) => id.includes('proposal-commit')));

  const allResponsibilitiesKnown = suggestExpertJudgments(input([
    observation('responsibilities-known', 'decision_responsibilities_known', true),
    observation('invocation-keeps-selection', 'invocation_preserves_selected_operation', true),
    observation('proposal-stays-distinct', 'proposal_distinct_from_commit', true)
  ], ['responsibility-handoff']));
  const finalPath = detailPath(allResponsibilitiesKnown, 'execution-boundary', 'responsibility-handoff');
  assert.equal(finalPath.status, 'candidate');
  assert.ok(finalPath.steps.every((step) => step.status === 'supported'));
  assert.deepEqual(finalPath.next_checks, []);
  assert.deepEqual(priorityStepIds(allResponsibilitiesKnown), []);
  assert.deepEqual(priorityStepIds(node(allResponsibilitiesKnown, 'execution-boundary')), []);
  assert.match(finalPath.counterexample, /物理的な分割は必須ではない/);
  assert.equal(finalPath.advisory, true);
  assert.equal(finalPath.blocking, false);
  assert.equal(node(allResponsibilitiesKnown, 'execution-boundary').advisory, true);
  assert.equal(node(allResponsibilitiesKnown, 'execution-boundary').blocking, false);
  assert.equal(allResponsibilitiesKnown.advisory, true);
  assert.equal(allResponsibilitiesKnown.blocking, false);

  assert.notDeepEqual(
    unknownPath.steps.map((step) => step.status),
    invocationPath.steps.map((step) => step.status)
  );
  assert.notDeepEqual(
    invocationPath.steps.map((step) => step.status),
    proposalPath.steps.map((step) => step.status)
  );
  assert.notDeepEqual(
    proposalPath.steps.map((step) => step.status),
    finalPath.steps.map((step) => step.status)
  );
});

test('direct path evaluation keeps alternatives, unknowns, and deferred steps distinct', () => {
  const byKind = new Map([
    ['existing_mechanism_present', observation('existing', 'existing_mechanism_present', false)],
    ['existing_mechanism_contract_compatible', observation('contract', 'existing_mechanism_contract_compatible', true)]
  ]);
  const [path] = evaluateDecisionPaths(['existing-mechanism'], byKind);
  assert.equal(path.status, 'candidate');
  assert.equal(path.steps[0].status, 'alternative');
  assert.equal(path.steps[0].value, false);
  assert.equal(path.steps[1].status, 'deferred');
  assert.deepEqual(path.unknowns, []);
  assert.deepEqual(path.next_checks, []);
});


test('a detailed mismatch replaces broad delivery options without losing the broad assessment', () => {
  const result = suggestExpertJudgments(input([
    observation('wrong-target', 'same_product_and_scope', false)
  ], ['target-alignment']));
  const outcome = node(result, 'outcome-scope');
  assert.ok(outcome.base_assessment.options.some((item) => item.id === 'deliver-minimum-outcome'));
  assert.ok(!outcome.options.some((item) => item.id === 'deliver-minimum-outcome'));
  assert.match(outcome.finding, /未確認または未成立/);
  assert.equal(outcome.adoption_status, 'conditional');
});

test('a detailed candidate remains reviewable when the broad runtime concern does not apply', () => {
  const result = suggestExpertJudgments(input([
    observation('no-capability-claim', 'capability_claimed', false),
    observation('implemented', 'implementation_present', true),
    observation('path-observed', 'intended_path_observed', true),
    observation('restored', 'current_state_restored', true),
    observation('origin-known', 'state_origin_identified', true),
    observation('recurrence-controlled', 'recurrence_path_controlled', true)
  ], ['recurrence-prevention']));
  const runtime = node(result, 'runtime-reachability');
  assert.equal(runtime.base_assessment.status, 'not_applicable');
  assert.equal(runtime.status, 'proposed');
  assert.ok(runtime.options.some((item) => item.id === 'detail:recurrence-prevention'));
});
