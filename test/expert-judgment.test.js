import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXPERT_JUDGMENT_CATALOG,
  EXPERT_JUDGMENT_DAG,
  renderExpertJudgmentSummary,
  suggestExpertJudgments
} from '../src/expert-judgment.js';
import { runCli } from '../src/cli.js';

const SOURCE = 'evidence/current-run.json';

function observation(id, kind, value, sourceRefs = [SOURCE]) {
  return { id, kind, value, source_refs: sourceRefs };
}

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

function input(observations) {
  return {
    schema_version: '0.1.0',
    case_id: 'case-expert-nodes',
    observations: [
      ...Object.entries(CONTEXT)
        .filter(([kind]) => !observations.some((item) => item.kind === kind))
        .map(([kind, value]) => observation(`context-${kind}`, kind, value)),
      ...observations
    ]
  };
}

function node(result, id) {
  return result.nodes.find((candidate) => candidate.node_id === id);
}

function optionIds(result, id) {
  return node(result, id).options.map((candidate) => candidate.id);
}

function resolvedCase(overrides = []) {
  return input([
    observation('s-no-repeat', 'repeated_local_fixes', false),
    observation('r-path', 'intended_path_observed', true),
    observation('e-repeat', 'verification_repeating', true),
    observation('e-material', 'material_unknown_open', false),
    observation('e-change', 'next_check_changes_decision', false),
    ...overrides
  ]);
}

test('delivery scope defers expansion while preserving required protection', () => {
  const expansion = suggestExpertJudgments(input([
    observation('not-needed', 'necessary_for_committed_job', false)
  ]));
  assert.ok(optionIds(expansion, 'outcome-scope').includes('defer-expansion'));

  const protection = suggestExpertJudgments(input([
    observation('not-needed', 'necessary_for_committed_job', false),
    observation('protection', 'required_protection', true)
  ]));
  assert.ok(optionIds(protection, 'outcome-scope').includes('preserve-required-protection'));
  assert.ok(!optionIds(protection, 'outcome-scope').includes('defer-expansion'));

  const unknown = suggestExpertJudgments(input([
    observation('protection-unknown', 'required_protection', false, [])
  ]));
  assert.equal(node(unknown, 'outcome-scope').status, 'insufficient');
  assert.ok(!optionIds(unknown, 'outcome-scope').includes('defer-expansion'));

  for (const sourceRefs of [[SOURCE], []]) {
    const undefinedOutcome = suggestExpertJudgments(resolvedCase([
      observation('protection', 'required_protection', true),
      observation('undefined-outcome', 'delivery_outcome_defined', false, sourceRefs)
    ]));
    assert.ok(optionIds(undefinedOutcome, 'outcome-scope').includes('preserve-required-protection'));
    assert.equal(node(undefinedOutcome, 'change-ownership').context_status, 'unresolved');
    assert.ok(!optionIds(undefinedOutcome, 'evidence-decision-value').includes('finish-and-move-on'));
  }
  const deferred = suggestExpertJudgments(resolvedCase([
    observation('not-needed', 'necessary_for_committed_job', false)
  ]));
  assert.equal(node(deferred, 'change-ownership').context_status, 'unresolved');
});

test('existing intent permits derived work while new owner choices remain pending downstream', () => {
  const derived = suggestExpertJudgments(resolvedCase());
  assert.ok(optionIds(derived, 'decision-authority').includes('derive-and-proceed'));
  const choice = suggestExpertJudgments(resolvedCase([
    observation('choice', 'owner_value_choice_required', true)
  ]));
  assert.ok(optionIds(choice, 'decision-authority').includes('ask-owner-choice'));
  assert.equal(node(choice, 'runtime-reachability').context_status, 'unresolved');
  assert.ok(node(choice, 'runtime-reachability').upstream_unknowns.some((item) => item.node_id === 'decision-authority'));
  assert.ok(!optionIds(choice, 'evidence-decision-value').includes('finish-and-move-on'));

  const authority = suggestExpertJudgments(input([
    observation('no-authority', 'existing_authority_covers_action', false)
  ]));
  assert.ok(optionIds(authority, 'decision-authority').includes('resolve-action-authority'));
  assert.ok(!optionIds(authority, 'decision-authority').includes('derive-and-proceed'));
});

