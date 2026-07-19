import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH,
  collectPromotableGateOutcomeEntries,
  computeCentralLedgerPromotion,
  getGateOutcomeLedgerPath,
  readCentralGateOutcomeLedger,
  readPromotableGateOutcomeEntries,
  serializeCentralGateOutcomeLedger,
  summarizeGateRoi
} from '../src/gate-outcome-ledger.js';
import { createUsageReport } from '../src/usage-report.js';
import { applyDecisionOutcomeBinding, buildDecisionOutcomeBinding } from '../src/merge-manager.js';

function entry(overrides = {}) {
  return {
    schema_version: '0.1.0',
    entry_key: 'story-x|gate:requirement|needs_review|passed|prev|curr',
    story_id: 'story-x',
    gate_id: 'gate:requirement',
    previous_status: 'needs_review',
    resolved_status: 'passed',
    outcome: 'source_fix',
    classification: 'resolving_diff_contains_source_changes',
    resolved_at: '2026-07-07T00:00:00.000Z',
    ...overrides
  };
}

function centralText(entries) {
  return JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    updated_at: null,
    entries
  }, null, 2);
}

test('RML-S-1: promotion moves all local entries into an empty central ledger', () => {
  const localEntries = [
    entry({ entry_key: 'k1', gate_id: 'gate:a' }),
    entry({ entry_key: 'k2', gate_id: 'gate:b' })
  ];
  const result = computeCentralLedgerPromotion({ localEntries, centralText: null });
  assert.equal(result.status, 'promoted');
  assert.equal(result.promoted_count, 2);
  assert.equal(result.duplicate_count, 0);
  assert.equal(result.central_ledger_path, CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
  const parsed = JSON.parse(result.serialized);
  assert.equal(parsed.entries.length, 2);
  assert.deepEqual(parsed.entries.map((e) => e.entry_key), ['k1', 'k2']);
});

test('RML-S-2: re-running promotion dedupes by entry_key and does not grow the ledger', () => {
  const localEntries = [entry({ entry_key: 'k1' }), entry({ entry_key: 'k2' })];
  const first = computeCentralLedgerPromotion({ localEntries, centralText: null });
  const second = computeCentralLedgerPromotion({ localEntries, centralText: first.serialized });
  assert.equal(second.status, 'promoted');
  assert.equal(second.promoted_count, 0);
  assert.equal(second.duplicate_count, 2);
  const parsed = JSON.parse(second.serialized);
  assert.equal(parsed.entries.length, 2);
  // The existing entry wins: bytes unchanged on the idempotent re-run.
  assert.equal(second.serialized, first.serialized);
});

test('RML-S-2: existing central entry is kept when a duplicate key is promoted', () => {
  const existing = entry({ entry_key: 'k1', classification: 'kept_existing' });
  const incoming = entry({ entry_key: 'k1', classification: 'incoming_should_be_ignored' });
  const result = computeCentralLedgerPromotion({
    localEntries: [incoming],
    centralText: centralText([existing])
  });
  assert.equal(result.promoted_count, 0);
  assert.equal(result.duplicate_count, 1);
  const parsed = JSON.parse(result.serialized);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].classification, 'kept_existing');
});

test('RML-S-3: empty/absent local ledger yields no_entries and writes nothing', () => {
  const empty = computeCentralLedgerPromotion({ localEntries: [], centralText: null });
  assert.equal(empty.status, 'no_entries');
  assert.equal(empty.promoted_count, 0);
  assert.equal(empty.serialized, null);
  const undef = computeCentralLedgerPromotion({});
  assert.equal(undef.status, 'no_entries');
});

