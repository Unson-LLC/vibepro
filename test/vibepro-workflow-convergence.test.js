import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const skillPath = path.resolve('skills/vibepro-workflow/SKILL.md');
const codexTemplatePath = path.resolve('agent-instructions/codex/AGENTS.vibepro.md');
const distributedWorkflowPaths = [skillPath, codexTemplatePath];

test('VibePro workflow publishes the minimal-core convergence contract', async () => {
  const policy = await readConvergencePolicy();

  assert.deepEqual(policy.workflow, [
    'story',
    'spec',
    'implement',
    'affected_tests',
    'single_review_wave',
    'github_pr',
    'ci',
    'merge'
  ]);
  assert.equal(policy.review_waves, 1);
  assert.equal(policy.max_parallel_review_roles, 3);
  assert.equal(policy.max_total_review_dispatches, 5);
  assert.equal(policy.verification_scope_during_development, 'affected_tests');
  assert.equal(policy.full_suite_location, 'ci');
  assert.deepEqual(policy.exact_head_scope, ['ci', 'release_readback']);
  assert.equal(policy.legacy_gate_projection, 'informational_only');
  assert.equal(policy.pr_command, 'gh pr create');
});

test('review findings converge instead of expanding the current Story', async () => {
  const policy = await readConvergencePolicy();

  assert.equal(policy.blocking_finding_action, 'fix_then_reverify_affected_surface');
  assert.equal(policy.non_blocking_finding_action, 'follow_up_story');
  assert.equal(
    policy.review_runtime_failure_action,
    'report_runtime_failure_without_product_finding'
  );

  const dispatches = Array.from(
    { length: policy.max_total_review_dispatches + 2 },
    (_, index) => index + 1
  );
  const executed = dispatches.filter((count) => count <= policy.max_total_review_dispatches);
  assert.equal(executed.length, 5);
  assert.equal(executed.at(-1), policy.max_total_review_dispatches);
});

test('E2E uses a deterministic fixture and at most one real fresh-task smoke', async () => {
  const policy = await readConvergencePolicy();

  assert.equal(policy.e2e.deterministic_fixture_required, true);
  assert.equal(policy.e2e.fresh_task_smoke_max, 1);
});

test('external side effects require read-before-write and terminal evidence', async () => {
  const { external_side_effects: policy } = await readConvergencePolicy();

  assert.equal(policy.read_before_write, true);
  assert.deepEqual(policy.required_retry_context, [
    'previous_run_id',
    'first_failure_boundary',
    'error_code',
    'observable_delta',
    'retry_hypothesis',
    'terminal_receipt_target'
  ]);
  assert.equal(policy.retry_requires_observable_delta, true);
  assert.equal(policy.mutation_budget, 3);
  assert.equal(policy.completion_state, 'verified-complete');
  assert.deepEqual(policy.progress_states, [
    'accepted',
    'processing',
    'delivered',
    'verified-complete'
  ]);
  assert.deepEqual(policy.non_terminal_states, ['accepted', 'processing', 'delivered']);

  const unreadablePreviousRun = {
    previous_run_id: null,
    first_failure_boundary: null,
    error_code: null,
    observable_delta: 'credential_rotated',
    retry_hypothesis: 'the prior credential was rejected',
    terminal_receipt_target: 'destination_delivery_receipt'
  };
  assert.deepEqual(evaluateRetry(policy, unreadablePreviousRun), {
    allowed: false,
    reason: 'required_retry_context_missing',
    missing: ['previous_run_id', 'first_failure_boundary', 'error_code']
  });

  const uploadOnly = evaluateExternalAttempt(policy, {
    status: 'accepted',
    terminal_receipt: null
  });
  assert.equal(uploadOnly.completed, false);
  assert.equal(uploadOnly.reason, 'terminal_receipt_missing');
});