test('change ownership follows applicability and shared contracts', () => {
  const local = suggestExpertJudgments(input([]));
  assert.ok(optionIds(local, 'change-ownership').includes('keep-local-change'));
  const shared = suggestExpertJudgments(input([
    observation('shared', 'shared_contract_change', true)
  ]));
  assert.ok(optionIds(shared, 'change-ownership').includes('compare-shared-placement'));
  const unknownOwner = suggestExpertJudgments(resolvedCase([
    observation('scope', 'change_scope_known', false)
  ]));
  assert.ok(optionIds(unknownOwner, 'change-ownership').includes('locate-change-owner'));
  assert.equal(node(unknownOwner, 'structural-simplification').context_status, 'unresolved');
});

test('information sharing is scoped to the data and recipient, not a universal cross-boundary ban', () => {
  const denied = suggestExpertJudgments(input([
    observation('crossed', 'information_boundary_crossed', true)
  ]));
  assert.ok(optionIds(denied, 'information-boundary').includes('keep-with-owner'));
  const authorized = suggestExpertJudgments(input([
    observation('crossed', 'information_boundary_crossed', true),
    observation('recipient', 'recipient_scope_authorized', true)
  ]));
  assert.ok(optionIds(authorized, 'information-boundary').includes('minimize-shared-data'));
  const unverified = suggestExpertJudgments(input([
    observation('crossed', 'information_boundary_crossed', true),
    observation('recipient', 'recipient_scope_authorized', true, [])
  ]));
  assert.equal(node(unverified, 'information-boundary').status, 'insufficient');
  assert.equal(unverified.blocking, false);
});

test('missing execution dependency compares a contract-preserving fallback and keeps production separation explicit', () => {
  const fallback = suggestExpertJudgments(input([
    observation('dep', 'dependency_available', false),
    observation('fallback', 'fallback_preserves_contract', true)
  ]));
  assert.ok(optionIds(fallback, 'execution-boundary').includes('compare-fallback-path'));
  const unavailable = suggestExpertJudgments(input([
    observation('dep', 'dependency_available', false)
  ]));
  assert.ok(optionIds(unavailable, 'execution-boundary').includes('remove-or-replace-dependency'));
  const unknown = suggestExpertJudgments(input([
    observation('dep', 'dependency_available', false),
    observation('fallback', 'fallback_preserves_contract', true, [])
  ]));
  assert.equal(node(unknown, 'execution-boundary').status, 'insufficient');
  const production = suggestExpertJudgments(input([
    observation('production', 'production_data_isolated', false)
  ]));
  assert.ok(optionIds(production, 'execution-boundary').includes('separate-production-data'));
});

test('mandatory checks survive a low decision-value observation; missing requirement is not false', () => {
  const mandatory = suggestExpertJudgments(resolvedCase([
    observation('mandatory', 'independently_required_check', true)
  ]));
  assert.ok(optionIds(mandatory, 'evidence-decision-value').includes('required-check'));
  assert.ok(!optionIds(mandatory, 'evidence-decision-value').includes('finish-and-move-on'));
  const unknown = suggestExpertJudgments(resolvedCase([
    observation('unknown-requirement', 'independently_required_check', false, [])
  ]));
  assert.equal(node(unknown, 'evidence-decision-value').status, 'insufficient');
});

test('DAG edges are acyclic and propagate only dependent unresolved work', () => {
  const result = suggestExpertJudgments(resolvedCase([
    observation('auth-unknown', 'existing_authority_covers_action', true, [])
  ]));
  const order = result.nodes.map((item) => item.node_id);
  assert.deepEqual(result.dag, EXPERT_JUDGMENT_DAG);
  assert.ok(result.dag.edges.length >= 8);
  for (const edge of result.dag.edges) {
    assert.ok(order.indexOf(edge.from) >= 0);
    assert.ok(order.indexOf(edge.from) < order.indexOf(edge.to));
    assert.ok(node(result, edge.to).depends_on.includes(edge.from));
    assert.ok(edge.reason);
  }
  assert.equal(node(result, 'change-ownership').context_status, 'available');
  assert.equal(node(result, 'information-boundary').context_status, 'unresolved');
  assert.equal(node(result, 'runtime-reachability').context_status, 'unresolved');
  assert.ok(optionIds(result, 'evidence-decision-value').includes('resolve-upstream-unknowns'));
  assert.ok(optionIds(result, 'evidence-decision-value').includes('continue-unblocked-work'));
  assert.ok(!optionIds(result, 'evidence-decision-value').includes('finish-and-move-on'));
  assert.equal(node(result, 'evidence-decision-value').adoption_status, 'conditional');

  const revised = suggestExpertJudgments(resolvedCase());
  assert.equal(node(revised, 'runtime-reachability').context_status, 'available');
  assert.ok(optionIds(revised, 'evidence-decision-value').includes('finish-and-move-on'));
});

