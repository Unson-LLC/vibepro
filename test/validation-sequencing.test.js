import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildValidationSequencePlan,
  createValidationSequenceState,
  evaluateExpensiveVerificationReuse,
  evaluateValidationSequence,
  invalidateValidationSequence,
  reconcileValidationSequenceState,
  recordValidationPhase,
  validateValidationPhaseEvidence
} from '../src/validation-sequencing.js';
import { recordImportedCiVerification } from '../src/ci-evidence.js';
import { readValidationSequence, writeValidationSequence } from '../src/validation-sequencing.js';
import { runCli } from '../src/cli.js';

const binding = { headSha: 'abc123', testFingerprint: 'tests-v1', verificationCommand: 'node --test', evidence: '.vibepro/qa/phase.json', evidenceValidation: { status: 'verified' } };
const finalReview = {
  source: 'agent_review',
  evidence: '.vibepro/reviews/final.json',
  reviewProvenance: {
    status: 'pass', story_id: 'story-risk-sequence', head_sha: 'abc123',
    system: 'codex', execution_mode: 'parallel_subagent', evidence_strength: 'strong', agent_closed: true
  }
};

function stateForHighRisk() {
  const plan = buildValidationSequencePlan({
    storyId: 'story-risk-sequence',
    riskProfile: 'workflow_heavy',
    riskSurfaces: ['core_workflow_state', 'auth_boundary']
  });
  return createValidationSequenceState({ plan });
}

test('canonical phase evidence rejects incomplete native records and pre-freeze expensive runs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-validation-evidence-'));
  const storyId = 'story-evidence-contract';
  const evidence = path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json');
  await mkdir(path.dirname(evidence), { recursive: true });
  const required = {
    storyId,
    phase: 'expensive_verification',
    headSha: 'abc123',
    verificationCommand: 'node --test',
    testFingerprint: 'tests-v1',
    notBefore: '2026-01-01T00:00:00.000Z'
  };

  await writeFile(evidence, JSON.stringify({
    schema_version: '0.1.0', story_id: storyId,
    commands: [{ status: 'pass', command: 'node --test', git_context: { head_sha: 'abc123' }, observation: { values: { test_fingerprint: 'tests-v1', validation_phase: 'expensive_verification' } } }]
  }));
  await assert.rejects(
    validateValidationPhaseEvidence(root, path.relative(root, evidence), required),
    /passing canonical evidence/
  );

  await writeFile(evidence, JSON.stringify({
    schema_version: '0.1.0', story_id: storyId,
    commands: [{
      status: 'pass', command: 'node --test', executed_at: '2025-12-31T23:59:59.000Z',
      git_context: { head_sha: 'abc123' }, artifact_check: { status: 'missing' },
      observation_check: { status: 'recorded' },
      content_binding: { schema_version: '0.1.0', recorded_head_sha: 'abc123' },
      observation: { values: { test_fingerprint: 'tests-v1', validation_phase: 'expensive_verification' } }
    }]
  }));
  await assert.rejects(
    validateValidationPhaseEvidence(root, path.relative(root, evidence), required),
    /passing canonical evidence/
  );
});

test('high-risk plan schedules one canonical aggregate boundary preflight before expensive verification', () => {
  const state = stateForHighRisk();
  assert.equal(state.plan.required, true);
  assert.deepEqual(state.plan.preflight_roles, ['architecture_boundary']);
  assert.deepEqual(state.plan.preflight_reviews, [{
    stage: 'architecture_spec', role: 'architecture_boundary',
    surfaces: ['core_workflow_state', 'auth_boundary']
  }]);
  assert.ok(state.plan.phases.indexOf('preflight_review') < state.plan.phases.indexOf('expensive_verification'));
});

test('auth-only plan emits a canonical producible aggregate review', () => {
  const plan = buildValidationSequencePlan({
    storyId: 'story-auth-only', riskProfile: 'light', riskSurfaces: ['auth_boundary']
  });
  assert.deepEqual(plan.preflight_reviews, [{
    stage: 'architecture_spec', role: 'architecture_boundary', surfaces: ['auth_boundary']
  }]);
  const state = createValidationSequenceState({
    plan, headSha: 'abc123', testFingerprint: 'tests-v1', verificationCommand: 'node --test'
  });
  const targeted = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  const action = evaluateValidationSequence(targeted, { currentHeadSha: 'abc123' }).next_required_action;
  assert.match(action.command, /--stage architecture_spec --role architecture_boundary/);
  assert.equal(action.ordered_actions.length, 5);
  assert.match(action.ordered_actions[1], /review start/);
  assert.match(action.ordered_actions[2], /review close/);
  assert.match(action.ordered_actions[3], /review record .*--summary .*--agent-transcript .*--agent-close-evidence/);
  assert.match(action.ordered_actions[3], /risk_surfaces=auth_boundary/);
  assert.match(action.ordered_actions[4], /sequence record/);
});

