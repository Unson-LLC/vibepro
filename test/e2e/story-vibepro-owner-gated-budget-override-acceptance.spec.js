import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildBudgetApproval,
  computeBudgetOverrideDigest,
  resolveBudgetOverrideAuthority
} from '../../src/budget-override-authority.js';
import {
  resolveEfficiencyPolicyDecision,
  summarizeEfficiencyDebt
} from '../../src/delivery-efficiency-guardrail.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));

const STORY_ID = 'story-ogb-e2e';
const OVERRIDE = { max_subagent_count: 9, amendment_reason: 'one extra repair round after the rebase' };

async function makeRepo(override = OVERRIDE) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ogb-e2e-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await writeConfig(root, override);
  return root;
}

async function writeConfig(root, override) {
  await writeFile(
    path.join(root, '.vibepro', 'config.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      budgets: {
        delivery_efficiency: { max_subagent_count: 6, max_review_dispatches_by_role: { architecture: 1 } },
        delivery_efficiency_by_story: { [STORY_ID]: override }
      }
    }, null, 2)
  );
}

async function readConfig(root) {
  return JSON.parse(await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8'));
}

async function readDecisions(root) {
  const file = path.join(root, '.vibepro', 'pr', STORY_ID, 'decision-records.json');
  try {
    return JSON.parse(await readFile(file, 'utf8')).decisions ?? [];
  } catch {
    return [];
  }
}

function grantArgs(root, extra = []) {
  return [
    CLI_BIN, 'decision', 'record', root,
    '--id', STORY_ID,
    '--type', 'waiver',
    '--status', 'accepted',
    '--source', `budget:delivery_efficiency:${STORY_ID}`,
    '--summary', 'raise the Story subagent cap from 6 to 9',
    '--reason', 'owner approved the raise for the externally forced rebase round',
    '--budget-grantor-kind', 'human',
    '--agent-system', 'claude_code',
    '--agent-id', 'agent-ogb-e2e',
    ...extra
  ];
}

// flow_replay: the full owner-gated budget override lifecycle is replayed through
// the real `vibepro decision record` CLI subprocess, not through in-process calls.
test('ac:1 S-001 OGB-E2E-1 flow_replay: an override is inert until the real CLI records a human grant', async () => {
  const root = await makeRepo();

  const before = resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions: await readDecisions(root) });
  assert.equal(before.policy.max_subagent_count, 6);
  assert.equal(before.override.status, 'unauthorized');
  assert.deepEqual(before.override.reasons, ['missing_approval']);

  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo', '--json']));

  const after = resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions: await readDecisions(root) });
  assert.equal(after.policy.max_subagent_count, 9);
  assert.equal(after.override.status, 'authorized');
  assert.equal(after.override.approval.grantor, 'sato-keigo');
  assert.deepEqual(after.override.approval.recorded_by, { agent_system: 'claude_code', agent_id: 'agent-ogb-e2e' });
});

// The receiver of the budget cannot grant it, enforced at the real command boundary.
test('ac:5 ac:6 OGB-E2E-2 flow_replay: the real CLI refuses a self-grant and leaves the override inert', async () => {
  const root = await makeRepo();

  await assert.rejects(
    execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'agent-ogb-e2e'])),
    (error) => /grantor must differ from the recording agent/.test(`${error.stderr ?? ''}${error.stdout ?? ''}${error.message}`),
    'ac6 the CLI throws at write time when the grantor equals the recording agent identity'
  );

  assert.deepEqual(await readDecisions(root), [],
    'ac5 a refused self-grant writes no decision record, so the override cannot become authorized');
  const resolved = resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions: await readDecisions(root) });
  assert.equal(resolved.policy.max_subagent_count, 6);
  assert.equal(resolved.override.status, 'unauthorized');
});

// Approving 9 and then applying 40 is the concrete abuse this gate exists to stop.
test('ac:3 OGB-E2E-3 flow_replay: raising the limit after a real grant reverts to the base budget', async () => {
  const root = await makeRepo();
  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo']));

  const decisions = await readDecisions(root);
  assert.equal(decisions[0].budget_approval.override_digest, computeBudgetOverrideDigest(STORY_ID, OVERRIDE));

  await writeConfig(root, { ...OVERRIDE, max_subagent_count: 40 });

  const resolved = resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions });
  assert.equal(resolved.policy.max_subagent_count, 6,
    'ac3 raising the configured limit after approval reverts the effective budget to the base policy');
  assert.equal(resolved.override.status, 'unauthorized',
    'ac3 an override edited after approval is no longer authorized');
  assert.deepEqual(resolved.override.reasons, ['approval_digest_mismatch'],
    'ac3 the disqualification reason is approval_digest_mismatch');
});