test('empty inputs stay insufficient and duplicate source observation identities are rejected', () => {
  const empty = suggestExpertJudgments({ schema_version: '0.1.0', case_id: 'empty', observations: [] });
  assert.ok(empty.nodes.every((item) => item.status === 'insufficient'));
  assert.throws(() => suggestExpertJudgments(input([
    observation('same', 'repeated_local_fixes', true),
    observation('same', 'complexity_growing', true)
  ])), /id.*重複|重複.*id/);
  const rendered = renderExpertJudgmentSummary(empty);
  assert.match(rendered, /前段|前提|条件付き|unresolved|conditional/);
  assert.match(rendered, /自動採用は行いません/);
});

test('catalog and fully evidenced observations produce eight advisory nodes', () => {
  const result = suggestExpertJudgments(input([
    observation('s-1', 'repeated_local_fixes', true),
    observation('s-2', 'complexity_growing', true),
    observation('s-3', 'outcome_improving', false),
    observation('s-4', 'urgent_containment', false),
    observation('r-1', 'capability_claimed', true),
    observation('r-2', 'implementation_present', true),
    observation('r-3', 'intended_path_observed', false),
    observation('e-1', 'verification_repeating', true),
    observation('e-2', 'material_unknown_open', false),
    observation('e-3', 'next_check_changes_decision', false)
  ]));

  assert.equal(EXPERT_JUDGMENT_CATALOG.length, 8);
  assert.deepEqual(result.nodes.map((candidate) => candidate.node_id), [
    'outcome-scope',
    'decision-authority',
    'change-ownership',
    'information-boundary',
    'execution-boundary',
    'structural-simplification',
    'runtime-reachability',
    'evidence-decision-value'
  ]);
  assert.equal(result.schema_version, '0.3.0');
  assert.equal(result.input_schema_version, '0.1.0');
  assert.equal(result.advisory, true);
  assert.equal(result.blocking, false);
  assert.equal(result.profile_status, 'candidate');
  assert.match(result.evidence_boundary, /検証しません/);

  for (const candidate of result.nodes) {
    assert.equal(candidate.interpretation_status, 'candidate');
    assert.equal(candidate.rule_version, '3');
    assert.match(candidate.provenance_ref, /^curation:[\w-]+@3$/);
    assert.equal(candidate.advisory, true);
    assert.equal(candidate.blocking, false);
    assert.ok(candidate.causal_model);
    assert.ok(candidate.hypotheses[0].prediction);
    assert.ok(candidate.hypotheses[0].counterexample);
    if (candidate.status === 'proposed') {
      assert.ok(candidate.options.length >= 1);
      assert.ok(candidate.next_checks.length >= 1);
    }
  }

  assert.equal(node(result, 'structural-simplification').status, 'proposed');
  assert.equal(node(result, 'runtime-reachability').status, 'proposed');
  assert.equal(node(result, 'evidence-decision-value').status, 'proposed');
});

