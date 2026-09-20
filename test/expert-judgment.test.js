import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  EXPERT_JUDGMENT_CATALOG,
  suggestExpertJudgments
} from '../src/expert-judgment.js';
import { runCli } from '../src/cli.js';

const SOURCE = 'evidence/current-run.json';

function observation(id, kind, value, sourceRefs = [SOURCE]) {
  return { id, kind, value, source_refs: sourceRefs };
}

function input(observations) {
  return {
    schema_version: '0.1.0',
    case_id: 'case-expert-nodes',
    observations
  };
}

function node(result, id) {
  return result.nodes.find((candidate) => candidate.node_id === id);
}

test('catalog and fully evidenced observations produce three advisory suggestions', () => {
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

  assert.equal(EXPERT_JUDGMENT_CATALOG.length, 3);
  assert.deepEqual(result.nodes.map((candidate) => candidate.node_id), [
    'structural-simplification',
    'runtime-reachability',
    'evidence-decision-value'
  ]);
  assert.equal(result.schema_version, '0.1.0');
  assert.equal(result.advisory, true);
  assert.equal(result.blocking, false);
  assert.equal(result.profile_status, 'candidate');
  assert.match(result.evidence_boundary, /検証しません/);

  for (const candidate of result.nodes) {
    assert.equal(candidate.interpretation_status, 'candidate');
    assert.equal(candidate.rule_version, '1');
    assert.match(candidate.provenance_ref, /^curation:[\w-]+@1$/);
    assert.equal(candidate.advisory, true);
    assert.equal(candidate.blocking, false);
    assert.ok(candidate.causal_model);
    assert.ok(candidate.hypotheses[0].prediction);
    assert.ok(candidate.hypotheses[0].counterexample);
    assert.equal(candidate.options.length, 2);
    assert.ok(candidate.next_checks.length >= 1);
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
  assert.equal(parsed.nodes.length, 3);
  assert.equal(node(parsed, 'runtime-reachability').status, 'proposed');

  await writeFile(inputPath, '{"schema_version":"0.1.0","case_id":"bad","observations":[{"id":"x","kind":"repeated_local_fixes","value":"true"}]}');
  let stderr = '';
  const invalid = await runCli([
    'judgment', 'suggest', '--input', inputPath, '--json'
  ], { stderr: { write: (value) => { stderr += value; } } });
  assert.equal(invalid.exitCode, 1);
  assert.match(stderr, /value は true または false/);
});