// parse_failure: a corrupt decision-records.json must fail closed to the base
// budget rather than crashing the caller or widening the limits by default.
test('ac:1 OGB-E2E-4 parse_failure: unreadable grant records resolve to the base budget, not a wider one', async () => {
  const root = await makeRepo();
  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo']));

  const recordsFile = path.join(root, '.vibepro', 'pr', STORY_ID, 'decision-records.json');
  await writeFile(recordsFile, '{"decisions": [ this is not json');

  let decisions;
  try {
    decisions = JSON.parse(await readFile(recordsFile, 'utf8')).decisions;
  } catch {
    decisions = [];
  }

  const resolved = resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions });
  assert.equal(resolved.policy.max_subagent_count, 6);
  assert.equal(resolved.override.status, 'unauthorized');
  assert.deepEqual(resolved.override.reasons, ['missing_approval']);

  // A malformed grant object present in the list is also inert rather than fatal.
  const malformed = resolveBudgetOverrideAuthority({
    storyId: STORY_ID,
    override: OVERRIDE,
    decisions: [{ source: `budget:delivery_efficiency:${STORY_ID}`, status: 'accepted', story_id: STORY_ID, budget_approval: 'not-an-object' }]
  });
  assert.equal(malformed.status, 'unauthorized');
  assert.ok(malformed.reasons.includes('approval_missing_budget_grant'));
});

// evidence_lifecycle_regression: a grant that is later superseded or rejected must
// stop authorizing; an accepted grant must not survive its own withdrawal.
test('ac:5 OGB-E2E-5 evidence_lifecycle_regression: a superseded grant stops authorizing the override', async () => {
  const root = await makeRepo();
  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo']));

  const accepted = await readDecisions(root);
  assert.equal(resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions: accepted }).override.status, 'authorized');

  const superseded = accepted.map((decision) => ({ ...decision, status: 'superseded' }));
  const resolved = resolveEfficiencyPolicyDecision(await readConfig(root), STORY_ID, { decisions: superseded });
  assert.equal(resolved.policy.max_subagent_count, 6);
  assert.equal(resolved.override.status, 'unauthorized');
  assert.ok(resolved.override.reasons.includes('approval_not_accepted'));
});

// path_surface: review_surface. `review authorize` and `pr prepare` are the two
// surfaces that consume the resolved policy, so both must carry the status.
test('ac:2 ac:9 OGB-E2E-6 path_surface: both consuming surfaces report the override authority status', async () => {
  const root = await makeRepo();
  const config = await readConfig(root);

  const inert = resolveEfficiencyPolicyDecision(config, STORY_ID, { decisions: [] });
  assert.equal(inert.override.applied, false);
  assert.equal(inert.override.digest, computeBudgetOverrideDigest(STORY_ID, OVERRIDE));

  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo']));
  const granted = resolveEfficiencyPolicyDecision(config, STORY_ID, { decisions: await readDecisions(root) });
  assert.equal(granted.override.applied, true);
  assert.equal(granted.override.digest, inert.override.digest);
});

// The remaining acceptance criteria are pure-resolution properties. They are
// asserted here as executable acceptance assertions so the Story's AC set is
// covered in one place, alongside the CLI replays above.

test('ac:4 digest is scoped to the story and blind to amendment_reason prose', () => {
  const a = computeBudgetOverrideDigest(STORY_ID, { max_subagent_count: 9, amendment_reason: 'first wording' });
  assert.equal(a, computeBudgetOverrideDigest(STORY_ID, { max_subagent_count: 9, amendment_reason: 'rewritten' }),
    'ac4 digest excludes amendment_reason so reworded prose preserves an existing grant');
  assert.notEqual(a, computeBudgetOverrideDigest(STORY_ID, { max_subagent_count: 10, amendment_reason: 'first wording' }),
    'ac4 digest covers the limits so any changed number invalidates the grant');
  assert.notEqual(a, computeBudgetOverrideDigest('story-other', { max_subagent_count: 9, amendment_reason: 'first wording' }),
    'ac4 digest includes story_id so identical limits under another Story are not transplantable');
});

test('ac:5 non-human grantor and unidentified recorder never authorize', () => {
  const digest = computeBudgetOverrideDigest(STORY_ID, OVERRIDE);
  const decision = (approval) => ({
    decision_id: 'd1', story_id: STORY_ID, status: 'accepted',
    source: `budget:delivery_efficiency:${STORY_ID}`, reason: 'raise needed',
    budget_approval: {
      story_id: STORY_ID, override_digest: digest, grantor_kind: 'human',
      grantor: 'sato-keigo', recorded_by: { agent_system: 'claude_code', agent_id: 'agent-x' }, ...approval
    }
  });
  for (const [approval, expected] of [
    [{ grantor_kind: 'agent' }, 'grantor_not_human'],
    [{ grantor: 'agent-x' }, 'self_approved'],
    [{ recorded_by: { agent_system: 'claude_code', agent_id: '' } }, 'recording_agent_unidentified']
  ]) {
    const resolved = resolveBudgetOverrideAuthority({ storyId: STORY_ID, override: OVERRIDE, decisions: [decision(approval)] });
    assert.equal(resolved.status, 'unauthorized',
      'ac5 a non-human grantor, a self-grant, or an unidentified recorder never authorizes the override');
    assert.ok(resolved.reasons.includes(expected),
      'ac5 the specific disqualification reason is reported');
  }
});

