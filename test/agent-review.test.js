import assert from 'node:assert/strict';
import test from 'node:test';

import { renderDecisionOutcomeReviewInput } from '../src/agent-review.js';

test('GDL-S-6 review handoff renders bounded selectors and canonical lookup metadata', () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({
    decision_trace_id: index === 0 ? null : `dt-${index}`,
    collision_group: index === 0 ? 'cg-legacy' : null,
    trace_source_ref: `tsr-${index}`,
    parent_revision_fingerprint: `parent-${index}`,
    trace_status: index === 0 ? 'incomplete' : 'partial',
    behavior_delta_status: 'observed',
    delivery_status: 'pr_created',
    downstream_outcome_status: 'not_observed'
  }));
  const markdown = renderDecisionOutcomeReviewInput({
    ledger_path: '.vibepro/pr/story-ledger/decision-outcome-ledger.json',
    ledger_digest: 'abc123',
    total_count: 24,
    returned_count: 20,
    omitted_count: 4,
    truncated: true,
    entries
  });

  assert.match(markdown, /collision_group=cg-legacy trace_source_ref=tsr-0/);
  assert.match(markdown, /decision_trace_id=dt-1/);
  assert.match(markdown, /parent_revision=parent-0/);
  assert.match(markdown, /total: 24/);
  assert.match(markdown, /omitted: 4/);
  assert.match(markdown, /decision-outcome-ledger\.json/);
  assert.ok(!markdown.includes('finding body'));
});