test('structural simplification distinguishes urgent containment, false preconditions, and unknown evidence', () => {
  const urgent = suggestExpertJudgments(input([
    observation('s-1', 'repeated_local_fixes', true),
    observation('s-2', 'complexity_growing', true),
    observation('s-3', 'outcome_improving', false),
    observation('s-4', 'urgent_containment', true)
  ]));
  const urgentNode = node(urgent, 'structural-simplification');
  assert.equal(urgentNode.status, 'proposed');
  assert.match(urgentNode.finding, /封じ込め/);
  assert.equal(urgentNode.options[0].id, 'containment-first');
  assert.equal(urgentNode.next_checks[0].kind, 'post-containment-structural-comparison');

  const notApplicable = suggestExpertJudgments(input([
    observation('s-1', 'repeated_local_fixes', true, []),
    observation('s-2', 'complexity_growing', true),
    observation('s-3', 'outcome_improving', true),
    observation('s-4', 'urgent_containment', false)
  ]));
  assert.equal(node(notApplicable, 'structural-simplification').status, 'not_applicable');
  assert.deepEqual(node(notApplicable, 'structural-simplification').unknowns, ['repeated_local_fixes']);
  assert.deepEqual(node(notApplicable, 'structural-simplification').next_checks, []);

  const unknown = suggestExpertJudgments(input([
    observation('s-1', 'repeated_local_fixes', true),
    observation('s-2', 'complexity_growing', true),
    observation('s-3', 'outcome_improving', false),
    observation('s-4', 'urgent_containment', false, [])
  ]));
  const unknownNode = node(unknown, 'structural-simplification');
  assert.equal(unknownNode.status, 'insufficient');
  assert.deepEqual(unknownNode.unknowns, ['urgent_containment']);
  assert.equal(unknownNode.next_checks[0].kind, 'urgent_containment');
});

test('runtime reachability covers an unimplemented capability, an observed path, and missing evidence', () => {
  const unimplemented = suggestExpertJudgments(input([
    observation('r-1', 'capability_claimed', true),
    observation('r-2', 'implementation_present', false),
    observation('r-3', 'intended_path_observed', false)
  ]));
  assert.equal(node(unimplemented, 'runtime-reachability').status, 'proposed');
  assert.equal(node(unimplemented, 'runtime-reachability').options.length, 2);

  const notClaimed = suggestExpertJudgments(input([
    observation('r-1', 'capability_claimed', false),
    observation('r-2', 'implementation_present', false),
    observation('r-3', 'intended_path_observed', false)
  ]));
  assert.equal(node(notClaimed, 'runtime-reachability').status, 'not_applicable');

  const unknownClaim = suggestExpertJudgments(input([
    observation('r-2', 'implementation_present', false),
    observation('r-3', 'intended_path_observed', false)
  ]));
  assert.equal(node(unknownClaim, 'runtime-reachability').status, 'insufficient');
  assert.deepEqual(node(unknownClaim, 'runtime-reachability').unknowns, ['capability_claimed']);

  const contradiction = suggestExpertJudgments(input([
    observation('r-1', 'capability_claimed', true),
    observation('r-2', 'implementation_present', false),
    observation('r-3', 'intended_path_observed', true)
  ]));
  const contradictionNode = node(contradiction, 'runtime-reachability');
  assert.equal(contradictionNode.status, 'insufficient');
  assert.deepEqual(contradictionNode.unknowns, ['runtime-scope-consistency']);
  assert.equal(contradictionNode.next_checks[0].kind, 'runtime-scope-consistency');

  const observed = suggestExpertJudgments(input([
    observation('r-1', 'capability_claimed', true),
    observation('r-2', 'implementation_present', true),
    observation('r-3', 'intended_path_observed', true)
  ]));
  const observedNode = node(observed, 'runtime-reachability');
  assert.equal(observedNode.status, 'not_applicable');
  assert.match(observedNode.finding, /証明しません/);

  const missing = suggestExpertJudgments(input([
    observation('r-1', 'capability_claimed', true),
    observation('r-2', 'implementation_present', true),
    observation('r-3', 'intended_path_observed', false, [])
  ]));
  assert.equal(node(missing, 'runtime-reachability').status, 'insufficient');
  assert.deepEqual(node(missing, 'runtime-reachability').unknowns, ['intended_path_observed']);
});

