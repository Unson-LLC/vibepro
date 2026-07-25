import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getGateOutcomeLedgerPath, recordResolvedGateOutcomes } from '../../src/gate-outcome-ledger.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function dagWith(nodes) {
  return { story_id: 'story-goc-e2e', nodes };
}

// GOC-S-1..GOC-S-4 scenario clause e2e: drives the real vibepro binary through
// the whole classification loop (derive -> report backlog -> operator answers ->
// residue measured) instead of calling the library functions directly, so a
// regression in the CLI wiring, the artifact replay, or the reporting surfaces
// fails here even when the unit-scope assertions still pass.
test('story-vibepro-gate-outcome-classification-coverage GOC-S-1 through GOC-S-4 workflow replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-e2e-'));

  // GOC-S-1 scenario clause e2e: a source-sensitive gate is derived without any
  // operator input, while a judgment gate on the same diff stays undecidable.
  const recorded = await recordResolvedGateOutcomes(repo, {
    storyId: 'story-goc-e2e',
    previousGateDag: dagWith([
      { id: 'gate:unit', status: 'needs_evidence', required: true },
      { id: 'gate:senior_gap_judgment', status: 'needs_review', required: true }
    ]),
    currentGateDag: dagWith([
      { id: 'gate:unit', status: 'passed', required: true },
      { id: 'gate:senior_gap_judgment', status: 'passed', required: true }
    ]),
    createdAt: '2026-07-25T00:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(recorded.status, 'recorded');
  assert.equal(
    recorded.entries.find((entry) => entry.gate_id === 'gate:unit').outcome,
    'source_fix',
    'GOC-S-1 a source-sensitive gate resolved by a source diff is derived automatically'
  );

  // GOC-S-2 scenario clause e2e: the undecidable entry is reported as a backlog
  // with the exact command that closes it.
  const classification = recorded.classification;
  assert.equal(classification.status, 'classification_input_required');
  assert.equal(classification.newly_unclassified_count, 1);
  assert.match(classification.next_command, /vibepro pr classify \./);
  assert.match(classification.next_command, /--outcome gate:senior_gap_judgment=/);

  // GOC-S-2 flow replay: the operator answers through the real CLI binary.
  const bareOutcome = await execFileAsync(process.execPath, [
    'bin/vibepro.js', 'pr', 'classify', repo,
    '--story-id', 'story-goc-e2e',
    '--outcome', 'source_fix'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv }).catch((error) => error);
  assert.notEqual(bareOutcome.code, 0, 'GOC-S-2 a repo-wide outcome is refused rather than bulk-stamping every pending entry');
  assert.match(String(bareOutcome.stderr), /requires gate-scoped outcomes/);

  const classified = await execFileAsync(process.execPath, [
    'bin/vibepro.js', 'pr', 'classify', repo,
    '--story-id', 'story-goc-e2e',
    '--outcome', 'gate:senior_gap_judgment=evidence_added',
    '--json'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv });
  const classifyResult = JSON.parse(classified.stdout);
  assert.equal(classifyResult.status, 'classified');
  assert.equal(classifyResult.updated_count, 1);
  assert.equal(classifyResult.remaining_unclassified_count, 0);
  assert.equal(classifyResult.promotion_scope.scope, 'local_ledger_only');

  // GOC-S-4 artifact replay: the persisted ledger artifact still satisfies the
  // unchanged schema, model, vocabulary and entry_key contract after the
  // operator classification was applied.
  const ledger = JSON.parse(await readFile(getGateOutcomeLedgerPath(repo), 'utf8'));
  assert.equal(ledger.schema_version, '0.1.0');
  assert.equal(ledger.model, 'vibepro-gate-outcome-ledger-v3');
  assert.deepEqual(
    ledger.entries.map((entry) => entry.outcome).sort(),
    ['evidence_added', 'source_fix']
  );
  for (const entry of ledger.entries) {
    assert.ok(entry.entry_key, 'GOC-S-4 entry_key identity survives classification');
    assert.ok(['source_fix', 'evidence_added', 'rewording_only', 'waiver', 'unclassified'].includes(entry.outcome));
  }

  // GOC-S-3 artifact replay: the classified residue is measurable per gate and
  // per story through the real usage report binary.
  const report = await execFileAsync(process.execPath, [
    'bin/vibepro.js', 'usage', 'report', repo, '--gate-roi', '--json'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv, maxBuffer: 16 * 1024 * 1024 });
  const roi = JSON.parse(report.stdout).gate_roi;
  assert.ok(roi, 'GOC-S-3 usage report --gate-roi emits a gate ROI section');
  assert.ok(Array.isArray(roi.gates) && Array.isArray(roi.stories), 'GOC-S-3 reports per-gate and per-story rows');
  assert.equal(typeof roi.unclassified_rate, 'number');
  assert.equal(typeof roi.thresholds.unclassified_rate, 'number');
  assert.ok(Array.isArray(roi.unclassified_threshold_breaches));

  // GOC-S-3 negative path: the threshold options fail closed instead of
  // silently disabling the signal they exist to raise.
  const uncoupled = await execFileAsync(process.execPath, [
    'bin/vibepro.js', 'usage', 'report', repo, '--unclassified-threshold', '0.2'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv }).catch((error) => error);
  assert.notEqual(uncoupled.code, 0);
  assert.match(String(uncoupled.stderr), /only applies to the gate ROI report/);
});
