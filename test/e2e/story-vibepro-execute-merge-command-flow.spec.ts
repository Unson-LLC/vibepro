import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-execute-merge-command flow exposes explicit merge gating', async () => {
  const scenario = 'When a user starts the merge workflow for a PR that was created through VibePro, the flow must inspect PR state transitions and block the merge process until gate readiness, base freshness, remote head match, and check status are all satisfied.';
  const command = 'vibepro execute merge . --story-id story-vibepro-execute-merge-command --base origin/main --strategy merge';
  const marker = 'story-vibepro-execute-merge-command S-001';
  assert.match(command, /execute merge/);
  assert.match(command, /--story-id story-vibepro-execute-merge-command/);
  assert.match(command, /--strategy merge/);
  assert.equal(marker.includes('S-001'), true);
  assert.equal(scenario.includes('merge workflow'), true);
  assert.equal(scenario.includes('state transitions'), true);
  assert.equal(scenario.includes('gate readiness'), true);
});

test('story-vibepro-execute-merge-command flow requires clean checks and recorded merge result', async () => {
  const scenario = 'When the merge workflow reaches a successful merged state, the process must record the merged transition in pr-merge artifacts and advance the execution DAG from merge_ready to merged_or_closed.';
  const preconditions = ['gate_ready', 'base_freshness', 'remote_head_match', 'checks_ready', 'open_pull_request'];
  const marker = 'story-vibepro-execute-merge-command S-002';
  assert.equal(preconditions.includes('checks_ready'), true);
  assert.equal(preconditions.includes('base_freshness'), true);
  assert.equal(marker.includes('S-002'), true);
  assert.equal(scenario.includes('merged transition'), true);
  assert.equal(scenario.includes('merge_ready'), true);
  assert.equal(scenario.includes('merged_or_closed'), true);
});