test('evidence decision value keeps decision-linked checks distinct from repetitive checks', () => {
  const decisionLinked = suggestExpertJudgments(input([
    observation('e-1', 'verification_repeating', false),
    observation('e-2', 'material_unknown_open', true),
    observation('e-3', 'next_check_changes_decision', true)
  ]));
  const decisionNode = node(decisionLinked, 'evidence-decision-value');
  assert.equal(decisionNode.status, 'proposed');
  assert.match(decisionNode.finding, /未解決の判断/);
  assert.equal(decisionNode.options.length, 2);
  assert.equal(decisionNode.next_checks[0].kind, 'hypothesis_check');

  const finish = suggestExpertJudgments(input([
    observation('s-no-repeat', 'repeated_local_fixes', false),
    observation('r-path', 'intended_path_observed', true),
    observation('e-1', 'verification_repeating', true),
    observation('e-2', 'material_unknown_open', false),
    observation('e-3', 'next_check_changes_decision', false)
  ]));
  assert.equal(node(finish, 'evidence-decision-value').next_checks[0].kind, 'reopen-condition');

  const notApplicable = suggestExpertJudgments(input([
    observation('e-1', 'verification_repeating', false),
    observation('e-2', 'material_unknown_open', false),
    observation('e-3', 'next_check_changes_decision', false)
  ]));
  assert.equal(node(notApplicable, 'evidence-decision-value').status, 'not_applicable');

  const unknown = suggestExpertJudgments(input([
    observation('e-1', 'verification_repeating', true),
    observation('e-2', 'material_unknown_open', false),
    observation('e-3', 'next_check_changes_decision', false, [])
  ]));
  assert.equal(node(unknown, 'evidence-decision-value').status, 'insufficient');
  assert.deepEqual(node(unknown, 'evidence-decision-value').unknowns, ['next_check_changes_decision']);
});

test('missing observations and source references remain unknown rather than becoming false', () => {
  const result = suggestExpertJudgments(input([
    observation('s-1', 'repeated_local_fixes', false),
    observation('s-2', 'complexity_growing', true),
    observation('s-3', 'outcome_improving', false),
    observation('s-4', 'urgent_containment', false),
    observation('e-1', 'verification_repeating', false),
    observation('e-2', 'material_unknown_open', false),
    observation('e-3', 'next_check_changes_decision', false)
  ]));
  assert.equal(node(result, 'structural-simplification').status, 'not_applicable');
  assert.equal(node(result, 'runtime-reachability').status, 'insufficient');
  assert.ok(node(result, 'runtime-reachability').unknowns.length > 0);
});

test('invalid observation kind, value, and duplicate kind are rejected', () => {
  assert.throws(
    () => suggestExpertJudgments(input([{ id: 'bad', kind: 'free_text_guess', value: true, source_refs: [SOURCE] }])),
    /kind は定義済み/
  );
  assert.throws(
    () => suggestExpertJudgments(input([{ id: 'bad', value: true, source_refs: [SOURCE] }])),
    /kind は定義済み/
  );
  assert.throws(
    () => suggestExpertJudgments(input([{ id: 'bad', kind: 'repeated_local_fixes', value: 'true', source_refs: [SOURCE] }])),
    /value は true または false/
  );
  assert.throws(
    () => suggestExpertJudgments(input([
      observation('a', 'repeated_local_fixes', true),
      observation('b', 'repeated_local_fixes', false)
    ])),
    /観測の kind が重複/
  );
});

test('judgment suggest CLI reads JSON and reports invalid input without touching the existing judgment flow', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-expert-judgment-'));
  const inputPath = path.join(root, 'expert-input.json');
  await writeFile(inputPath, `${JSON.stringify(input([
    observation('r-1', 'capability_claimed', true),
    observation('r-2', 'implementation_present', true),
    observation('r-3', 'intended_path_observed', false)
  ]), null, 2)}\n`);
  let stdout = '';
  const result = await runCli([
    'judgment', 'suggest', '--input', inputPath, '--json'
  ], { stdout: { write: (value) => { stdout += value; } } });
  assert.equal(result.exitCode, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.case_id, 'case-expert-nodes');
  assert.equal(parsed.nodes.length, 8);
  assert.equal(node(parsed, 'runtime-reachability').status, 'proposed');

  await writeFile(inputPath, '{"schema_version":"0.1.0","case_id":"bad","observations":[{"id":"x","kind":"repeated_local_fixes","value":"true"}]}');
  let stderr = '';
  const invalid = await runCli([
    'judgment', 'suggest', '--input', inputPath, '--json'
  ], { stderr: { write: (value) => { stderr += value; } } });
  assert.equal(invalid.exitCode, 1);
  assert.match(stderr, /value は true または false/);
});
