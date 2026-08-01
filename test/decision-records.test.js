import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { recordDecision } from '../src/decision-records.js';
import { recordVerificationEvidence } from '../src/verification-evidence.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

async function makeWorkspaceRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-decision-evidence-summary-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  return root;
}

test('DRES-SCENARIO-001 accepted decision gains a 1-hop verification_evidence_summary from verification-evidence.json', async () => {
  const root = await makeWorkspaceRepo();
  const storyId = 'STR-DRES-1';

  await recordVerificationEvidence(root, {
    storyId,
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit tests pass',
    targets: ['test/decision-records.test.js'],
    scenarios: ['DRES-SCENARIO-001']
  });
  await recordVerificationEvidence(root, {
    storyId,
    kind: 'e2e',
    status: 'pass',
    command: 'npm run test:e2e',
    summary: 'e2e pass',
    targets: ['e2e/decision.spec.ts'],
    scenarios: ['DRES-SCENARIO-001']
  });

  const result = await recordDecision(root, {
    storyId,
    type: 'needs_review',
    summary: 'Accepted after unit + e2e verification passed.',
    status: 'accepted'
  });

  const summary = result.decision.verification_evidence_summary;
  assert.ok(summary, 'expected verification_evidence_summary to be present for an accepted decision');
  assert.equal(summary.count, 2);
  assert.equal(summary.entries.length, 2);
  const byType = Object.fromEntries(summary.entries.map((entry) => [entry.type, entry]));
  assert.equal(byType.unit.result, 'pass');
  assert.equal(byType.e2e.result, 'pass');
  assert.ok(byType.unit.path);
  assert.ok(byType.e2e.path);
});

test('DRES-SCENARIO-002 non-accepted decision has no verification_evidence_summary', async () => {
  const root = await makeWorkspaceRepo();
  const storyId = 'STR-DRES-2';

  await recordVerificationEvidence(root, {
    storyId,
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit tests pass',
    targets: ['test/decision-records.test.js'],
    scenarios: ['DRES-SCENARIO-002']
  });

  const result = await recordDecision(root, {
    storyId,
    type: 'needs_review',
    summary: 'Still under review, not yet accepted.',
    status: 'open'
  });

  assert.equal(result.decision.verification_evidence_summary, null);
});

test('DRES-SCENARIO-003 accepted decision with no verification-evidence.json yet degrades to an empty summary', async () => {
  const root = await makeWorkspaceRepo();
  const storyId = 'STR-DRES-3';

  const result = await recordDecision(root, {
    storyId,
    type: 'waiver',
    reason: 'No verification evidence exists yet for this story.',
    summary: 'Waiver accepted without prior verification runs.',
    status: 'accepted'
  });

  assert.deepEqual(result.decision.verification_evidence_summary, { count: 0, entries: [] });
});

test('DRES-SCENARIO-004 CLI end-to-end: vibepro decision record exposes verification_evidence_summary via --json', async () => {
  const root = await makeWorkspaceRepo();
  const storyId = 'STR-DRES-4';
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'test', 'decision-records.test.js'), "import test from 'node:test';\ntest('DRES-SCENARIO-004', () => {});\n");

  await execFileAsync('node', [
    CLI_BIN, 'verify', 'record', root,
    '--id', storyId,
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'node --test test/decision-records.test.js --test-name-pattern DRES-SCENARIO-004',
    '--summary', 'e2e smoke unit pass'
  ], { encoding: 'utf8' });

  const { stdout } = await execFileAsync('node', [
    CLI_BIN, 'decision', 'record', root,
    '--id', storyId,
    '--type', 'needs_review',
    '--summary', 'e2e smoke accepted decision',
    '--status', 'accepted',
    '--json'
  ], { encoding: 'utf8' });

  const result = JSON.parse(stdout);
  assert.equal(result.decision.status, 'accepted');
  assert.equal(result.decision.verification_evidence_summary.count, 1);
  assert.equal(result.decision.verification_evidence_summary.entries[0].type, 'unit');
  assert.equal(result.decision.verification_evidence_summary.entries[0].result, 'pass');
});

