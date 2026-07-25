import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyGateOutcomeClassifications,
  buildGateOutcomeClassificationBacklog,
  classifyGateOutcome,
  getGateOutcomeLedgerPath,
  getCentralGateOutcomeLedgerPath,
  normalizeResolvingDiffFiles,
  parseGateOutcomeOverrides,
  recordResolvedGateOutcomes,
  summarizeGateRoi
} from '../src/gate-outcome-ledger.js';
import { createUsageReport, renderUsageReport } from '../src/usage-report.js';
import { runCli } from '../src/cli.js';

async function runCliCapturingStdout(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write(chunk) { stdout += chunk; } },
    stderr: { write(chunk) { stderr += chunk; } }
  });
  return { ...result, stdout, stderr };
}

// runCli reports usage errors as exit code 1 plus a stderr message rather than
// by rejecting, so failing closed is asserted on that pair.
async function assertCliRejects(args, pattern) {
  const result = await runCliCapturingStdout(args);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, pattern);
}

function dagWith(node) {
  return { story_id: 'story-goc', nodes: [node] };
}

test('GOC-S-1 derives waiver from an accepted_followup resolution without a decision record', () => {
  const result = classifyGateOutcome({
    previousGate: { id: 'gate:judgment_axis_release_ops', status: 'block' },
    gate: { id: 'gate:judgment_axis_release_ops', status: 'accepted_followup' },
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(result.outcome, 'waiver');
  assert.equal(result.reason, 'resolved_as_accepted_followup');
  assert.equal(result.overridden, false);
});

test('GOC-S-1 derives evidence_added from a gate node evidence surface that grew', () => {
  const previousGate = {
    id: 'gate:definition_of_done',
    type: 'definition_of_done_gate',
    status: 'needs_evidence',
    definition_items: [{ id: 'current_head_verification', evidence: [] }]
  };
  const gate = {
    id: 'gate:definition_of_done',
    type: 'definition_of_done_gate',
    status: 'passed',
    definition_items: [{
      id: 'current_head_verification',
      evidence: [{ type: 'verification_command', artifact: '.vibepro/verify-artifacts/targeted.xml' }]
    }]
  };
  const result = classifyGateOutcome({
    previousGate,
    gate,
    // A source diff is present, but definition_of_done is not source-sensitive:
    // before this rule the entry fell through to unclassified.
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(result.outcome, 'evidence_added');
  assert.equal(result.reason, 'gate_node_evidence_surface_expanded');
  assert.deepEqual(result.evidence_refs, [{
    kind: 'gate_node_evidence',
    gate_evidence: 'definition_item_evidence',
    ref: '.vibepro/verify-artifacts/targeted.xml'
  }]);
});

test('GOC-S-1 an unchanged gate node evidence surface is not counted as new evidence', () => {
  const node = (status) => ({
    id: 'gate:responsibility_authority',
    status,
    matched_responsibilities: [{ id: 'vibepro.cost', evidence_status: 'passed' }]
  });
  const result = classifyGateOutcome({
    previousGate: node('needs_evidence'),
    gate: node('passed'),
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(result.outcome, 'unclassified');
  assert.equal(result.reason, 'ambiguous_resolution_surface');
});

// Review finding: judgment-axis matched_evidence is derived from the diff shape
// itself (src/pr-manager.js classifySeniorAxisEvidence adds "story/spec docs in
// diff"), so counting it let a documentation-only resolution be recorded as
// evidence_added and deflate the rewording_only_rate that drives gate demotion.
test('GOC-S-1 diff-shape-derived judgment axis evidence never turns a doc-only resolution into evidence_added', () => {
  const result = classifyGateOutcome({
    previousGate: {
      id: 'gate:judgment_axis_release_ops',
      status: 'needs_evidence',
      matched_evidence: []
    },
    gate: {
      id: 'gate:judgment_axis_release_ops',
      status: 'passed',
      matched_evidence: [{ kind: 'story_spec_traceability', ref: 'story/spec docs in diff' }]
    },
    git: { changed_files: [{ path: 'docs/management/stories/active/story-a.md' }] }
  });
  assert.equal(result.outcome, 'rewording_only');
  assert.equal(result.reason, 'resolving_diff_contains_only_documentation_or_story_text');
});

// Review finding: excluding build-output directories downgraded a genuine
// source_fix in repositories that track dist/ or coverage/.
test('GOC-S-1 tracked build output still counts as a source change', () => {
  assert.deepEqual(
    normalizeResolvingDiffFiles({ changed_files: [{ path: 'dist/bundle.js' }, { path: 'coverage/lcov-report/app.js' }] }),
    ['dist/bundle.js', 'coverage/lcov-report/app.js']
  );
  assert.equal(classifyGateOutcome({
    gate: { id: 'gate:unit', status: 'passed' },
    git: { changed_files: [{ path: 'dist/bundle.js' }] }
  }).outcome, 'source_fix');
  assert.equal(classifyGateOutcome({
    gate: { id: 'gate:unit', status: 'passed' },
    git: { changed_files: [{ path: 'dist/bundle.js' }, { path: 'docs/a.md' }] }
  }).outcome, 'source_fix');
});

// Review finding: the gate-node-evidence rule sits before source_fix, so a
// source-sensitive gate that also grew real node evidence must not be shadowed
// away from source_fix by an implicit coupling to isSourceResolutionCandidate.
test('GOC-S-1 a source-sensitive gate with a real node evidence delta is not shadowed away from evidence_added', () => {
  const result = classifyGateOutcome({
    previousGate: { id: 'gate:custom_build', status: 'needs_evidence', evidence: [] },
    gate: { id: 'gate:custom_build', status: 'passed', evidence: ['artifact/x.log'] },
    git: { changed_files: [{ path: 'src/a.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  assert.equal(result.outcome, 'evidence_added');
  assert.equal(result.reason, 'gate_node_evidence_surface_expanded');
  assert.deepEqual(result.evidence_refs, [{
    kind: 'gate_node_evidence',
    gate_evidence: 'evidence',
    ref: 'artifact/x.log'
  }]);
});

test('GOC-S-1 workspace-internal paths and directory markers do not defeat rewording_only', () => {
  assert.deepEqual(
    normalizeResolvingDiffFiles({
      changed_files: [
        { path: 'docs/management/stories/active/story-a.md' },
        { path: '.worktrees/story-b/' },
        { path: '.vibepro/pr/story-a/design-ssot.json' }
      ]
    }),
    ['docs/management/stories/active/story-a.md']
  );

  const result = classifyGateOutcome({
    gate: { id: 'gate:definition_of_done', status: 'not_required' },
    git: {
      changed_files: [
        { path: 'docs/management/stories/active/story-a.md' },
        { path: '.worktrees/story-b/' },
        { path: '.vibepro/pr/story-a/design-ssot.json' }
      ]
    }
  });
  assert.equal(result.outcome, 'rewording_only');
});

test('GOC-S-1/2 gate-scoped operator input wins over the repo-wide fallback', () => {
  const overrides = parseGateOutcomeOverrides(['rewording_only', 'gate:unit=source_fix']);
  assert.equal(overrides.global, 'rewording_only');
  assert.equal(overrides.by_gate.get('gate:unit'), 'source_fix');

  assert.equal(classifyGateOutcome({ overrides, gate: { id: 'gate:unit' } }).outcome, 'source_fix');
  assert.equal(classifyGateOutcome({ overrides, gate: { id: 'gate:other' } }).outcome, 'rewording_only');
  assert.equal(classifyGateOutcome({ overrides, gate: { id: 'gate:unit' } }).overridden, true);

  assert.throws(() => parseGateOutcomeOverrides(['gate:unit=typo']), /gate outcome must be one of/);
});

test('GOC-S-2 pr prepare recording surfaces a classification backlog and its next_command', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-backlog-'));
  const result = await recordResolvedGateOutcomes(repo, {
    storyId: 'story-goc',
    previousGateDag: dagWith({ id: 'gate:senior_gap_judgment', status: 'needs_evidence', required: true }),
    currentGateDag: dagWith({ id: 'gate:senior_gap_judgment', status: 'passed', required: true }),
    previousPrepareCreatedAt: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-25T00:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });

  assert.equal(result.status, 'recorded');
  assert.equal(result.entries[0].outcome, 'unclassified');
  assert.equal(result.classification.status, 'classification_input_required');
  assert.equal(result.classification.recorded_count, 1);
  assert.equal(result.classification.newly_unclassified_count, 1);
  assert.equal(result.classification.classified_count, 0);
  assert.equal(result.classification.story_unclassified_count, 1);
  assert.deepEqual(result.classification.pending.map((item) => item.gate_id), ['gate:senior_gap_judgment']);
  assert.match(result.classification.next_command, /vibepro pr classify \./);
  assert.match(result.classification.next_command, /--outcome gate:senior_gap_judgment=/);
});

test('GOC-S-2 an operator-supplied outcome is never queued for input again', () => {
  const backlog = buildGateOutcomeClassificationBacklog([
    { entry_key: 'a', gate_id: 'gate:a', outcome: 'unclassified', overridden: true },
    { entry_key: 'b', gate_id: 'gate:b', outcome: 'source_fix', overridden: false },
    { entry_key: 'c', gate_id: 'gate:c', outcome: 'unclassified', overridden: false }
  ], { storyId: 'story-goc' });
  assert.equal(backlog.newly_unclassified_count, 1);
  assert.equal(backlog.classified_count, 2);
  assert.deepEqual(backlog.pending.map((item) => item.gate_id), ['gate:c']);
  assert.deepEqual(backlog.classification_outcomes, ['source_fix', 'evidence_added', 'rewording_only', 'waiver']);
});

test('GOC-S-2 pr classify applies operator input to pending ledger entries only', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-classify-'));
  await recordResolvedGateOutcomes(repo, {
    storyId: 'story-goc',
    previousGateDag: {
      story_id: 'story-goc',
      nodes: [
        { id: 'gate:unit', status: 'needs_evidence', required: true },
        { id: 'gate:senior_gap_judgment', status: 'needs_review', required: true }
      ]
    },
    currentGateDag: {
      story_id: 'story-goc',
      nodes: [
        { id: 'gate:unit', status: 'passed', required: true },
        { id: 'gate:senior_gap_judgment', status: 'passed', required: true }
      ]
    },
    previousPrepareCreatedAt: '2026-07-24T00:00:00.000Z',
    createdAt: '2026-07-25T00:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });

  const applied = await applyGateOutcomeClassifications(repo, {
    storyId: 'story-goc',
    outcomes: ['gate:senior_gap_judgment=evidence_added', 'gate:absent=source_fix'],
    note: 'adjudication verdicts recorded',
    recordedAt: '2026-07-25T02:00:00.000Z'
  });

  assert.equal(applied.status, 'classified');
  assert.equal(applied.updated_count, 1);
  assert.deepEqual(applied.updated[0], {
    entry_key: applied.updated[0].entry_key,
    gate_id: 'gate:senior_gap_judgment',
    previous_outcome: 'unclassified',
    outcome: 'evidence_added'
  });
  assert.deepEqual(applied.unmatched_gate_ids, ['gate:absent']);
  assert.equal(applied.remaining_unclassified_count, 0);

  const ledger = JSON.parse(await readFile(getGateOutcomeLedgerPath(repo), 'utf8'));
  const classified = ledger.entries.find((entry) => entry.gate_id === 'gate:senior_gap_judgment');
  assert.equal(classified.outcome, 'evidence_added');
  assert.equal(classified.classification, 'operator_classification_input');
  assert.equal(classified.overridden, true);
  assert.equal(classified.classification_note, 'adjudication verdicts recorded');
  assert.equal(classified.schema_version, '0.1.0');
  // gate:unit is source-sensitive, so it was already derived and must be left alone.
  assert.equal(ledger.entries.find((entry) => entry.gate_id === 'gate:unit').outcome, 'source_fix');

  const rerun = await applyGateOutcomeClassifications(repo, {
    storyId: 'story-goc',
    outcomes: ['gate:senior_gap_judgment=waiver']
  });
  assert.equal(rerun.status, 'no_matching_entries');
  assert.equal(rerun.updated_count, 0);
});

// Review finding: the pr classify CLI surface is the only closure path for
// GOC-S-2 and had no automated cover.
test('GOC-S-2 the pr classify CLI closes pending entries and fails closed on a repo-wide outcome', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-cli-'));
  await recordResolvedGateOutcomes(repo, {
    storyId: 'story-goc',
    previousGateDag: dagWith({ id: 'gate:senior_gap_judgment', status: 'needs_evidence', required: true }),
    currentGateDag: dagWith({ id: 'gate:senior_gap_judgment', status: 'passed', required: true }),
    createdAt: '2026-07-25T00:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });

  // A repo-wide outcome would stamp every pending entry at once and is refused.
  await assertCliRejects(
    ['pr', 'classify', repo, '--story-id', 'story-goc', '--outcome', 'source_fix'],
    /requires gate-scoped outcomes/
  );
  await assertCliRejects(
    ['pr', 'classify', repo, '--story-id', 'story-goc'],
    /requires at least one --outcome/
  );

  const classified = await runCliCapturingStdout([
    'pr', 'classify', repo, '--story-id', 'story-goc',
    '--outcome', 'gate:senior_gap_judgment=evidence_added', '--json'
  ]);
  const payload = JSON.parse(classified.stdout);
  assert.equal(payload.status, 'classified');
  assert.equal(payload.updated_count, 1);
  assert.equal(payload.remaining_unclassified_count, 0);
  assert.equal(payload.promotion_scope.scope, 'local_ledger_only');
  assert.equal(payload.ledger_model_status.status, 'ok');

  const text = await runCliCapturingStdout([
    'pr', 'classify', repo, '--story-id', 'story-goc',
    '--outcome', 'gate:senior_gap_judgment=waiver'
  ]);
  assert.match(text.stdout, /no_matching_entries/);
});

// Review finding: a foreign-model ledger was reduced to empty and reported
// identically to "nothing left to classify".
test('GOC-S-2 a foreign-model ledger is reported as unreadable rather than as nothing to classify', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-legacy-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v1',
    entries: [{ entry_key: 'legacy', story_id: 'story-goc', gate_id: 'gate:unit', outcome: 'unclassified', resolved_at: '2026-07-01T00:00:00.000Z' }]
  }, null, 2)}\n`);

  const applied = await applyGateOutcomeClassifications(repo, {
    storyId: 'story-goc',
    outcomes: ['gate:unit=source_fix']
  });
  assert.equal(applied.status, 'ledger_model_not_readable');
  assert.equal(applied.ledger_model_status.status, 'foreign_model');
  assert.equal(applied.ledger_model_status.model, 'vibepro-gate-outcome-ledger-v1');
  assert.equal(applied.updated_count, 0);

  // The unreadable ledger must be left byte-identical, not overwritten.
  const after = JSON.parse(await readFile(ledgerPath, 'utf8'));
  assert.equal(after.model, 'vibepro-gate-outcome-ledger-v1');
  assert.equal(after.entries.length, 1);
});

// Review finding: an out-of-range threshold silently disabled the GOC-S-3
// breach signal, and both options no-oped without --gate-roi.
test('GOC-S-3 gate ROI threshold options fail closed instead of silently disabling the signal', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-threshold-'));
  await assertCliRejects(
    ['usage', 'report', repo, '--gate-roi', '--unclassified-threshold', '1.5'],
    /--unclassified-threshold must be between 0 and 1/
  );
  await assertCliRejects(
    ['usage', 'report', repo, '--gate-roi', '--unclassified-min-sample', '0'],
    /--unclassified-min-sample must be an integer of at least 1/
  );
  await assertCliRejects(
    ['usage', 'report', repo, '--unclassified-threshold', '0.2'],
    /only applies to the gate ROI report/
  );
});

test('GOC-S-3 gate ROI reports per-gate and per-story unclassified rates with threshold breaches', () => {
  const entries = [
    ...Array.from({ length: 6 }, (unused, index) => ({
      story_id: 'story-noisy',
      gate_id: 'gate:senior_gap_judgment',
      outcome: 'unclassified',
      resolved_at: `2026-07-0${index + 1}T00:00:00.000Z`
    })),
    ...Array.from({ length: 6 }, (unused, index) => ({
      story_id: 'story-clean',
      gate_id: 'gate:unit',
      outcome: 'source_fix',
      resolved_at: `2026-07-0${index + 1}T01:00:00.000Z`
    }))
  ];
  const summary = summarizeGateRoi({ entries });

  assert.equal(summary.entry_count, 12);
  assert.equal(summary.unclassified_count, 6);
  assert.equal(summary.unclassified_rate, 0.5);
  assert.equal(summary.thresholds.unclassified_rate, 0.5);
  assert.equal(summary.thresholds.min_sample, 5);

  const noisyGate = summary.gates.find((gate) => gate.gate_id === 'gate:senior_gap_judgment');
  assert.equal(noisyGate.unclassified_rate, 1);
  const cleanGate = summary.gates.find((gate) => gate.gate_id === 'gate:unit');
  assert.equal(cleanGate.unclassified_rate, 0);
  const noisyStory = summary.stories.find((story) => story.story_id === 'story-noisy');
  assert.equal(noisyStory.unclassified_rate, 1);

  // 0.5 is not > 0.5, so the overall scope must not breach; gate/story do.
  assert.deepEqual(
    summary.unclassified_threshold_breaches.map((breach) => `${breach.scope}:${breach.id}`),
    ['gate:gate:senior_gap_judgment', 'story:story-noisy']
  );

  const belowSample = summarizeGateRoi({
    entries: [{ story_id: 's', gate_id: 'gate:a', outcome: 'unclassified', resolved_at: '2026-07-01T00:00:00.000Z' }]
  });
  assert.deepEqual(belowSample.unclassified_threshold_breaches, []);
});

test('GOC-S-3 usage report --gate-roi carries unclassified breaches into value_signals', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-roi-'));
  const centralPath = getCentralGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(centralPath), { recursive: true });
  await writeFile(centralPath, `${JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: Array.from({ length: 6 }, (unused, index) => ({
      story_id: 'story-noisy',
      gate_id: 'gate:senior_gap_judgment',
      outcome: 'unclassified',
      resolved_at: `2026-07-0${index + 1}T00:00:00.000Z`
    }))
  }, null, 2)}\n`);

  const report = await createUsageReport(repo, { gateRoi: true, language: 'en' });
  assert.equal(report.gate_roi.unclassified_rate, 1);
  assert.equal(report.gate_roi.stories[0].story_id, 'story-noisy');
  assert.equal(report.value_signals.gate_roi_unclassified_count, 6);
  assert.equal(report.value_signals.gate_roi_unclassified_rate, 1);
  assert.equal(report.value_signals.gate_roi_unclassified_breach_count, 3);
  assert.equal(report.value_signals.gate_roi_unclassified_breached_gate_count, 1);
  assert.equal(report.value_signals.gate_roi_unclassified_breached_story_count, 1);

  const rendered = renderUsageReport(report);
  assert.match(rendered, /Per-story:/);
  assert.match(rendered, /Threshold breaches:/);
  assert.match(rendered, /gate_roi_unclassified_breaches: 3/);

  // Without --gate-roi the signal keys stay absent rather than reporting a false zero.
  const withoutRoi = await createUsageReport(repo, { language: 'en' });
  assert.equal(withoutRoi.value_signals.gate_roi_unclassified_count, undefined);
  assert.doesNotMatch(renderUsageReport(withoutRoi), /gate_roi_unclassified_breaches/);
});

test('GOC-S-4 classification keeps the ledger schema, vocabulary, and promotion contract intact', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-goc-contract-'));
  const result = await recordResolvedGateOutcomes(repo, {
    storyId: 'story-goc',
    previousGateDag: dagWith({ id: 'gate:senior_gap_judgment', status: 'needs_evidence', required: true }),
    currentGateDag: dagWith({ id: 'gate:senior_gap_judgment', status: 'passed', required: true }),
    createdAt: '2026-07-25T00:00:00.000Z',
    git: { changed_files: [{ path: 'src/app.js' }] },
    fileGroups: { source: { count: 1 } }
  });
  await applyGateOutcomeClassifications(repo, {
    storyId: 'story-goc',
    outcomes: ['gate:senior_gap_judgment=rewording_only'],
    recordedAt: '2026-07-25T01:00:00.000Z'
  });

  const ledger = JSON.parse(await readFile(getGateOutcomeLedgerPath(repo), 'utf8'));
  assert.equal(ledger.schema_version, '0.1.0');
  assert.equal(ledger.model, 'vibepro-gate-outcome-ledger-v3');
  for (const entry of ledger.entries) {
    assert.equal(entry.schema_version, '0.1.0');
    assert.ok(['source_fix', 'evidence_added', 'rewording_only', 'waiver', 'unclassified'].includes(entry.outcome));
    assert.equal(entry.entry_key, result.entries[0].entry_key);
  }

  // Still promotable through the unchanged execute merge contract.
  const { collectPromotableGateOutcomeEntries, computeCentralLedgerPromotion } =
    await import('../src/gate-outcome-ledger.js');
  const promotable = await collectPromotableGateOutcomeEntries(repo, 'story-goc');
  assert.equal(promotable.length, 1);
  const promotion = computeCentralLedgerPromotion({ localEntries: promotable, centralText: null });
  assert.equal(promotion.status, 'promoted');
  assert.equal(promotion.promoted_count, 1);
  assert.equal(promotion.central_ledger_path, 'docs/management/roi-ledger/ledger.json');
  assert.equal(JSON.parse(promotion.serialized).entries[0].outcome, 'rewording_only');
});