test('ac:6 buildBudgetApproval throws at write time on a self-grant or missing identity', () => {
  assert.throws(() => buildBudgetApproval({
    storyId: STORY_ID, overrideDigest: 'abc', grantorKind: 'human',
    grantor: 'agent-x', agentSystem: 'claude_code', agentId: 'agent-x'
  }), /grantor must differ from the recording agent/,
  'ac6 buildBudgetApproval throws on a self-grant rather than persisting a silently inert record');
  assert.throws(() => buildBudgetApproval({
    storyId: STORY_ID, overrideDigest: 'abc', grantorKind: 'human',
    grantor: 'sato-keigo', agentSystem: 'claude_code'
  }), /--agent-id/,
  'ac6 buildBudgetApproval throws when the recording agent identity is incomplete');
});

test('ac:7 ac:8 S-002 every shipped override is grandfathered by pinned digest or inert', async () => {
  const repoConfig = JSON.parse(await readFile(new URL('../../.vibepro/config.json', import.meta.url), 'utf8'));
  const entries = Object.entries(repoConfig.budgets.delivery_efficiency_by_story ?? {});
  assert.equal(entries.length, 13);
  for (const [storyId, override] of entries) {
    const resolved = resolveBudgetOverrideAuthority({ storyId, override, decisions: [] });
    assert.equal(resolved.status, 'grandfathered', `${storyId} should be grandfathered as merged`);
    const edited = resolveBudgetOverrideAuthority({
      storyId, override: { ...override, max_subagent_count: 9999 }, decisions: []
    });
    assert.equal(edited.status, 'unauthorized', `${storyId} must lose grandfathering when edited`);
  }
});

test('ac:9 an unauthorized override is reported as efficiency debt', () => {
  const debt = summarizeEfficiencyDebt({
    correctness_ready: true,
    budget_override: { status: 'unauthorized', reasons: ['self_approved'] }
  });
  assert.equal(debt.has_efficiency_debt, true);
  assert.deepEqual(debt.debt, [{ kind: 'budget_override_unauthorized', reasons: ['self_approved'] }]);
});

test('ac:10 the recorded digest comes from config and ignores any caller-supplied value', async () => {
  const root = await makeRepo();
  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo']));
  const [decision] = await readDecisions(root);
  assert.equal(decision.budget_approval.override_digest, computeBudgetOverrideDigest(STORY_ID, OVERRIDE),
    'ac10 the recorded override_digest is computed from .vibepro/config.json, not from caller-supplied input');
});

test('ac:11 the real CLI requires reason, grantor, grantor kind and agent identity', async () => {
  const root = await makeRepo();
  const omit = (flag) => {
    const args = grantArgs(root, ['--budget-grantor', 'sato-keigo']);
    const at = args.indexOf(flag);
    return [...args.slice(0, at), ...args.slice(at + 2)];
  };
  for (const [flag, pattern] of [
    ['--reason', /requires --reason/],
    ['--budget-grantor-kind', /grantor kind must be one of/],
    ['--agent-id', /--agent-id/]
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, omit(flag)),
      (error) => pattern.test(`${error.stderr ?? ''}${error.stdout ?? ''}${error.message}`),
      'ac11 budget approval requires reason, grantor, grantor kind and agent identity; omitting any required flag must fail'
    );
  }
});

test('ac:12 the real CLI rejects a mismatched or non-budget source', async () => {
  const root = await makeRepo();
  const swap = (flag, value) => {
    const args = grantArgs(root, ['--budget-grantor', 'sato-keigo']);
    args[args.indexOf(flag) + 1] = value;
    return args;
  };
  await assert.rejects(
    execFileAsync(process.execPath, swap('--source', 'budget:delivery_efficiency:story-other')),
    (error) => /does not match --id/.test(`${error.stderr ?? ''}${error.stdout ?? ''}${error.message}`)
  );
  await assert.rejects(
    execFileAsync(process.execPath, swap('--source', 'gate:agent_review')),
    (error) => /budget approval flags require --source/.test(`${error.stderr ?? ''}${error.stdout ?? ''}${error.message}`)
  );
});
