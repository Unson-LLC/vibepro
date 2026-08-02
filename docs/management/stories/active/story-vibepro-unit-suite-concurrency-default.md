---
story_id: story-vibepro-unit-suite-concurrency-default
title: "unit証跡の全体スイート実行を実測最適並列度に正本化し、verify runのタイムアウト余裕を確保する"
status: active
created_at: 2026-08-02
updated_at: 2026-08-02
reason: |
  alternatives: (a) package.json の test script を `node --test --test-concurrency=2` にする /
  (b) verification-evidence の unit コマンド形式ゲートが `node --test --test-concurrency=N` を
  全体スイートとして受理するよう拡張する。採用は (a)。ゲートが既に受理する `npm test` の実体を
  実測最適並列度に変えることで、証跡コマンド（npm test）と実実行の乖離が消え、ゲート判定ロジックに
  一切手を入れずに済む。(b) はゲートの受理面を広げるためコマンド形式検証の攻撃面・回帰面が増える。
  compatibility: `npm test` の呼び出し面（CI 3 workflow・verify run・開発者手元）は不変。
  node --test の並列度は既定 os.availableParallelism から 2 に固定されるが、本スイートは I/O 律速で
  ネガティブスケーリングするため 2 が実測最適（高負荷ホストで無制限並列 28分の実測あり）。
  rollback: package.json の test script 1行と DEFAULT_TIMEOUT_MS 1定数を戻すだけで完全復元できる。
  boundary: 変更は package.json の test script と src/verification-runner.js の DEFAULT_TIMEOUT_MS、
  およびその回帰テストのみ。verification-evidence.js のコマンド形式ゲートは変更しない。
---

# Story: unit証跡の全体スイート実行を実測最適並列度に正本化する

## User Story

**As a** VibePro self-dogfood フローで unit 検証証跡を記録するエージェント
**I want to** ゲートが受理する全体スイートコマンド `npm test` がそのまま実測最適の並列度で実行される
**So that** 証跡コマンドと実実行手段が乖離せず、高負荷ホストでもスイートがタイムアウト・低速化しない

## Background

VibePro のテストスイートは I/O 律速で、並列度を上げるとかえって遅くなる（ネガティブスケーリング）。
実測最適は `--test-concurrency=2`。一方 `verify record` / `verify run` の unit 証跡コマンド形式ゲート
（`src/verification-evidence.js` の `assertCommandMatchesVerificationKind`）は全体スイートとして
`npm test`（= `node --test`、既定の無制限並列）等の定型のみ受理し、`node --test --test-concurrency=2`
は任意コマンドとして弾く。その結果、証跡記録は最適でない無制限並列の `npm test` に縛られ、
load average 100 の高負荷ホストでは 28 分の実測がある。`verify run` の既定タイムアウト
（`DEFAULT_TIMEOUT_MS` = 1800000 ms = 30 分）に対しギリギリで、タイムアウトすると
「テスト失敗ではない fail 証跡」が記録される。

## Acceptance Criteria

- [ ] `package.json` の `test` script が `node --test --test-concurrency=2` であり、`npm test` が実測最適並列度で全体スイートを実行する
- [ ] `npm test` は従来どおり unit 証跡コマンド形式ゲートに受理される（ゲートロジック無変更）
- [ ] `verify run` の既定タイムアウトが 7200000 ms（120 分）で、タイムアウト未指定の run 証跡に反映される
- [ ] test script の並列度指定が失われたら fail する回帰テストがある
- [ ] 既定タイムアウトが縮んだら fail する回帰テストがある

## Implementation Notes

- 変更対象: `package.json`（test script）、`src/verification-runner.js`（`DEFAULT_TIMEOUT_MS`）
- 変更しない: `src/verification-evidence.js` のコマンド形式ゲート（`npm test` 受理面は既存のまま）
- タイムアウト 120 分は実測ベース。load average ~100 の無制限並列で 28 分、load average ~35 の concurrency=2 で 56 分（本Story作業中の verify run 実測、duration_ms=3379319）。最悪実測 56 分に対し約2倍の余裕を取る。タイムアウト fail は「テスト失敗でない fail」を生むため保守的に取る
