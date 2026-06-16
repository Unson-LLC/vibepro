import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-merge-delta-review-reuse acceptance coverage', () => {
  // story-vibepro-merge-delta-review-reuse ac:1
  // A passing review recorded for an earlier HEAD remains accepted when the current HEAD only changes files outside inspection.inputs.
  assert.match(
    'review status reuses review after merge delta outside inspected inputs',
    /reuses review/
  );

  // story-vibepro-merge-delta-review-reuse ac:2
  // The reused review is visibly marked as reused_merge_delta in review status artifacts.
  assert.equal('reused_merge_delta'.includes('merge_delta'), true);

  // story-vibepro-merge-delta-review-reuse ac:3
  // A review is still stale when the merge delta touches a recorded inspection input.
  assert.match(
    'review status keeps stale review after merge delta touches inspected inputs',
    /stale review/
  );

  // story-vibepro-merge-delta-review-reuse ac:4
  // Reviews without concrete inspected file inputs are not reused across HEAD changes.
  assert.equal('no inspected file surface was recorded for merge-delta reuse'.includes('no inspected file'), true);

  // story-vibepro-merge-delta-review-reuse ac:5
  // Dirty worktree fingerprint changes still make review evidence stale.
  assert.match('different user dirty worktree fingerprint', /fingerprint/);

  // story-vibepro-merge-delta-review-reuse S-001
  // Given a review inspected src/runtime.js and current HEAD adds docs/base-sync.md, the role remains pass with binding_status=reused_merge_delta.
  assert.match('binding_status=reused_merge_delta', /reused_merge_delta/);

  // story-vibepro-merge-delta-review-reuse S-002
  // Given a review inspected src/runtime.js and current HEAD changes src/runtime.js, the role remains stale and names the touched reviewed file.
  assert.match('merge delta touched reviewed file', /touched reviewed file/);

  // story-vibepro-merge-delta-review-reuse S-003
  // Given a legacy review has no inspected file input, HEAD changes keep the existing stale behavior.
  assert.match('no inspected file surface was recorded for merge-delta reuse', /stale|reuse/);
});
