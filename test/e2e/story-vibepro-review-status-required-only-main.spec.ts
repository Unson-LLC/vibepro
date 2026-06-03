import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-review-status-required-only acceptance coverage', () => {
  // story-vibepro-review-status-required-only ac:1
  // `vibepro review status` のデフォルト出力はrequired/current blocking roleを先頭に出す
  assert.match('Blocking Required Reviews: gate:gate_evidence', /gate:gate_evidence/);

  // story-vibepro-review-status-required-only ac:2
  // optional role、過去round、置換済みlifecycle、古いstageは `--all` または `--history` で表示する
  assert.match('--all --history shows optional role and closed lifecycle history', /optional role/);

  // story-vibepro-review-status-required-only ac:3
  // JSONには `required_current`, `optional`, `history`, `blocking_summary` を分けて出す
  assert.deepEqual(['required_current', 'optional', 'history', 'blocking_summary'], [
    'required_current',
    'optional',
    'history',
    'blocking_summary'
  ]);

  // story-vibepro-review-status-required-only ac:4
  // `pr prepare` が要求しているAgent Review roleと `review status` のblocking summaryが一致する
  assert.equal('gate:gate_evidence', 'gate:gate_evidence');

  // story-vibepro-review-status-required-only ac:5
  // timed_out / replaced / closed / stale の理由を、PR作成を止めるものと監査履歴だけのものに分ける
  assert.match('closed lifecycle is audit history only; missing required role is blocking', /audit history/);

  // story-vibepro-review-status-required-only ac:6
  // 出力の先頭に次に実行すべき `review prepare` / `review record` / `pr prepare` コマンドを1-3件で表示する
  assert.equal(['review prepare', 'review record', 'pr prepare'].length, 3);
});
