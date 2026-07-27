---
story_id: story-vibepro-review-surface-violation-ledger
title: レビュー中のレビュー面変更を append-only の違反として型分離し、再実行で消えない記録にする
status: active
view: dev
period: 2026-07
category: architecture
source:
  type: operator_feedback
  title: "先行 Story の round 6 で、実装エージェントがレビュー実行中にツリーを変更した。lifecycle は start 時の head_sha しか記録しないため機械検出されず、レビュアーが git status を偶然見て発見した。違反は stale と同じ failed 表示になり、レビュー再実行で痕跡ごと消えた"
parent_design: vibepro-review-surface-violation-ledger
related_stories:
  - story-vibepro-computed-evidence-architecture
  - story-vibepro-enumeration-coverage-gate
reason: "alternatives considered: (a) レビュアーに『毎回 git status を見ろ』と指示する — 実測で失敗した路線。round 6 の検出は偶然であり、指示は決定的な停止機構にならない。(b) レビュー結果 (review-result-<role>.json) の中に違反を書く — 現状と同じ。review record は同一パスを上書きするため、再実行で違反が消える。実測でそう消えた。(c) close 時点の head と surface digest を lifecycle に記録し、start 時点と異なる場合は story 直下の append-only ledger に violation として別ファイルへ積む — これを採用。stale (再実行で解消してよい) と violation (消えてはならない) を記録先とスキーマの両方で型分離し、消去 API を持たないことで『再実行で消えない』を構造で保証する。compatibility impact: lifecycle entry には closed_head_sha / closed_surface_digest / surface_violation_id を追加するのみで既存フィールドの削除・意味変更はない。これらを持たない既存 lifecycle entry は violation 0 件として読める。ledger ファイルが存在しない既存 Story は違反なしとして扱われ、gate は passed になる。rollback plan: 本 Story は新規モジュール src/review-surface-violations.js、review close の記録追加、summarizeAgentReviewsForPr の 1 フィールド追加、gate:review_surface_integrity とその DAG edge、CLI の review violations サブコマンド、専用テストに閉じており、単独 revert で従来挙動へ戻る。生成済み ledger ファイルは revert 後も無害な JSON として残る。boundary and scope: 対象は review close 時点の検出と記録、および pr prepare での表示のみ。verify record 側の証跡計算化 (CEA-S-1)、網羅数の計算化 (CEA-S-2)、予算 override の人間承認 (CEA-S-4) は本 Story の範囲外で、それぞれ別の子 Story が担う。"
created_at: 2026-07-27
updated_at: 2026-07-27
---

# レビュー中のレビュー面変更を append-only の違反として型分離し、再実行で消えない記録にする

## Background（実測。推測ではない）

親 Story `story-vibepro-computed-evidence-architecture` の Decomposition 1 番目
（violation ledger / CEA-S-3）を実装する。

先行 Story（enumeration coverage gate）の gate stage 独立レビュー round 6 で、
実装エージェントがレビュー実行中にワーキングツリーを変更した。この事象には
3 つの構造的欠陥が同時に現れている。

1. **機械検出されなかった。** `review start` は `head_sha` と `surface_digest` を
   lifecycle entry に記録するが、`review close` は close 時点の head も digest も
   第一級フィールドとして記録しない。したがって「start と close の間で
   レビュー面が動いたか」はどの artifact からも復元できない。
2. **自己申告がなかった。** 発見はレビュアーが `git status` を偶然見たことによる。
   偶然に依存する検出は停止機構ではない。
3. **再実行で消えた。** 違反はレビュー結果の自由文 finding として残ったが、
   `review record` は `review-result-<role>.json` を同一パスへ上書きするため、
   後続ラウンドの pass 結果で痕跡ごと置き換わった。表示上も stale と同じ
   `failed` であり、両者を区別する語彙がなかった。

親 Story の学び 4 が指すのはこの 3 番目である。
**再実行で消えてよい状態（stale）と、消えてはならない記録（violation）を
同じ語彙・同じ保存先で扱うと、違反は stale として洗い流される。**

## 設計判断（記録先とスキーマで型を分ける）

| | stale | violation |
|---|---|---|
| 意味 | レビュー後にレビュー面が変わり、そのレビューが現在の head を保証しなくなった | レビュー**中**にレビュー面が変わり、そのレビューが何を見たのか確定できない |
| 正しい解消法 | レビューを現在の head で再実行する | 再実行では解消しない。人間が事実を見て裁定する |
| 保存先 | `.vibepro/reviews/<story>/<stage>/review-result-<role>.json`（上書き） | `.vibepro/reviews/<story>/surface-violations.json`（append-only） |
| 消去 API | 上書きにより自然消滅 | 存在しない。削除・更新の関数を提供しない |
| gate | `gate:agent_review` | `gate:review_surface_integrity` |

`close_reason` が `completed` の場合のみ違反として記録する。`replaced` /
`timeout` / `manual_shutdown` は「レビューが完走しなかった」ことの記録であり、
`review record` は replaced な lifecycle へ結果を添付できない（既存挙動）ため、
`--close-reason replaced` による回避は違反を消す代わりにレビュー結果そのものを
捨てることになる。回避経路にならないのでこの限定は安全である。

## User Story