test('three identical semantic failures stop the fourth external mutation', async () => {
  const { external_side_effects: policy } = await readConvergencePolicy();
  assert.deepEqual(policy.semantic_progress_fields, [
    'first_failure_boundary',
    'error_code',
    'observable_delta',
    'retry_hypothesis',
    'terminal_receipt'
  ]);
  const attempts = Array.from({ length: 4 }, (_, index) => ({
    run_id: `run-${index + 1}`,
    tool_call_succeeded: true,
    first_failure_boundary: 'tenant_context_resolution',
    error_code: 'CROSS_TENANT_CANDIDATE',
    observable_delta: 'canonical_config_verified',
    terminal_receipt: null
  }));

  const result = applyMutationBudget(policy, attempts);

  assert.equal(result.executed_mutations, 3);
  assert.equal(result.fourth_mutation_allowed, false);
  assert.equal(result.semantic_progress, false);
  assert.equal(result.outcome, 'root_cause_summary_or_block');
  assert.equal(policy.semantic_progress_fields.includes('tool_call_succeeded'), false);

  const changingFailures = attempts.map((attempt, index) => ({
    ...attempt,
    first_failure_boundary: `stage-${index + 1}`,
    error_code: `ERROR_${index + 1}`,
    observable_delta: `change-${index + 1}`,
    retry_hypothesis: `hypothesis-${index + 1}`
  }));
  const budgetOnlyResult = applyMutationBudget(policy, changingFailures);
  assert.equal(budgetOnlyResult.executed_mutations, 3);
  assert.equal(budgetOnlyResult.fourth_mutation_allowed, false);
  assert.equal(budgetOnlyResult.outcome, 'mutation_budget_exhausted');
});

test('failure-boundary expansion carries an explicit unresolved boundary', async () => {
  const { external_side_effects: policy } = await readConvergencePolicy();

  assert.equal(policy.scope_expansion.requires_first_failure_boundary, true);
  assert.deepEqual(policy.scope_expansion.when_boundary_unknown, [
    'record_expansion_rationale',
    'carry_forward_unidentified_boundary'
  ]);
  assert.equal(policy.enforcement_mode, 'instruction_contract');
  assert.equal(policy.host_runtime_boundary, 'host_enforces_external_mutation_stop');
  assert.equal(policy.unsupported_host_action, 'block_mutation_and_open_upstream_issue');
});

test('vibepro-workflow runs the Development Judgment loop as advisory, before story plan', async () => {
  const skill = await readFile(skillPath, 'utf8');

  const step2Index = skill.indexOf('### 2. Inspect the relevant code');
  const judgmentHeadingIndex = skill.indexOf(
    '### 3. Run the Development Judgment loop (advisory)'
  );
  const step4Index = skill.indexOf('### 4. Implement the smallest coherent change');
  const evaluateIndex = skill.indexOf('judgment evaluate');
  const dispositionRecordIndex = skill.indexOf('judgment disposition record');
  const step8Index = skill.indexOf('### 8. Prepare and open the PR');
  const outcomeRecordIndex = skill.indexOf('judgment outcome record');
  const step9Index = skill.indexOf('### 9. Bound external side effects');

  assert.ok(step2Index >= 0, 'SKILL.md must keep the "Inspect the relevant code" step');
  assert.ok(
    judgmentHeadingIndex >= 0,
    'SKILL.md must document the Development Judgment loop step'
  );
  assert.ok(step4Index >= 0, 'SKILL.md must keep the "Implement the smallest coherent change" step');
  assert.ok(evaluateIndex >= 0, 'SKILL.md must reference judgment evaluate');
  assert.ok(dispositionRecordIndex >= 0, 'SKILL.md must reference judgment disposition record');
  assert.ok(step8Index >= 0, 'SKILL.md must keep the "Prepare and open the PR" step');
  assert.ok(outcomeRecordIndex >= 0, 'SKILL.md must reference judgment outcome record');
  assert.ok(step9Index >= 0, 'SKILL.md must keep the "Bound external side effects" step');

  assert.ok(
    step2Index < judgmentHeadingIndex && judgmentHeadingIndex < step4Index,
    'the Development Judgment loop heading must sit between step 2 and step 4'
  );
  assert.ok(
    evaluateIndex < dispositionRecordIndex && dispositionRecordIndex < step4Index,
    'judgment disposition record must be documented after judgment evaluate and before step 4'
  );
  assert.ok(
    step8Index < outcomeRecordIndex && outcomeRecordIndex < step9Index,
    'judgment outcome record must be documented after step 8 and before step 9'
  );

  assert.match(skill, /judgment applicability record/);
  const criterionIndex = skill.indexOf('**Applicability criterion**');
  assert.ok(
    criterionIndex >= 0 && criterionIndex < skill.indexOf('judgment applicability record'),
    'SKILL.md must define the applicability criterion before the applicability record command'
  );
  assert.match(skill, /VALUE \/ SIMPLIFY \/ VALIDATE decision remains/);
  assert.match(skill, /NOT this criterion/);
  assert.match(skill, /judgment prepare/);
  assert.match(skill, /judgment input adopt/);
  assert.match(skill, /judgment evaluate/);
  assert.match(skill, /judgment disposition record/);
  assert.match(skill, /judgment outcome record/);
  assert.match(
    skill,
    /ADVISORY: it never changes PR readiness, merge, or release authority/
  );
});