test('advisory preflight never satisfies final review and freeze waits for its disposition', () => {
  let state = stateForHighRisk();
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  state = recordValidationPhase(state, {
    phase: 'preflight_review', status: 'needs_changes', ...binding,
    findings: [{ id: 'boundary-1' }]
  });
  assert.equal(state.phases.preflight_review.record_type, 'advisory_preflight');
  assert.equal(state.phases.preflight_review.satisfies_final_review, false);
  assert.throws(() => recordValidationPhase(state, { phase: 'code_frozen', ...binding }), /requires passed targeted validation/);
  state = recordValidationPhase(state, {
    phase: 'preflight_review', status: 'dispositioned', ...binding,
    findings: [{ id: 'boundary-1' }], dispositions: [{ finding_id: 'boundary-1', status: 'accepted' }]
  });
  state = recordValidationPhase(state, { phase: 'code_frozen', ...binding });
  assert.equal(state.phases.code_frozen.status, 'passed');
});

test('expensive verification is reused only at the exact frozen binding', () => {
  let state = stateForHighRisk();
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  state = recordValidationPhase(state, { phase: 'preflight_review', ...binding });
  state = recordValidationPhase(state, { phase: 'code_frozen', ...binding });
  state = recordValidationPhase(state, { phase: 'expensive_verification', ...binding, source: 'ci_import' });
  assert.equal(evaluateExpensiveVerificationReuse(state, { head_sha: 'abc123', test_fingerprint: 'tests-v1', verification_command: 'node --test' }).reusable, true);
  assert.equal(evaluateExpensiveVerificationReuse(state, { head_sha: 'def456', test_fingerprint: 'tests-v1', verification_command: 'node --test' }).reusable, false);
  assert.equal(evaluateExpensiveVerificationReuse(state, { head_sha: 'abc123', test_fingerprint: 'tests-v2', verification_command: 'node --test' }).reusable, false);
  assert.equal(evaluateExpensiveVerificationReuse(state, { head_sha: 'abc123', test_fingerprint: 'tests-v1', verification_command: 'npm test' }).reusable, false);
  assert.throws(
    () => recordValidationPhase(state, { phase: 'expensive_verification', ...binding, source: 'local' }),
    /reuse existing evidence/
  );
});

test('freeze rejects nonterminal or unknown preflight dispositions', () => {
  let state = stateForHighRisk();
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  for (const status of ['open', 'foo']) {
    const reviewed = recordValidationPhase(state, {
      phase: 'preflight_review', status: 'dispositioned', ...binding,
      findings: [{ id: 'boundary-1' }], dispositions: [{ finding_id: 'boundary-1', status }]
    });
    assert.throws(() => recordValidationPhase(reviewed, { phase: 'code_frozen', ...binding }), /fully dispositioned/);
  }
});

test('freeze rejects passed preflight findings that have no terminal disposition', () => {
  let state = stateForHighRisk();
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  state = recordValidationPhase(state, {
    phase: 'preflight_review', status: 'passed', ...binding,
    findings: [{ id: 'boundary-1' }]
  });
  assert.throws(() => recordValidationPhase(state, { phase: 'code_frozen', ...binding }), /fully dispositioned/);
});

test('mutation invalidates scoped phases and unknown surfaces fail closed', () => {
  let state = stateForHighRisk();
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  state = recordValidationPhase(state, { phase: 'preflight_review', ...binding });
  state = recordValidationPhase(state, { phase: 'code_frozen', ...binding });
  state = invalidateValidationSequence(state, { changedSurfaces: ['spec_docs'], changedFiles: ['docs/specs/example.md'], reason: 'contract changed' });
  assert.equal(state.phases.targeted_validation.status, 'passed');
  assert.equal(state.phases.preflight_review.status, 'invalidated');
  state = invalidateValidationSequence(state, { changedSurfaces: [], reason: 'unclassified path' });
  assert.equal(state.phases.targeted_validation.status, 'invalidated');
  assert.deepEqual(state.invalidations.at(-1).changed_surfaces, ['unknown']);
});

