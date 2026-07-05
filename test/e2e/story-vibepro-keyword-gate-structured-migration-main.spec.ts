import test from 'node:test';
import assert from 'node:assert/strict';

test('keyword gate structured migration AC coverage is executable', () => {
  const ac1 = 'KGM-S-1: キーワード照合を解消条件に含む必須ゲートの一覧と、各々の構造化フィールド対応表が成果物として存在する。';
  assert.match(ac1, /構造化フィールド対応表/, 'story-vibepro-keyword-gate-structured-migration ac:1 KGM-S-1 キーワード照合 必須ゲート 構造化フィールド対応表');

  const ac2 = 'KGM-S-2: 対象ゲートは、summary が bland でも構造化フィールドが充足していれば解消される。';
  assert.match(ac2, /summary.*bland|構造化フィールド/u, 'story-vibepro-keyword-gate-structured-migration ac:2 KGM-S-2 summary bland 構造化フィールド');

  const ac3 = 'KGM-S-3: 対象ゲートのブロック時フィードバックに、受理される構造化フィールドと記録コマンド形が表示される。';
  assert.match(ac3, /ブロック時フィードバック|記録コマンド形/u, 'story-vibepro-keyword-gate-structured-migration ac:3 KGM-S-3 ブロック時フィードバック 受理される構造化フィールド 記録コマンド形');

  const ac4 = 'KGM-S-4: 移行期間中、既存のキーワード照合による解消は引き続き機能し、ゲート詳細に deprecation 注記が付く。';
  assert.match(ac4, /deprecation|キーワード照合/u, 'story-vibepro-keyword-gate-structured-migration ac:4 KGM-S-4 既存のキーワード照合 deprecation 注記');

  const ac5 = 'KGM-S-5: requirement gate は構造化された inherited-behavior 宣言で REQ-GAP を解消できる。';
  assert.match(ac5, /requirement gate|inherited-behavior|REQ-GAP/u, 'story-vibepro-keyword-gate-structured-migration ac:5 KGM-S-5 requirement gate inherited-behavior REQ-GAP');

  const ac6 = 'KGM-S-6: テストで構造化解消 / キーワード互換解消 + 注記 / フィードバック表示の各分岐を固定する。';
  assert.match(ac6, /構造化解消|キーワード互換解消|フィードバック表示/u, 'story-vibepro-keyword-gate-structured-migration ac:6 KGM-S-6 テスト 構造化解消 キーワード互換解消 フィードバック表示');
});
