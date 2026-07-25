import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  getCentralGateOutcomeLedgerPath,
  getGateOutcomeLedgerPath,
  recordResolvedGateOutcomes
} from '../../src/gate-outcome-ledger.js';

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
    // Real production node shapes, taken from a live gate-dag.json: gate:unit
    // carries type verification_gate, which isSourceResolutionCandidate
    // excludes, while gate:artifact_consistency has no evidence-shaped tokens
    // and is genuinely source-sensitive.
    previousGateDag: dagWith([
      { id: 'gate:artifact_consistency', type: 'artifact_consistency_gate', label: 'Artifact Consistency Gate', status: 'needs_evidence', required: true },
      { id: 'gate:unit', type: 'verification_gate', label: 'Unit Gate', status: 'needs_evidence', required: true },
      { id: 'gate:senior_gap_judgment', type: 'senior_gap_judgment_gate', label: 'Senior Gap Judgment Gate', status: 'needs_review', required: true }
    ]),
    currentGateDag: dagWith([
      { id: 'gate:artifact_consistency', type: 'artifact_consistency_gate', label: 'Artifact Consistency Gate', status: 'passed', required: true },
      { id: 'gate:unit', type: 'verification_gate', label: 'Unit Gate', status: 'passed', required: true },
      { id: 'gate:senior_gap_judgment', type: 'senior_gap_judgment_gate', label: 'Senior Gap Judgment Gate', status: 'passed', required: true }
    ]),
    createdAt: '2026-07-25T00:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(recorded.status, 'recorded');
  assert.equal(
    recorded.entries.find((entry) => entry.gate_id === 'gate:artifact_consistency').outcome,
    'source_fix',
    'GOC-S-1 a source-sensitive gate resolved by a source diff is derived automatically'
  );
  // Verification-shaped gates are deliberately NOT source_fix: a passing unit
  // gate does not prove the source diff is what resolved it.
  assert.equal(
    recorded.entries.find((entry) => entry.gate_id === 'gate:unit').outcome,
    'unclassified',
    'GOC-S-1 an evidence-shaped gate is not attributed to the source diff'
  );

  // GOC-S-2 scenario clause e2e: the undecidable entry is reported as a backlog
  // with the exact command that closes it.
  const classification = recorded.classification;
  assert.equal(classification.status, 'classification_input_required');
  assert.equal(classification.newly_unclassified_count, 2);
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
    '--outcome', 'gate:unit=rewording_only',
    '--json'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv });
  const classifyResult = JSON.parse(classified.stdout);
  assert.equal(classifyResult.status, 'classified');
  assert.equal(classifyResult.updated_count, 2);
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
    ['evidence_added', 'rewording_only', 'source_fix']
  );
  for (const entry of ledger.entries) {
    assert.ok(entry.entry_key, 'GOC-S-4 entry_key identity survives classification');
    assert.ok(['source_fix', 'evidence_added', 'rewording_only', 'waiver', 'unclassified'].includes(entry.outcome));
  }

  // GOC-S-3 artifact replay: the residue is measurable per gate and per story
  // through the real usage report binary. --gate-roi reads the CENTRAL ledger,
  // so it is seeded here with the shape execute merge would promote; asserting
  // against an unseeded repo would pass vacuously on empty arrays.
  const centralPath = getCentralGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(centralPath), { recursive: true });
  await writeFile(centralPath, `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: [
      ...Array.from({ length: 6 }, (unused, index) => ({
        entry_key: `noisy|${index}`,
        story_id: 'story-goc-noisy',
        gate_id: 'gate:senior_gap_judgment',
        outcome: 'unclassified',
        resolved_at: `2026-07-0${index + 1}T00:00:00.000Z`
      })),
      ...Array.from({ length: 6 }, (unused, index) => ({
        entry_key: `clean|${index}`,
        story_id: 'story-goc-clean',
        gate_id: 'gate:unit',
        outcome: 'source_fix',
        resolved_at: `2026-07-0${index + 1}T01:00:00.000Z`
      }))
    ]
  }, null, 2)}\n`);

  const report = await execFileAsync(process.execPath, [
    'bin/vibepro.js', 'usage', 'report', repo, '--gate-roi', '--json'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv, maxBuffer: 16 * 1024 * 1024 });
  const parsed = JSON.parse(report.stdout);
  const roi = parsed.gate_roi;
  assert.equal(roi.central_ledger_status, 'ok');
  assert.equal(roi.entry_count, 12);
  assert.equal(roi.unclassified_count, 6);
  assert.equal(roi.unclassified_rate, 0.5);
  assert.equal(roi.gates.find((gate) => gate.gate_id === 'gate:senior_gap_judgment').unclassified_rate, 1);
  assert.equal(roi.gates.find((gate) => gate.gate_id === 'gate:unit').unclassified_rate, 0);
  assert.equal(roi.stories.find((story) => story.story_id === 'story-goc-noisy').unclassified_rate, 1);
  assert.deepEqual(
    roi.unclassified_threshold_breaches.map((breach) => `${breach.scope}:${breach.id}`),
    ['gate:gate:senior_gap_judgment', 'story:story-goc-noisy'],
    'GOC-S-3 gate and story scopes breach while the 0.5 overall rate does not exceed the 0.5 threshold'
  );
  assert.equal(parsed.value_signals.gate_roi_unclassified_breach_count, 2);

  // GOC-S-3 negative path: the threshold options fail closed instead of
  // silently disabling the signal they exist to raise.
  const uncoupled = await execFileAsync(process.execPath, [
    'bin/vibepro.js', 'usage', 'report', repo, '--unclassified-threshold', '0.2'
  ], { cwd: REPO_ROOT, encoding: 'utf8', env: childEnv }).catch((error) => error);
  assert.notEqual(uncoupled.code, 0);
  assert.match(String(uncoupled.stderr), /only applies to the gate ROI report/);
});