test('DRES-SCENARIO-005 recording a decision refreshes the single active Run Context Capsule', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-decision-capsule-hook-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyId = 'story-decision-capsule-hook';
  const runId = 'run-20260716T020304Z-a1b2c3d4';
  const storyDir = path.join(root, 'docs', 'management', 'stories', 'active');
  await Promise.all([
    mkdir(path.join(root, '.vibepro'), { recursive: true }),
    mkdir(storyDir, { recursive: true })
  ]);
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    `${JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)}\n`
  );
  await writeFile(
    path.join(storyDir, `${storyId}.md`),
    `---\nstory_id: ${storyId}\ntitle: Decision capsule hook\nstatus: active\n---\n\n# Decision capsule hook\n\n**So that** decision context survives restart\n`
  );
  await execFileAsync('git', ['init', root]);
  await execFileAsync('git', ['-C', root, 'config', 'user.email', 'capsule@example.test']);
  await execFileAsync('git', ['-C', root, 'config', 'user.name', 'Capsule Test']);
  await execFileAsync('git', ['-C', root, 'add', 'docs']);
  await execFileAsync('git', ['-C', root, 'commit', '-m', 'test: seed decision capsule hook']);
  const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', 'HEAD']);
  const runDir = path.join(root, '.vibepro', 'executions', storyId, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    status: 'running',
    attempt: 1,
    iteration: 0,
    current_head_sha: stdout.trim(),
    execution_context: { authority_kind: 'repository', root_realpath: root },
    transitions: [{ sequence: 1, from: null, to: 'running', reason: 'run_created' }]
  }, null, 2)}\n`);

  await recordDecision(root, {
    storyId,
    type: 'needs_review',
    summary: 'Choose the handoff owner.',
    status: 'open'
  });

  const capsule = JSON.parse(await readFile(path.join(runDir, 'context-capsule.json'), 'utf8'));
  assert.ok(capsule.open_decisions.some((decision) => decision.prompt === 'Choose the handoff owner.'));
  assert.ok(capsule.source_fingerprints.some((source) => source.kind === 'decisions'));
});

// OGB-S-10 ... OGB-S-12: the write side of the budget-approval grant. The digest
// is read out of .vibepro/config.json here rather than accepted from the caller,
// so an approval always binds to the limits that are actually configured.
async function makeBudgetWorkspaceRepo(storyId, override) {
  const root = await makeWorkspaceRepo();
  await writeFile(
    path.join(root, '.vibepro', 'config.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      budgets: {
        delivery_efficiency: { max_subagent_count: 6 },
        delivery_efficiency_by_story: { [storyId]: override }
      }
    }, null, 2)
  );
  return root;
}

test('OGB-S-10 budget approval computes the override digest from config, not from caller input', async () => {
  const storyId = 'story-ogb-write';
  const override = { max_subagent_count: 9, amendment_reason: 'one extra repair round' };
  const root = await makeBudgetWorkspaceRepo(storyId, override);

  const { decision } = await recordDecision(root, {
    storyId,
    type: 'waiver',
    status: 'accepted',
    source: `budget:delivery_efficiency:${storyId}`,
    summary: 'owner approved raising the Story subagent cap to 9',
    reason: 'owner approved the raise on 2026-07-27',
    budgetGrantor: 'sato-keigo',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-ogb-1',
    overrideDigest: 'attacker-supplied-digest'
  });

  const { computeBudgetOverrideDigest, resolveBudgetOverrideAuthority } =
    await import('../src/budget-override-authority.js');
  assert.equal(decision.budget_approval.override_digest, computeBudgetOverrideDigest(storyId, override));
  assert.notEqual(decision.budget_approval.override_digest, 'attacker-supplied-digest');
  assert.equal(decision.budget_approval.grantor, 'sato-keigo');
  assert.deepEqual(decision.budget_approval.recorded_by, { agent_system: 'claude_code', agent_id: 'agent-ogb-1' });

  assert.equal(resolveBudgetOverrideAuthority({ storyId, override, decisions: [decision] }).status, 'authorized');
});

test('OGB-S-11 budget approval refuses a self-grant and an unidentified recorder', async () => {
  const storyId = 'story-ogb-self';
  const root = await makeBudgetWorkspaceRepo(storyId, { max_subagent_count: 9, amendment_reason: 'raise' });
  const base = {
    storyId,
    type: 'waiver',
    status: 'accepted',
    source: `budget:delivery_efficiency:${storyId}`,
    summary: 'raise the cap',
    reason: 'the run needs more lifecycles',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-ogb-2'
  };

  await assert.rejects(
    recordDecision(root, { ...base, budgetGrantor: 'agent-ogb-2' }),
    /grantor must differ from the recording agent/
  );
  await assert.rejects(
    recordDecision(root, { ...base, budgetGrantor: 'sato-keigo', agentId: undefined }),
    /--agent-id/
  );
  await assert.rejects(
    recordDecision(root, { ...base, budgetGrantor: 'sato-keigo', reason: undefined }),
    /requires --reason/
  );
});

test('OGB-S-12 budget approval requires a configured override and a matching story id', async () => {
  const storyId = 'story-ogb-missing';
  const root = await makeWorkspaceRepo();
  await writeFile(
    path.join(root, '.vibepro', 'config.json'),
    JSON.stringify({ schema_version: '0.1.0', budgets: { delivery_efficiency: { max_subagent_count: 6 } } }, null, 2)
  );
  const base = {
    storyId,
    type: 'waiver',
    status: 'accepted',
    summary: 'raise the cap',
    reason: 'the run needs more lifecycles',
    budgetGrantor: 'sato-keigo',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-ogb-3'
  };

  await assert.rejects(
    recordDecision(root, { ...base, source: `budget:delivery_efficiency:${storyId}` }),
    /found no delivery_efficiency_by_story override/
  );
  await assert.rejects(
    recordDecision(root, { ...base, source: 'budget:delivery_efficiency:story-other' }),
    /does not match --id/
  );
  await assert.rejects(
    recordDecision(root, { ...base, source: 'gate:agent_review' }),
    /budget approval flags require --source/
  );
});

// BGT-S-1 ... BGT-S-5: the tracked mirror of a budget grant. The workspace
// decision store is gitignored, so the grant must also land in
// docs/management/decisions/ where a PR reviewer sees it in the diff.
function budgetGrantOptions(storyId, overrides = {}) {
  return {
    storyId,
    type: 'waiver',
    status: 'accepted',
    source: `budget:delivery_efficiency:${storyId}`,
    summary: 'owner approved raising the Story subagent cap',
    reason: 'owner approved the raise for the closure sequence',
    budgetGrantor: 'sato-keigo',
    budgetGrantorKind: 'human',
    agentSystem: 'claude_code',
    agentId: 'agent-bgt-1',
    ...overrides
  };
}

test('BGT-S-1/S-2 a budget grant writes a tracked decision document cross-referenced from budget_approval', async () => {
  const storyId = 'story-bgt-doc';
  const override = { max_subagent_count: 9, amendment_reason: 'one extra round' };
  const root = await makeBudgetWorkspaceRepo(storyId, override);

  const { decision } = await recordDecision(root, budgetGrantOptions(storyId));

  const docPath = decision.budget_approval.decision_doc;
  assert.ok(docPath, 'expected budget_approval.decision_doc to be set');
  assert.match(docPath, /^docs\/management\/decisions\/\d{4}-\d{2}-\d{2}-budget-override-story-bgt-doc-[0-9a-f]{8}\.md$/);
  const doc = await readFile(path.join(root, docPath), 'utf8');
  assert.match(doc, /type: budget_override_approval/);
  assert.match(doc, new RegExp(`decision_id: ${decision.decision_id}`));
  assert.match(doc, /approver: sato-keigo/);
  assert.match(doc, /approver_kind: human/);
  assert.match(doc, new RegExp(`override_digest: ${decision.budget_approval.override_digest}`));
  assert.match(doc, new RegExp(`approved_at: ${decision.recorded_at}`));
  assert.match(doc, /agent_id: agent-bgt-1/);
  assert.match(doc, /owner approved the raise for the closure sequence/);
});

test('BGT-S-3 a budget grant fails when the tracked document path is gitignored', async () => {
  const storyId = 'story-bgt-ignored';
  const root = await makeBudgetWorkspaceRepo(storyId, { max_subagent_count: 9, amendment_reason: 'raise' });
  await execFileAsync('git', ['init'], { cwd: root });
  await writeFile(path.join(root, '.gitignore'), 'docs/\n');

  await assert.rejects(
    recordDecision(root, budgetGrantOptions(storyId)),
    /gitignored.*reviewable in the PR diff/s
  );
  const records = await readFile(path.join(root, '.vibepro', 'pr', storyId, 'decision-records.json'), 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => null);
  assert.equal(records, null, 'expected no workspace record when the tracked mirror cannot be written');
});

test('BGT-S-4 a decision without a budget grant writes no tracked document', async () => {
  const root = await makeWorkspaceRepo();
  const { decision } = await recordDecision(root, {
    storyId: 'story-bgt-plain',
    type: 'needs_review',
    summary: 'plain decision',
    status: 'accepted'
  });
  assert.equal(decision.budget_approval, null);
  const docsDirError = await readFile(path.join(root, 'docs')).catch((error) => error.code);
  assert.equal(docsDirError, 'ENOENT', 'expected no docs/ directory to be created');
});

test('BGT-S-5 same digest overwrites the same document; a changed budget produces a new file', async () => {
  const storyId = 'story-bgt-digest';
  const override = { max_subagent_count: 9, amendment_reason: 'first raise' };
  const root = await makeBudgetWorkspaceRepo(storyId, override);

  const first = await recordDecision(root, budgetGrantOptions(storyId));
  const second = await recordDecision(root, budgetGrantOptions(storyId));
  assert.equal(first.decision.budget_approval.decision_doc, second.decision.budget_approval.decision_doc);

  await writeFile(
    path.join(root, '.vibepro', 'config.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      budgets: {
        delivery_efficiency: { max_subagent_count: 6 },
        delivery_efficiency_by_story: { [storyId]: { max_subagent_count: 12, amendment_reason: 'second raise' } }
      }
    }, null, 2)
  );
  const third = await recordDecision(root, budgetGrantOptions(storyId));
  assert.notEqual(third.decision.budget_approval.decision_doc, first.decision.budget_approval.decision_doc);
  assert.ok(await readFile(path.join(root, first.decision.budget_approval.decision_doc), 'utf8'));
  assert.ok(await readFile(path.join(root, third.decision.budget_approval.decision_doc), 'utf8'));
});
