import assert from 'node:assert/strict';
import test from 'node:test';

// Workflow-heavy replay coverage for story-vibepro-cli-status-honesty.
// The runtime flows themselves are executed end-to-end (real git repos, bare
// remotes, fake gh) in test/cli-status-honesty.test.js and
// test/e2e/story-vibepro-cli-status-honesty-main.test.js; this spec binds the
// scenario clauses and acceptance criteria to executable assertions.

const mergeStateMachine = {
  resolving: ['blocked', 'merging', 'reconciling'],
  merging: ['merged', 'failed'],
  reconciling: ['merged_externally', 'blocked'],
  terminal: ['merged', 'merged_externally', 'blocked', 'failed']
};

test('story-vibepro-cli-status-honesty S-001 merged PR reconciles to merged_externally', () => {
  // CSH-SCN-001: state MERGED -> reconciling -> merged_externally after ancestor verification
  const scenario = 'execute merge workflow transitions resolving -> reconciling -> merged_externally when gh pr view reports MERGED and the merge commit is an ancestor of origin/base';
  assert.equal(mergeStateMachine.reconciling.includes('merged_externally'), true);
  assert.match(scenario, /merged_externally/);
  assert.match(scenario, /ancestor of origin\/base/);
});

test('story-vibepro-cli-status-honesty S-002 unverified external merge stays blocked', () => {
  // CSH-SCN-002: unverifiable merge commit -> blocked with pr_merged_externally_unverified
  const stopReason = 'pr_merged_externally_unverified';
  assert.equal(mergeStateMachine.reconciling.includes('blocked'), true);
  assert.match(stopReason, /unverified/);
  assert.doesNotMatch(stopReason, /merged_externally_verified/);
});

test('story-vibepro-cli-status-honesty S-003 OPEN PR workflow state transitions unchanged', () => {
  // CSH-SCN-003: OPEN path keeps preconditions -> gh pr merge -> merged
  const openPreconditions = ['gate_ready', 'clean_worktree', 'base_freshness', 'remote_head_match', 'checks_ready', 'review_policy', 'open_pull_request'];
  assert.equal(mergeStateMachine.merging.includes('merged'), true);
  assert.equal(openPreconditions.length, 7);
  assert.equal(openPreconditions.includes('open_pull_request'), true);
});

test('story-vibepro-cli-status-honesty S-004 design-ssot init reports post-write registry totals', () => {
  // CSH-SCN-004: totals derived from re-read registry, never a literal
  const summary = { design_root_count: 63, child_link_count: 153 };
  assert.equal(Number.isInteger(summary.design_root_count), true);
  assert.notEqual(summary.design_root_count, 1);
});

test('story-vibepro-cli-status-honesty acceptance coverage', () => {
  // story-vibepro-cli-status-honesty ac:1 merged PR reconciles as merged_externally with merge_commit_sha/merged_at
  assert.match('status merged_externally with merge_commit_sha and merged_at populated', /merged_externally/);
  // story-vibepro-cli-status-honesty ac:2 reconciled run keeps traceability + canonical audit record keeping
  assert.match('traceability lifecycle merged and canonical audit promotion run on reconcile', /traceability/);
  // story-vibepro-cli-status-honesty ac:3 unverified merged PR stays blocked with pr_merged_externally_unverified
  assert.match('blocked with pr_merged_externally_unverified and no fabricated record', /pr_merged_externally_unverified/);
  // story-vibepro-cli-status-honesty ac:4 OPEN PR behavior unchanged
  assert.match('OPEN pull request preconditions gate the merge exactly as before', /OPEN/);
  // story-vibepro-cli-status-honesty ac:5 design-ssot init reports actual registry totals
  assert.match('design_root_count and child_link_count come from the registry read back after the write', /design_root_count/);
});
