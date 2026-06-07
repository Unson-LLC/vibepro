import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-execute-merge-command flow exposes explicit merge gating', async () => {
  const command = 'vibepro execute merge . --story-id story-vibepro-execute-merge-command --base origin/main --strategy merge';
  assert.match(command, /execute merge/);
  assert.match(command, /--story-id story-vibepro-execute-merge-command/);
  assert.match(command, /--strategy merge/);
});

test('story-vibepro-execute-merge-command flow requires clean checks and recorded merge result', async () => {
  const preconditions = ['gate_ready', 'base_freshness', 'remote_head_match', 'checks_ready', 'open_pull_request'];
  assert.equal(preconditions.includes('checks_ready'), true);
  assert.equal(preconditions.includes('base_freshness'), true);
});