**As a** AI エージェントに実装を任せるリポジトリ所有者
**I want** レビュー実行中にレビュー面が動いた事実が、レビュアーの偶然の発見でも
実装エージェントの自己申告でもなく `review close` の計算として記録され、
その記録がレビュー再実行では消えないこと
**So that** 「そのレビューは結局どのツリーを見たのか」を後から確定でき、
汚染されたレビューを pass として受け取らずに済む

## Acceptance Criteria

反証手順つき。すべて `test/review-surface-violation-ledger.test.js` で機械検証する。

- [ ] RSV-1: `review close` は毎回、close 時点の head sha と surface digest を
      lifecycle entry の `closed_head_sha` / `closed_surface_digest` に記録する。
      変更がなかった close でも記録される。
      **反証**: ツリーを一切変更せず start→close し、lifecycle.json の当該 entry に
      両フィールドが存在し start 時の値と一致することを確認する。欠落または
      null なら不合格。
- [ ] RSV-2: close 時点の head sha または surface digest が start 時点と異なり、
      かつ `close_reason` が `completed` の場合、`review close` は
      `.vibepro/reviews/<story-id>/surface-violations.json` に
      `kind: "review_surface_mutated_during_review"`,
      `evidence_class: "violation"` の entry を 1 件追加し、
      `changed_fields` に変化したフィールド名を列挙する。
      **反証**: start 後にトラッキング済みファイルを書き換えてから close し、
      entry が存在し `changed_fields` が `surface_digest` を含むことを確認する。
      未 commit の変更で entry が作られないなら不合格。
- [ ] RSV-3: ledger はレビュー再実行で消えない。違反の記録後に同一 story/stage/role で
      新しい lifecycle を start→close→record しても、既存 entry は削除も改変もされず、
      entry 総数は減少しない。
      **反証**: 違反記録後の entry を JSON として保存し、クリーンな 2 周目を
      完走させたうえで同一 entry が同一内容で存在することを確認する。
      内容が変化するか消えるなら不合格。
- [ ] RSV-4: 同一 lifecycle に対する close の再実行（冪等キー再送を含む）は
      違反を重複記録しない。`violation_id` は story/stage/role/lifecycle_id/kind/
      start 側と close 側の値から決定的に導出される。
      **反証**: 同一 `operationIdempotencyKey` で close を 2 回呼び、
      ledger の entry 数が 1 のままであることを確認する。
- [ ] RSV-5: `pr prepare` は `gate:review_surface_integrity` を出力する。未承認の
      違反が 1 件以上あるとき status は `failed` で、この status はレビュー再実行では
      解消しない。解消経路は `--source gate:review_surface_integrity:<violation-id>`
      を持つ accepted な decision record のみであり、承認後も ledger entry は
      artifact 上に残り続ける。
      **反証**: 違反記録後にレビューを再実行しても gate が `failed` のままであること、
      decision record を accepted で記録すると gate が解消し、かつ
      `surface-violations.json` の entry が消えていないことを確認する。
- [ ] RSV-6: stale と violation は型として分離されている。レビュー close 後の
      無関係な後続 commit（レビュー中ではない変更）は ledger に entry を作らず、
      `gate:review_surface_integrity` は 0 件のまま passed である。
      **反証**: クリーンな start→close→record の後に無関係ファイルを commit し、
      ledger が空であることを確認する。entry が作られるなら不合格。
- [ ] RSV-7: 既存 artifact の後方互換と、破損 ledger の fail-closed。
      `closed_head_sha` を持たない旧 lifecycle entry および `surface-violations.json`
      が **存在しない** Story は、例外を投げずに違反 0 件として読め、gate は passed
      になる。いっぽう ledger が **存在するが読めない**（malformed JSON、または
      `entries[]` が配列でない）場合は 0 件として読まず拒否し、gate は failed に
      なる。読めない ledger は「消された ledger」と区別できないため、
      両者を同じ扱い（block）にする。
      **反証**: (a) 当該フィールドを持たない lifecycle entry と ledger 不在の状態で
      サマリ生成を実行し、throw せず `unacknowledged_count` が 0 であること。
      (b) ledger を切り詰めた状態で読み取りが `VIBEPRO_REVIEW_SURFACE_LEDGER_UNREADABLE`
      で拒否され、`readable: false` かつ `unacknowledged_count` が 1 になり、
      その状態での `review close` が violation を静かに落とさず throw すること。
      破損 ledger が 0 件として読めるなら不合格（ファイルを壊すだけで
      append-only 記録を消せてしまうため）。

## Non Goals

- verify record 側の証跡計算化（親 Story CEA-S-1）。別の子 Story が担う。
- 網羅数 N の計算化（CEA-S-2）。
- 予算・停止条件 override の人間承認必須化（CEA-S-4）。本 Story の承認経路は
  既存の decision record をそのまま使い、書き込み主体の制限は行わない。
- `review record` 時点や adjudication 時点での面変更検出。本 Story は
  start と close の間だけを対象にする。
- 既に記録済みの過去 Story の遡及的な違反抽出。

## 残余（明示しておく）

`surface_digest` は `.vibepro/` を除外した user fingerprint（`.vibepro/config.json`
のみ例外的に含む）に基づく。したがって「レビュー中に `.vibepro` 配下の生成物だけが
更新された」ケースは違反にならない。これはレビュー自身が artifact を書くため
必要な除外であり、レビュー面（ソース・テスト・ドキュメント・config）の変更は
すべて検出範囲に入る。この境界は意図的なものであり、除外の外側で違反を
見逃すことはない。