test('GDO-S-2/GDO-S-3: delivery binding requires every local outcome to be promoted or deduplicated', () => {
  const bound = buildDecisionOutcomeBinding({
    localEntries: [entry({ entry_key: 'k1' }), entry({ entry_key: 'k2' })],
    promotion: { status: 'promoted', promoted_count: 1, duplicate_count: 1 },
    merge: {
      base: 'develop',
      delivery: {
        status: 'merged',
        pr_url: 'https://github.com/example/repo/pull/2',
        merge_commit_sha: 'immutable-delivery'
      }
    }
  });
  assert.equal(bound.status, 'bound');
  assert.equal(bound.expected_entry_count, 2);
  assert.equal(bound.promoted_count + bound.duplicate_count, 2);
  assert.equal(bound.delivery.merge_commit_sha, 'immutable-delivery');

  const missing = buildDecisionOutcomeBinding({
    localEntries: [entry()],
    promotion: null,
    merge: {
      base: 'develop',
      delivery: {
        status: 'merged',
        pr_url: 'https://github.com/example/repo/pull/2',
        merge_commit_sha: 'immutable-delivery'
      }
    }
  });
  assert.equal(missing.status, 'failed');
  assert.equal(missing.reason, 'decision_outcome_promotion_missing');
  assert.equal(missing.delivery.merge_commit_sha, 'immutable-delivery');

  const partial = buildDecisionOutcomeBinding({
    localEntries: [entry({ entry_key: 'k1' }), entry({ entry_key: 'k2' })],
    promotion: { status: 'promoted', promoted_count: 1, duplicate_count: 0 }
  });
  assert.equal(partial.status, 'failed');
  assert.equal(partial.reason, 'decision_outcome_binding_count_mismatch');

  const merge = {
    status: 'merged',
    stop_reason: null,
    delivery: {
      status: 'merged',
      pr_url: 'https://github.com/example/repo/pull/2',
      merge_commit_sha: 'immutable-delivery'
    },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  applyDecisionOutcomeBinding(merge, {
    localEntries: [entry()],
    promotion: { status: 'failed', reason: 'central_ledger_parse_failed' }
  });
  assert.equal(merge.status, 'merged', 'immutable delivery projection remains merged');
  assert.equal(merge.delivery.merge_commit_sha, 'immutable-delivery');
  assert.equal(merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(merge.reconciliation.reasons, ['decision_outcome_binding_failed']);
  assert.equal(merge.stop_reason, 'decision_outcome_binding_failed');
});

test('GDO-S-4: stories without local decision outcomes do not invent a binding failure', () => {
  const binding = buildDecisionOutcomeBinding({
    localEntries: [],
    promotion: { status: 'no_entries', promoted_count: 0, duplicate_count: 0 }
  });
  assert.equal(binding.status, 'not_applicable');
  assert.equal(binding.required, false);
  assert.equal(binding.reason, 'no_local_decision_outcomes');
});

test('RML-S-6: corrupt central ledger fails the promotion and is not overwritten', () => {
  const corrupt = computeCentralLedgerPromotion({
    localEntries: [entry()],
    centralText: '{ this is not json'
  });
  assert.equal(corrupt.status, 'failed');
  assert.equal(corrupt.reason, 'central_ledger_parse_failed');
  assert.equal(corrupt.serialized, null);

  const invalidShape = computeCentralLedgerPromotion({
    localEntries: [entry()],
    centralText: JSON.stringify({ schema_version: '0.1.0', entries: 'not-an-array' })
  });
  assert.equal(invalidShape.status, 'failed');
  assert.equal(invalidShape.reason, 'central_ledger_shape_invalid');
  assert.equal(invalidShape.serialized, null);
});

test('RML-S-6: central promotion rejects incompatible envelopes and malformed entries', () => {
  const cases = [
    [
      JSON.stringify({ schema_version: '9.9.9', model: 'vibepro-gate-outcome-ledger-v3', entries: [] }),
      'central_ledger_schema_invalid'
    ],
    [
      JSON.stringify({ schema_version: '0.1.0', model: 'wrong-model', entries: [] }),
      'central_ledger_model_invalid'
    ],
    [centralText([entry({ entry_key: '' })]), 'central_ledger_entry_invalid'],
    [centralText([entry({ entry_key: 'duplicate' }), entry({ entry_key: 'duplicate' })]), 'central_ledger_entry_duplicate']
  ];
  for (const [centralTextValue, reason] of cases) {
    const result = computeCentralLedgerPromotion({ localEntries: [entry()], centralText: centralTextValue });
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, reason);
    assert.equal(result.serialized, null);
  }
});

test('GDL-S-7 promotion source rejects malformed entries across the complete local ledger', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-entry-validation-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  const invalidEntries = [
    entry({ entry_key: '' }),
    entry({ entry_key: 'wrong-schema', schema_version: '9.9.9' }),
    entry({ entry_key: 'missing-story', story_id: '' }),
    entry({ entry_key: 'bad-outcome', outcome: 'invented' })
  ];
  await writeFile(ledgerPath, JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: [entry({ entry_key: 'mine', story_id: 'story-mine' }), ...invalidEntries]
  }));

  const result = await readPromotableGateOutcomeEntries(repo, 'story-mine');
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'local_gate_outcome_ledger_entry_invalid');
  assert.deepEqual(result.entries, []);
});