test('all distributed workflow surfaces converge on the minimal core', async () => {
  for (const surfacePath of distributedWorkflowPaths) {
    const surface = await readFile(surfacePath, 'utf8');

    assert.match(
      surface,
      /Story[^\n]*→[^\n]*Spec[^\n]*→[^\n]*implement[^\n]*→[^\n]*affected tests[^\n]*→[^\n]*one review wave[^\n]*→[^\n]*GitHub PR[^\n]*→[^\n]*CI[^\n]*→[^\n]*merge/i,
      `${surfacePath} must publish the minimal-core loop`
    );
    assert.match(surface, /legacy Gate[\s\S]*informational only/i);
    assert.match(surface, /gh pr create/);

    assert.doesNotMatch(surface, /subagent-recovery-policy:start/);
    assert.doesNotMatch(surface, /Prefer `vibepro execute start/);
    assert.doesNotMatch(surface, /Run every listed `vibepro review prepare/);
    assert.doesNotMatch(surface, /do not call the work complete until `gate:agent_review` passes/i);
    assert.doesNotMatch(surface, /gate_status\.ready_for_pr_create/);
    assert.doesNotMatch(surface, /gate_status\.agent_review_instruction/);
    assert.doesNotMatch(surface, /Do not call raw `gh pr create`/);
    assert.doesNotMatch(surface, /Use VibePro as the Story \/ Architecture \/ Spec \/ Graphify \/ Gate control plane/);
  }
});

test('Codex installation guidance does not reintroduce removed authority', async () => {
  const template = await readFile(codexTemplatePath, 'utf8');

  assert.match(template, /VibePro is not a workflow engine, merge authority, safety decision engine/);
  assert.match(template, /VibePro does not authorize deploys, production writes, secret access, or external actions/);
  assert.match(template, /`vibepro pr create` is optional convenience, not required authority/);
  assert.match(template, /Do not use or require retired contracts/);
  assert.match(template, /raw `gh pr create` prohibition/);
});

async function readConvergencePolicy() {
  const skill = await readFile(skillPath, 'utf8');
  const match = skill.match(
    /<!-- minimal-core-convergence-policy:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- minimal-core-convergence-policy:end -->/
  );
  assert.ok(match, 'workflow Skill must include its machine-tested convergence policy');
  return JSON.parse(match[1]);
}

function evaluateExternalAttempt(policy, attempt) {
  const completed = attempt.status === policy.completion_state && Boolean(attempt.terminal_receipt);
  return {
    completed,
    reason: completed ? 'terminal_receipt_verified' : 'terminal_receipt_missing'
  };
}

function evaluateRetry(policy, retryContext) {
  const missing = policy.required_retry_context.filter((field) => !retryContext[field]);
  return missing.length > 0
    ? { allowed: false, reason: 'required_retry_context_missing', missing }
    : { allowed: true, reason: 'retry_context_complete', missing: [] };
}

function applyMutationBudget(policy, attempts) {
  let executedMutations = 0;
  let noProgressCount = 0;
  let previousSemanticState = null;

  for (const attempt of attempts) {
    if (
      executedMutations >= policy.mutation_budget ||
      noProgressCount >= policy.no_progress_limit
    ) break;
    executedMutations += 1;

    const semanticState = policy.semantic_progress_fields
      .map((field) => attempt[field] ?? null)
      .join('|');
    if (previousSemanticState === null || previousSemanticState === semanticState) {
      noProgressCount += 1;
    } else {
      noProgressCount = 0;
    }
    previousSemanticState = semanticState;
  }

  return {
    executed_mutations: executedMutations,
    fourth_mutation_allowed: executedMutations >= 4,
    semantic_progress: noProgressCount === 0,
    outcome: noProgressCount >= policy.no_progress_limit
      ? 'root_cause_summary_or_block'
      : executedMutations >= policy.mutation_budget
        ? 'mutation_budget_exhausted'
        : 'continue'
  };
}
