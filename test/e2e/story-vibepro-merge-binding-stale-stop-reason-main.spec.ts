import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMergeGateAuthorization } from '../../src/merge-gate-authorization.js';
import { applyDecisionOutcomeBinding } from '../../src/merge-manager.js';

const STORY_ID = 'story-vibepro-merge-binding-stale-stop-reason';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    entry_key: 'story:trace:rev',
    story_id: STORY_ID,
    trace_id: 'trace-1',
    revision_fingerprint: 'rev-1',
    recorded_at: '2026-07-30T00:00:00.000Z',
    ...overrides
  };
}

function mergedDelivery() {
  return {
    status: 'merged',
    pr_url: 'https://github.com/example/repo/pull/397',
    merge_commit_sha: 'immutable-delivery'
  };
}

test(`${STORY_ID} AC:1 AC:2 a successful rebinding removes the stale failure reason and reconciles`, () => {
  const merge = {
    status: 'merged',
    stop_reason: null,
    delivery: mergedDelivery(),
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  applyDecisionOutcomeBinding(merge, {
    localEntries: [entry()],
    promotion: { status: 'failed', reason: 'central_ledger_parse_failed' }
  });
  assert.equal(merge.stop_reason, 'decision_outcome_binding_failed');
  assert.equal(merge.reconciliation.status, 'reconciliation_required');

  const rebound = applyDecisionOutcomeBinding(merge, {
    localEntries: [entry()],
    promotion: { status: 'promoted', promoted_count: 0, duplicate_count: 1 }
  });
  assert.equal(rebound.status, 'bound');
  assert.deepEqual(merge.reconciliation.reasons, []);
  assert.equal(merge.reconciliation.status, 'reconciled');
  assert.equal(merge.stop_reason, null);
});

test(`${STORY_ID} AC:2 AC:3 other reconciliation reasons keep reconciliation_required and a delivery stop_reason`, () => {
  const merge = {
    status: 'merged',
    stop_reason: 'decision_outcome_binding_failed',
    delivery: mergedDelivery(),
    reconciliation: {
      status: 'reconciliation_required',
      reasons: ['base_behind_remote', 'decision_outcome_binding_failed']
    }
  };
  applyDecisionOutcomeBinding(merge, {
    localEntries: [entry()],
    promotion: { status: 'promoted', promoted_count: 1, duplicate_count: 0 }
  });
  assert.equal(merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(merge.reconciliation.reasons, ['base_behind_remote']);
  assert.equal(merge.stop_reason, 'delivery_reconciliation_required');
});

test(`${STORY_ID} AC:3 a stop_reason owned by another code path is never touched`, () => {
  const merge = {
    status: 'merged',
    stop_reason: 'delivery_reconciliation_required',
    delivery: mergedDelivery(),
    reconciliation: {
      status: 'reconciliation_required',
      reasons: ['decision_outcome_binding_failed']
    }
  };
  applyDecisionOutcomeBinding(merge, {
    localEntries: [entry()],
    promotion: { status: 'promoted', promoted_count: 1, duplicate_count: 0 }
  });
  assert.deepEqual(merge.reconciliation.reasons, []);
  assert.equal(merge.reconciliation.status, 'reconciled');
  assert.equal(merge.stop_reason, 'delivery_reconciliation_required');
});

test(`${STORY_ID} AC:4 S-001 failure behavior is unchanged: a failed binding still flags reconciliation`, () => {
  const merge = {
    status: 'merged',
    stop_reason: null,
    delivery: mergedDelivery(),
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  const failed = applyDecisionOutcomeBinding(merge, {
    localEntries: [entry({ entry_key: 'k1' }), entry({ entry_key: 'k2' })],
    promotion: { status: 'promoted', promoted_count: 1, duplicate_count: 0 }
  });
  assert.equal(failed.status, 'failed');
  assert.equal(merge.reconciliation.status, 'reconciliation_required');
  assert.deepEqual(merge.reconciliation.reasons, ['decision_outcome_binding_failed']);
  assert.equal(merge.stop_reason, 'decision_outcome_binding_failed');
});

test(`${STORY_ID} AC:5 S-001 the failed-then-successful sequence is idempotent across repeated reruns`, () => {
  const merge = {
    status: 'merged',
    stop_reason: null,
    delivery: mergedDelivery(),
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  applyDecisionOutcomeBinding(merge, {
    localEntries: [entry()],
    promotion: { status: 'failed', reason: 'central_ledger_parse_failed' }
  });
  for (let i = 0; i < 3; i += 1) {
    const rebound = applyDecisionOutcomeBinding(merge, {
      localEntries: [entry()],
      promotion: { status: 'promoted', promoted_count: 0, duplicate_count: 1 }
    });
    assert.equal(rebound.status, 'bound');
    assert.equal(merge.reconciliation.status, 'reconciled');
    assert.equal(merge.stop_reason, null);
  }
});

test(`${STORY_ID} S-002 denied merge gate authorization still fails closed (inherited behavior unchanged)`, () => {
  const denied = buildMergeGateAuthorization({ overall_status: 'needs_verification' }, null);
  assert.equal(denied.allowed, false, `${STORY_ID} S-002 !gateAuthorization.allowed keeps blocking executeMerge before any binding pass runs`);
});
