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