test('changed files override optimistic surface declarations and fail closed', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  state = invalidateValidationSequence(state, {
    changedSurfaces: ['spec_docs'],
    changedFiles: ['src/validation-sequencing.js'],
    reason: 'caller mislabeled a runtime mutation'
  });
  assert.equal(state.phases.targeted_validation.status, 'invalidated');
  assert.deepEqual(state.invalidations.at(-1).changed_surfaces.sort(), ['runtime_source', 'spec_docs']);
});

test('persisted light plan is invalidated when current risk classification escalates', () => {
  const lightPlan = buildValidationSequencePlan({ storyId: 'story-risk-sequence', riskProfile: 'light' });
  const persisted = createValidationSequenceState({ plan: lightPlan, headSha: 'old-head' });
  assert.equal(evaluateValidationSequence(persisted, { currentHeadSha: 'new-head' }).status, 'not_applicable');

  const reconciled = reconcileValidationSequenceState(persisted, {
    storyId: 'story-risk-sequence',
    riskProfile: 'workflow_heavy',
    riskSurfaces: ['core_workflow_state'],
    headSha: 'new-head'
  });

  assert.equal(reconciled.plan.required, true);
  assert.equal(reconciled.plan.risk_profile, 'workflow_heavy');
  assert.equal(reconciled.phases.targeted_validation.status, 'invalidated');
  assert.equal(reconciled.proposed_binding.head_sha, 'new-head');
  assert.equal(evaluateValidationSequence(reconciled, { currentHeadSha: 'new-head' }).status, 'needs_evidence');
});

test('final readiness requires final review at current HEAD even when CI supplied expensive evidence', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  state = recordValidationPhase(state, { phase: 'expensive_verification', ...binding, source: 'ci_import' });
  assert.equal(evaluateValidationSequence(state, { currentHeadSha: 'abc123' }).ready_for_final_gate, false);
  state = recordValidationPhase(state, { phase: 'final_review', ...binding, ...finalReview });
  assert.equal(evaluateValidationSequence(state, { currentHeadSha: 'abc123' }).ready_for_final_gate, true);
  assert.equal(evaluateValidationSequence(state, { currentHeadSha: 'new-head' }).ready_for_final_gate, false);
});

test('changing the frozen binding invalidates stale downstream evidence and readiness fails closed', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen', 'expensive_verification', 'final_review']) {
    state = recordValidationPhase(state, { phase, ...binding, ...(phase === 'final_review' ? finalReview : {}) });
  }
  const changed = { headSha: 'abc123', testFingerprint: 'tests-v2', verificationCommand: 'npm test', evidence: '.vibepro/qa/changed.json', evidenceValidation: { status: 'verified' } };
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...changed });
  state = recordValidationPhase(state, { phase: 'preflight_review', ...changed });
  state = recordValidationPhase(state, { phase: 'code_frozen', ...changed });
  assert.equal(state.phases.expensive_verification.status, 'invalidated');
  assert.equal(state.phases.final_review.status, 'invalidated');
  assert.equal(evaluateValidationSequence(state, { currentHeadSha: 'abc123' }).ready_for_final_gate, false);
});

test('final review cannot be recorded before exact-bound expensive verification passes', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  assert.throws(
    () => recordValidationPhase(state, { phase: 'final_review', ...binding, ...finalReview }),
    /requires passed expensive_verification/
  );
});

test('final review rejects stale, weak, or open Agent Review provenance', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen', 'expensive_verification']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  assert.throws(
    () => recordValidationPhase(state, {
      phase: 'final_review', ...binding, ...finalReview,
      reviewProvenance: { ...finalReview.reviewProvenance, head_sha: 'old-head' }
    }),
    /must bind to the frozen HEAD/
  );
  assert.throws(
    () => recordValidationPhase(state, {
      phase: 'final_review', ...binding, ...finalReview,
      reviewProvenance: { ...finalReview.reviewProvenance, agent_closed: false }
    }),
    /strong closed parallel-subagent/
  );
});

test('freeze and evaluation reject targeted or preflight evidence from an older binding', () => {
  let state = stateForHighRisk();
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  state = recordValidationPhase(state, { phase: 'preflight_review', ...binding });
  const changed = { headSha: 'new-head', testFingerprint: 'tests-v2', verificationCommand: 'npm test' };
  assert.throws(
    () => recordValidationPhase(state, { phase: 'code_frozen', ...changed }),
    /exact freeze binding/
  );
  assert.equal(evaluateValidationSequence(state, { currentHeadSha: 'new-head' }).ready_for_final_gate, false);
});

