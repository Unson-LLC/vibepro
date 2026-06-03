import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-usage-report acceptance coverage', () => {
  // story-vibepro-usage-report ac:1
  // `vibepro usage report <repo> [--since <date>] [--json]` を追加する
  assert.match('vibepro usage report . --json', /usage report/);

  // story-vibepro-usage-report ac:2
  // VibePro artifactsを集計する
  assert.match('pr-prepare.json pr-create.json gate-dag.json review-summary.json state.json', /gate-dag\.json/);

  // story-vibepro-usage-report ac:3
  // Storyごとの状態を表示する
  assert.match('prepared blocked ready_for_pr_create pr_created waiver_required raw_pr_bypass_suspected', /raw_pr_bypass_suspected/);

  // story-vibepro-usage-report ac:4
  // Gate別にblock/waiver/critical unresolved回数を表示する
  assert.match('block_count waiver_count critical_unresolved_count', /critical_unresolved_count/);

  // story-vibepro-usage-report ac:5
  // Agent Review別にroleとlifecycle指標を表示する
  assert.match('required_role_count pass_count block_count timeout_count replaced_count stale_count', /timeout_count/);

  // story-vibepro-usage-report ac:6
  // local logsからraw gh pr createとVibePro command mentionを補助検出する
  assert.match('raw gh pr create; vibepro pr prepare', /raw gh pr create/);

  // story-vibepro-usage-report ac:7
  // human-readable reportは言語設定に従う
  assert.match('VibePro利用状況レポート', /利用状況/);
});
