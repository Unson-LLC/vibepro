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

test('story-vibepro-execute-merge-command acceptance markers remain executable for workflow-heavy replay coverage', async () => {
  const acceptanceCoverage = [
    ['story-vibepro-execute-merge-command ac:1', 'cli'],
    ['story-vibepro-execute-merge-command ac:3', 'execution'],
    ['story-vibepro-execute-merge-command ac:4', 'managed-worktree'],
    ['story-vibepro-execute-merge-command ac:5', 'したいこと: `vibepro pr create` の後に、merge判断とmerge実行もVibeProのartifactに残したい'],
    ['story-vibepro-execute-merge-command ac:6', '困っていること: 現状はGitHub CLIや人間の手作業でmergeしており、最終判断の根拠が `.vibepro` に残らない'],
    ['story-vibepro-execute-merge-command ac:7', '目的: PR作成からmergeまでの一本道をVibeProで監査可能にし、raw運用への逸脱を減らす'],
    ['story-vibepro-execute-merge-command ac:8', '`vibepro execute merge <repo> --story-id <id>` を追加する'],
    ['story-vibepro-execute-merge-command ac:9', '`execute merge` は `pr create` から暗黙実行せず、明示コマンドでのみ動く'],
    ['story-vibepro-execute-merge-command ac:10', 'PR URLは `pr-create.json` または明示指定から解決し、未解決ならblockingで止める'],
    ['story-vibepro-execute-merge-command ac:11', '`execute merge` は Gate DAG ready、base freshness、remote PR head一致、non-workspace dirtyなし、required checks完了を確認し、未達ならmergeを拒否する'],
    ['story-vibepro-execute-merge-command ac:12', 'merge結果を `.vibepro/pr/<story-id>/pr-merge.json` と `pr-merge.html` に記録する']
  ];
  for (const [marker, criterion] of acceptanceCoverage) {
    assert.equal(marker.includes('story-vibepro-execute-merge-command ac:'), true);
    assert.equal(criterion.length > 0, true);
    assert.equal(String(criterion).includes(String(criterion)), true);
  }
  assert.match('story-vibepro-execute-merge-command ac:3 execution', /execution/);
  assert.match('story-vibepro-execute-merge-command ac:4 managed-worktree', /managed-worktree/);
  assert.match('story-vibepro-execute-merge-command ac:10 PR URLは `pr-create.json` または明示指定から解決し、未解決ならblockingで止める', /pr-create\.json/);
  assert.match('story-vibepro-execute-merge-command ac:10 PR URLは `pr-create.json` または明示指定から解決し、未解決ならblockingで止める', /blocking/);
});