test('evaluation exposes a deterministic next required sequence action', () => {
  const state = createValidationSequenceState({ plan: stateForHighRisk().plan, headSha: 'abc123', testFingerprint: 'tests-v1', verificationCommand: 'node --test' });
  const evaluation = evaluateValidationSequence(state, { currentHeadSha: 'abc123' });
  assert.equal(evaluation.next_required_action.phase, 'targeted_validation');
  assert.match(evaluation.next_required_action.command, /verify record .*validation_phase=targeted_validation/);
  assert.match(evaluation.next_required_action.follow_up_command, /sequence record .*--phase targeted_validation/);
});

test('state without a complete proposed binding directs plan and rejects phase recording', () => {
  const state = createValidationSequenceState({ plan: stateForHighRisk().plan, headSha: 'abc123' });
  const evaluation = evaluateValidationSequence(state, { currentHeadSha: 'abc123' });
  assert.equal(evaluation.next_required_action.phase, 'plan');
  assert.match(evaluation.next_required_action.command, /--command .*--test-fingerprint/);
  assert.throws(
    () => recordValidationPhase(state, { phase: 'targeted_validation', headSha: 'abc123' }),
    /requires HEAD, verification command, and test fingerprint/
  );
});

test('targeted completion advances the next action to advisory preflight before freeze exists', () => {
  let state = createValidationSequenceState({
    plan: stateForHighRisk().plan,
    headSha: binding.headSha,
    testFingerprint: binding.testFingerprint,
    verificationCommand: binding.verificationCommand
  });
  state = recordValidationPhase(state, { phase: 'targeted_validation', ...binding });
  const evaluation = evaluateValidationSequence(state, { currentHeadSha: 'abc123' });
  assert.equal(evaluation.next_required_action.phase, 'preflight_review');
  assert.match(evaluation.next_required_action.command, /review prepare .*architecture_boundary/);
  assert.equal(evaluation.next_required_action.follow_up_command, undefined);
  assert.match(evaluation.next_required_action.instruction, /one aggregate architecture_boundary Agent Review/);
  assert.match(evaluation.next_required_action.ordered_actions.at(-1), /--phase preflight_review/);
});

test('current HEAD drift exposes an actionable invalidation command after a completed sequence', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen', 'expensive_verification', 'final_review']) {
    state = recordValidationPhase(state, { phase, ...binding, ...(phase === 'final_review' ? finalReview : {}) });
  }
  const evaluation = evaluateValidationSequence(state, { currentHeadSha: 'new-head' });
  assert.deepEqual(evaluation.blocking_phases, ['current_head_binding']);
  assert.equal(evaluation.next_required_action.phase, 'invalidate');
  assert.match(evaluation.next_required_action.command, /sequence invalidate .*--surface unknown/);
});

test('current HEAD drift is repaired before suggesting a pending final review', () => {
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen', 'expensive_verification']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  const evaluation = evaluateValidationSequence(state, { currentHeadSha: 'new-head' });
  assert.equal(evaluation.next_required_action.phase, 'invalidate');
  assert.match(evaluation.next_required_action.command, /HEAD changed/);
});

test('direct CI sequence recording is rejected without a validated import receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-validation-sequence-'));
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  await writeValidationSequence(root, state);
  const result = await recordImportedCiVerification(root, state.story_id, 'abc123', [{
    check: 'node --test',
    covered_command: 'node --test',
    covered_test_fingerprint: 'tests-v1',
    artifact: '.vibepro/pr/ci.json'
  }]);
  const persisted = await readValidationSequence(root, state.story_id);
  assert.equal(result.recorded, false);
  assert.match(result.reason, /validated receipt/);
  assert.equal(persisted.phases.expensive_verification.status, 'pending');
});

test('direct CI augmentation is rejected without a validated import receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-validation-sequence-'));
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen', 'expensive_verification']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  await writeValidationSequence(root, state);
  const result = await recordImportedCiVerification(root, state.story_id, 'abc123', [{
    check: 'node --test', covered_command: 'node --test', covered_test_fingerprint: 'tests-v1', artifact: '.vibepro/pr/ci.json'
  }]);
  const persisted = await readValidationSequence(root, state.story_id);
  assert.equal(result.recorded, false);
  assert.match(result.reason, /validated receipt/);
  assert.equal(persisted.phases.expensive_verification.ci_import_augmented, undefined);
});

