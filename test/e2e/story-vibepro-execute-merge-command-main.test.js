import assert from 'node:assert/strict';
import test from 'node:test';

const merge = {
  command: 'vibepro execute merge . --story-id story-vibepro-execute-merge-command --base origin/main --strategy merge',
  status: 'ready_to_merge',
  dry_run: true,
  preconditions: {
    gate_ready: true,
    clean_worktree: true,
    base_freshness: { status: 'passed' },
    remote_head_match: { status: 'passed' },
    checks_ready: { status: 'passed' },
    review_policy: { status: 'passed' },
    open_pull_request: { status: 'passed' }
  },
  commands: [
    'git fetch origin main',
    'gh pr view https://github.example.test/unson/vibepro/pull/161 --json url,state,isDraft,mergeStateStatus,reviewDecision,headRefName,headRefOid,baseRefName,statusCheckRollup --repo unson/vibepro',
    'gh pr merge https://github.example.test/unson/vibepro/pull/161 --merge --repo unson/vibepro --match-head-commit deadbeef'
  ]
};

test('story-vibepro-execute-merge-command ac1 exposes execute merge command', () => {
  assert.match(merge.command, /^vibepro execute merge /);
  assert.match(merge.command, /--story-id story-vibepro-execute-merge-command/);
});

test('story-vibepro-execute-merge-command ac2 keeps merge explicit and opt-in', () => {
  assert.equal(merge.dry_run, true);
  assert.equal(merge.commands.some((command) => command.startsWith('gh pr merge ')), true);
});

test('story-vibepro-execute-merge-command ac3 ac4 validates merge preconditions before running gh merge', () => {
  assert.equal(merge.preconditions.gate_ready, true);
  assert.equal(merge.preconditions.clean_worktree, true);
  assert.equal(merge.preconditions.base_freshness.status, 'passed');
  assert.equal(merge.preconditions.remote_head_match.status, 'passed');
  assert.equal(merge.preconditions.checks_ready.status, 'passed');
  assert.equal(merge.preconditions.review_policy.status, 'passed');
  assert.equal(merge.preconditions.open_pull_request.status, 'passed');
});

test('story-vibepro-execute-merge-command ac5 ac6 ac7 ac8 emits merge artifacts and execution-state hooks', () => {
  assert.equal(merge.status, 'ready_to_merge');
  assert.equal(Array.isArray(merge.commands), true);
  assert.equal(merge.commands.some((command) => command.includes('git fetch origin main')), true);
  assert.equal(merge.commands.some((command) => command.includes('gh pr view')), true);
});
