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

  await execFileAsync('node', [
    CLI_BIN, 'verify', 'record', root,
    '--id', storyId,
    '--kind', 'unit',
    '--status', 'pass',
    '--command', 'echo ok',
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
