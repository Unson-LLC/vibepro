import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  GRANDFATHERED_OVERRIDE_DIGESTS,
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

// GE-001: this test asserts the resolver contract that both consuming surfaces
// depend on -- a stable digest and an applied flag. It does NOT invoke `review
// authorize` or `pr prepare`; those surfaces are asserted directly in
// test/budget-override-consuming-surfaces.test.js.
test('ac:2 OGB-E2E-6 the resolver exposes a stable digest and applied flag to its consumers', async () => {
  const root = await makeRepo();
  const config = await readConfig(root);

  const inert = resolveEfficiencyPolicyDecision(config, STORY_ID, { decisions: [] });
  assert.equal(inert.override.applied, false,
    'ac2 an override without a grant is reported as not applied');
  assert.equal(inert.override.digest, computeBudgetOverrideDigest(STORY_ID, OVERRIDE));

  await execFileAsync(process.execPath, grantArgs(root, ['--budget-grantor', 'sato-keigo']));
  const granted = resolveEfficiencyPolicyDecision(config, STORY_ID, { decisions: await readDecisions(root) });
  assert.equal(granted.override.applied, true,
    'ac2 an override is applied only once every grant condition is satisfied');
  assert.equal(granted.override.digest, inert.override.digest,
    'ac2 the digest is stable across the unauthorized and authorized states');
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

// RR-002: assert the acceptance criterion, not a snapshot. Pinning the count at
// 13 and requiring every entry to be grandfathered would turn the suite red the
// first time a Story legitimately obtains a grant -- the very workflow this
// change ships. What OGB-S-7/S-8 actually require is that a pinned override is
// grandfathered, that editing it revokes that, and that nothing resolves to an
// unknown status.
test('ac:7 ac:8 S-002 every shipped override resolves to a known authority status', async () => {
  const repoConfig = JSON.parse(await readFile(new URL('../../.vibepro/config.json', import.meta.url), 'utf8'));
  const entries = Object.entries(repoConfig.budgets.delivery_efficiency_by_story ?? {});
  assert.ok(entries.length > 0, 'ac8 the repository configures at least one Story override to resolve');
  const pinned = [];
  for (const [storyId, override] of entries) {
    const resolved = resolveBudgetOverrideAuthority({ storyId, override, decisions: [] });
    assert.ok(['grandfathered', 'unauthorized', 'authorized'].includes(resolved.status),
      `ac8 ${storyId} must resolve to a known authority status, never silently effective`);
    if (GRANDFATHERED_OVERRIDE_DIGESTS[storyId] === computeBudgetOverrideDigest(storyId, override)) {
      pinned.push(storyId);
      assert.equal(resolved.status, 'grandfathered',
        `ac7 ${storyId} is pinned by digest and must stay grandfathered`);
      const edited = resolveBudgetOverrideAuthority({
        storyId, override: { ...override, max_subagent_count: 9999 }, decisions: []
      });
      assert.equal(edited.status, 'unauthorized',
        `ac7 ${storyId} must lose grandfathering when its content is edited`);
    }
  }
  // RR-004: this couples the test to the frozen map's size, so amending or
  // retiring one of the pinned overrides reddens it until the pin is removed in
  // the same commit. That coupling is deliberate -- a stale pin is exactly what
  // would silently re-grandfather an edited override -- and it fails safe: it
  // can only over-report, never widen a budget or hide an inert override.
  assert.equal(pinned.length, Object.keys(GRANDFATHERED_OVERRIDE_DIGESTS).length,
    'ac7 every pinned digest must correspond to a configured override, with no stale map entry');
});

// GE-005: the absent leg of the state machine was claimed but never asserted.
test('ac:1 the absent state is asserted, not just unauthorized', () => {
  const config = { budgets: { delivery_efficiency: { max_subagent_count: 6 } } };
  const resolved = resolveEfficiencyPolicyDecision(config, 'story-with-no-override', { decisions: [] });
  assert.equal(resolved.override.status, 'absent',
    'ac1 a Story with no configured override resolves absent, distinct from unauthorized');
  assert.equal(resolved.override.digest, null);
  assert.equal(resolved.policy.max_subagent_count, 6);
});

// GE-002: the bare agent_system self-grant form was named in the AC but untested.
test('ac:5 a grantor equal to the bare agent_system is a self-grant', () => {
  const digest = computeBudgetOverrideDigest(STORY_ID, OVERRIDE);
  const resolved = resolveBudgetOverrideAuthority({
    storyId: STORY_ID,
    override: OVERRIDE,
    decisions: [{
      story_id: STORY_ID, status: 'accepted', source: `budget:delivery_efficiency:${STORY_ID}`,
      reason: 'raise needed',
      budget_approval: {
        story_id: STORY_ID, override_digest: digest, grantor_kind: 'human',
        grantor: 'claude_code', recorded_by: { agent_system: 'claude_code', agent_id: 'agent-x' }
      }
    }]
  });
  assert.equal(resolved.status, 'unauthorized');
  assert.ok(resolved.reasons.includes('self_approved'),
    'ac5 naming the recording agent_system as grantor is a self-grant, like agent_id and system:id');
});

test('ac:9 an unauthorized override is reported as efficiency debt', () => {
  const debt = summarizeEfficiencyDebt({
    correctness_ready: true,
    budget_override: { status: 'unauthorized', reasons: ['self_approved'] }
  });
  assert.equal(debt.has_efficiency_debt, true,
    'ac9 an unauthorized override must register as efficiency debt');
  assert.deepEqual(debt.debt, [{ kind: 'budget_override_unauthorized', reasons: ['self_approved'] }],
    'ac9 the debt entry names budget_override_unauthorized and carries its reasons');
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
  const required = [
    ['--reason', /requires --reason/],
    ['--budget-grantor', /--budget-grantor/],
    ['--budget-grantor-kind', /grantor kind must be one of/],
    ['--agent-system', /--agent-system/],
    ['--agent-id', /--agent-id/]
  ];
  const rejected = [];
  for (const [flag, pattern] of required) {
    try {
      await execFileAsync(process.execPath, omit(flag));
    } catch (error) {
      if (pattern.test(`${error.stderr ?? ''}${error.stdout ?? ''}${error.message}`)) rejected.push(flag);
    }
  }
  assert.equal(rejected.length, required.length,
    'ac11 budget approval requires --reason, --budget-grantor, --budget-grantor-kind, --agent-system and --agent-id; omitting a required flag must fail');
  assert.deepEqual(rejected, ['--reason', '--budget-grantor', '--budget-grantor-kind', '--agent-system', '--agent-id'],
    'ac11 each omitted required approval flag is rejected with its own specific error');
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
