import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAcceptedSpecClauseMap } from '../../src/traceability.js';

const consumerRepo = process.env.ISSUE462_CONSUMER_REPO;
const expectedHead = 'f2aacbb3bf7a48d96f2cf58ac3b4b85275023947';

if (!consumerRepo) {
  throw new Error('ISSUE462_CONSUMER_REPO is required');
}

const storyId = 'story-zeims-tax-judgment-pure-dag-foundation-v1';
const clauseMap = await buildAcceptedSpecClauseMap(consumerRepo, {
  storyId,
  storyDocPath: `docs/management/stories/active/${storyId}.md`,
  verification: { recorded: false, commands: [] },
  headRef: 'HEAD'
});

test('Zeims2の固定HEADとAccepted Spec lineage集計を維持する', () => {
  const lineage = clauseMap.accepted_spec_lineage;
  assert.equal(lineage.head_sha, expectedHead);
  assert.equal(lineage.status, 'resolved');
  assert.equal(lineage.clause_count, 7);
  assert.equal(lineage.resolved_clause_count, 7);
  assert.deepEqual(lineage.reason_codes, []);
  assert.deepEqual(lineage.failures, []);
});

for (const criterion of clauseMap.acceptance_criteria) {
  test(`${criterion.id}のAccepted Spec clauseを固定HEADから解決する`, () => {
    assert.equal(criterion.lineage_status, 'resolved');
    assert.deepEqual(criterion.reason_codes, []);
    assert.ok(criterion.mapped_test_provenance.length > 0);
    for (const provenance of criterion.mapped_test_provenance) {
      assert.equal(provenance.head_sha, expectedHead);
      assert.ok(provenance.blob_oid);
    }
  });
}
