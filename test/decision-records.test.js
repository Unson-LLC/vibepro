import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
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