test('CI import fails closed when command identity is unproven or mapped checks are unresolved', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-validation-sequence-'));
  let state = stateForHighRisk();
  for (const phase of ['targeted_validation', 'preflight_review', 'code_frozen']) {
    state = recordValidationPhase(state, { phase, ...binding });
  }
  await writeValidationSequence(root, state);

  const mismatch = await recordImportedCiVerification(root, state.story_id, 'abc123', [{
    check: 'npm run unrelated',
    artifact: '.vibepro/pr/ci.json'
  }]);
  assert.equal(mismatch.recorded, false);
  assert.match(mismatch.reason, /validated receipt/);

  const unresolved = await recordImportedCiVerification(root, state.story_id, 'abc123', {
    imported: [{ check: 'node --test', covered_command: 'node --test', covered_test_fingerprint: 'tests-v1', artifact: '.vibepro/pr/ci.json' }],
    pending: [{ check: 'node --test shard 2' }],
    failures: []
  });
  assert.equal(unresolved.recorded, false);
  assert.match(unresolved.reason, /validated receipt/);
});

test('sequence CLI persists the planned and recorded workflow through the public command path', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-validation-sequence-cli-'));
  const canonicalEvidence = path.join(root, '.vibepro', 'pr', 'story-cli-sequence', 'verification-evidence.json');
  await mkdir(path.dirname(canonicalEvidence), { recursive: true });
  const nativeCommand = (kind, phase, extra = {}) => ({
    kind, status: 'pass', command: 'node --test', executed_at: new Date().toISOString(),
    git_context: { head_sha: 'abc123' }, artifact_check: { status: 'verified' },
    observation_check: { status: 'recorded' }, content_binding: { schema_version: '0.1.0', recorded_head_sha: 'abc123' },
    observation: { values: { test_fingerprint: 'tests-v1', validation_phase: phase, ...extra } }
  });
  await writeFile(canonicalEvidence, JSON.stringify({ schema_version: '0.1.0', story_id: 'story-cli-sequence', commands: [
    nativeCommand('unit', 'targeted_validation'),
    nativeCommand('integration', 'preflight_review', { review_role: 'boundary_reviewer', review_surface: 'core_workflow_state' })
  ] }));
  const planned = await runCli([
    'sequence', 'plan', root,
    '--id', 'story-cli-sequence',
    '--head', 'abc123',
    '--risk-profile', 'workflow_heavy',
    '--surface', 'core_workflow_state',
    '--command', 'node --test',
    '--test-fingerprint', 'tests-v1',
    '--json'
  ]);
  assert.equal(planned.exitCode, 0);
  assert.equal(planned.result.state.plan.required, true);

  const missingEvidence = await runCli([
    'sequence', 'record', root, '--id', 'story-cli-sequence', '--head', 'abc123',
    '--phase', 'targeted_validation', '--status', 'passed', '--evidence', '.vibepro/qa/missing.json', '--json'
  ]);
  assert.equal(missingEvidence.exitCode, 1, 'nonexistent evidence must fail closed');

  const recorded = await runCli([
    'sequence', 'record', root,
    '--id', 'story-cli-sequence',
    '--head', 'abc123',
    '--phase', 'targeted_validation',
    '--status', 'passed',
    '--evidence', '.vibepro/pr/story-cli-sequence/verification-evidence.json',
    '--json'
  ]);
  assert.equal(recorded.exitCode, 0);
  assert.equal(recorded.result.state.phases.targeted_validation.status, 'passed');

  const dispositionWithoutEvidence = await runCli([
    'sequence', 'record', root,
    '--id', 'story-cli-sequence', '--head', 'abc123',
    '--phase', 'preflight_review', '--status', 'dispositioned',
    '--finding', 'boundary-0', '--disposition', 'boundary-0:accepted', '--json'
  ]);
  assert.equal(dispositionWithoutEvidence.exitCode, 1, 'dispositioned preflight must still require canonical evidence');

  const preflightWithFinding = await runCli([
    'sequence', 'record', root,
    '--id', 'story-cli-sequence',
    '--head', 'abc123',
    '--phase', 'preflight_review',
    '--status', 'passed',
    '--evidence', '.vibepro/pr/story-cli-sequence/verification-evidence.json',
    '--finding', 'boundary-1',
    '--json'
  ]);
  assert.equal(preflightWithFinding.exitCode, 1, 'preflight must use canonical Agent Review, not verification observations');
  const rejectedFreeze = await runCli([
    'sequence', 'record', root,
    '--id', 'story-cli-sequence',
    '--head', 'abc123',
    '--phase', 'code_frozen',
    '--json'
  ]);
  assert.equal(rejectedFreeze.exitCode, 1);

  const status = await runCli(['sequence', 'status', root, '--id', 'story-cli-sequence', '--head', 'abc123', '--json']);
  assert.equal(status.exitCode, 0);
  assert.equal(status.result.state.story_id, 'story-cli-sequence');
  assert.equal(status.result.state.phases.targeted_validation.status, 'passed');
});