test('GDO-S-2 malformed local entries fail promotion instead of producing a bound count', () => {
  const result = computeCentralLedgerPromotion({
    localEntries: [entry({ entry_key: '' })],
    centralText: null
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'local_gate_outcome_ledger_entry_invalid');
  assert.equal(result.serialized, null);
});

test('RML-S-5: serialization is deterministic regardless of input order', () => {
  const a = entry({ entry_key: 'z-last', resolved_at: '2026-07-01T00:00:00.000Z' });
  const b = entry({ entry_key: 'a-first', resolved_at: '2026-07-09T00:00:00.000Z' });
  const forward = serializeCentralGateOutcomeLedger([a, b]);
  const reverse = serializeCentralGateOutcomeLedger([b, a]);
  assert.equal(forward, reverse);
  const parsed = JSON.parse(forward);
  assert.deepEqual(parsed.entries.map((e) => e.entry_key), ['a-first', 'z-last']);
  // updated_at is derived from the entries (max resolved_at), not wall-clock.
  assert.equal(parsed.updated_at, '2026-07-09T00:00:00.000Z');
});

test('summarizeGateRoi counts missing outcome as unclassified and exposes the total', () => {
  const ledger = {
    entries: [
      entry({ entry_key: 'k1', gate_id: 'gate:a', outcome: 'rewording_only' }),
      entry({ entry_key: 'k2', gate_id: 'gate:a', outcome: 'source_fix' }),
      entry({ entry_key: 'k3', gate_id: 'gate:b', outcome: null }),
      entry({ entry_key: 'k4', gate_id: 'gate:b', outcome: 'unclassified' })
    ]
  };
  const summary = summarizeGateRoi(ledger);
  assert.equal(summary.entry_count, 4);
  assert.equal(summary.unclassified_count, 2);
  const gateB = summary.gates.find((g) => g.gate_id === 'gate:b');
  assert.equal(gateB.count, 2);
  assert.equal(gateB.unclassified_count, 2);
  const gateA = summary.gates.find((g) => g.gate_id === 'gate:a');
  assert.equal(gateA.classifications.rewording_only, 1);
  assert.equal(gateA.classifications.source_fix, 1);
});

test('collectPromotableGateOutcomeEntries filters the local ledger by story_id', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-local-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    updated_at: null,
    entries: [
      entry({ entry_key: 'mine', story_id: 'story-mine' }),
      entry({ entry_key: 'other', story_id: 'story-other' })
    ]
  }, null, 2));
  const entries = await collectPromotableGateOutcomeEntries(repo, 'story-mine');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].entry_key, 'mine');
});

test('GDL-S-7 promotion source distinguishes absent, genuine empty, parse, schema, model, and shape states', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-source-state-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);

  const absent = await readPromotableGateOutcomeEntries(repo, 'story-mine');
  assert.equal(absent.status, 'absent');
  assert.equal(absent.reason, 'local_gate_outcome_ledger_absent');

  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, JSON.stringify({
    schema_version: '0.1.0',
    model: 'vibepro-gate-outcome-ledger-v3',
    entries: []
  }));
  const empty = await readPromotableGateOutcomeEntries(repo, 'story-mine');
  assert.equal(empty.status, 'empty');
  assert.equal(empty.reason, 'no_local_decision_outcomes');

  const invalidCases = [
    ['{not-json', 'local_gate_outcome_ledger_parse_failed'],
    [JSON.stringify({ schema_version: '9.9.9', model: 'vibepro-gate-outcome-ledger-v3', entries: [] }), 'local_gate_outcome_ledger_schema_invalid'],
    [JSON.stringify({ schema_version: '0.1.0', model: 'wrong-model', entries: [] }), 'local_gate_outcome_ledger_model_invalid'],
    [JSON.stringify({ schema_version: '0.1.0', model: 'vibepro-gate-outcome-ledger-v3', entries: {} }), 'local_gate_outcome_ledger_shape_invalid']
  ];
  for (const [contents, reason] of invalidCases) {
    await writeFile(ledgerPath, contents);
    const invalid = await readPromotableGateOutcomeEntries(repo, 'story-mine');
    assert.equal(invalid.status, 'failed');
    assert.equal(invalid.reason, reason);
    assert.deepEqual(invalid.entries, []);
  }
});

test('GDL-S-7 known v1 and v2 ledgers remain readable as legacy empty promotion sources', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-legacy-promotion-'));
  const ledgerPath = getGateOutcomeLedgerPath(repo);
  await mkdir(path.dirname(ledgerPath), { recursive: true });

  for (const model of ['vibepro-gate-outcome-ledger-v1', 'vibepro-gate-outcome-ledger-v2']) {
    await writeFile(ledgerPath, JSON.stringify({
      schema_version: '0.1.0',
      model,
      entries: [entry({ entry_key: `${model}-entry`, story_id: 'story-mine' })]
    }));
    const result = await readPromotableGateOutcomeEntries(repo, 'story-mine');
    assert.equal(result.status, 'empty', model);
    assert.equal(result.reason, 'legacy_gate_outcome_ledger_not_promotable', model);
    assert.deepEqual(result.entries, [], model);
  }
});

test('RML-S-4: usage report --gate-roi reads the central ledger with explicit gaps', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rml-central-'));
  const centralPath = path.join(repo, CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
  await mkdir(path.dirname(centralPath), { recursive: true });
  await writeFile(centralPath, serializeCentralGateOutcomeLedger([
    entry({ entry_key: 'k1', gate_id: 'gate:design_diagrams', outcome: 'rewording_only' }),
    entry({ entry_key: 'k2', gate_id: 'gate:design_diagrams', outcome: 'rewording_only' }),
    entry({ entry_key: 'k3', gate_id: 'gate:requirement', outcome: null })
  ]));

  const withFlag = await createUsageReport(repo, { gateRoi: true });
  assert.ok(withFlag.gate_roi, 'gate_roi present when flag set');
  assert.equal(withFlag.gate_roi.entry_count, 3);
  assert.equal(withFlag.gate_roi.unclassified_count, 1);
  assert.equal(withFlag.gate_roi.central_ledger_status, 'ok');
  assert.equal(withFlag.gate_roi.central_ledger_path, CENTRAL_GATE_OUTCOME_LEDGER_RELATIVE_PATH);
  const diagrams = withFlag.gate_roi.gates.find((g) => g.gate_id === 'gate:design_diagrams');
  assert.equal(diagrams.count, 2);
  assert.equal(diagrams.classifications.rewording_only, 2);

  const withoutFlag = await createUsageReport(repo, {});
  assert.equal(withoutFlag.gate_roi, undefined, 'gate_roi absent without flag');

  const centralRead = await readCentralGateOutcomeLedger(repo);
  assert.equal(centralRead.status, 'ok');
  assert.equal(centralRead.ledger.entries.length, 3);
});
