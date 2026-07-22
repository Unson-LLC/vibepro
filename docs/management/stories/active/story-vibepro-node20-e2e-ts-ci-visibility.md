---
story_id: story-vibepro-node20-e2e-ts-ci-visibility
title: Node 20 CIレーンのe2e .ts spec偽passを可視化しNode 22+必須ゲートで実行する
status: active
view: dev
period: 2026-07
category: quality
related_stories: []
parent_design:
  - vibepro-node20-e2e-ts-ci-visibility
reason: "CIマトリクスのNode 20レーンでは npm test（node --test 引数なし）が test/e2e/*.spec.ts を発見すらせず黙ってスキップする（Node 20の既定discovery globは .ts を含まない）。一方Node 22.6+は型ストリッピングで .ts specを発見・実行する。このためe2e acceptance replay specに対するNode 20レーンの「pass」は実行ゼロの偽の安心になっている（実例: PR #370のCIでNode 22レーンのみtests 412、Node 20レーンはtests 258で、.ts spec由来の失敗はNode 22レーンでしか検出されなかった）。対処は (a) e2e .ts specをNode 22+の必須ゲートとして明示実行し、(b) Node 20レーンでは偽装実行せずスキップ件数を明示annotationで可視化する。rollback: ci.ymlの追加stepとpackage.jsonのscript・scripts/run-e2e-ts-specs.mjsを削除すれば従来挙動へ戻る。"
created_at: 2026-07-22
updated_at: 2026-07-22
---

# Node 20 CIレーンのe2e .ts spec偽passを可視化しNode 22+必須ゲートで実行する

## User Value

e2e acceptance replay spec（test/e2e/*.spec.ts）がCIで確実に実行される単一の必須ゲート（Node 22+）を持ち、実行できないNode 20レーンではカバレッジギャップが件数付きで可視化される。これにより「両レーンpass＝全テスト通過」という誤読と、.ts spec回帰のmainすり抜けがなくなる。

## Background（コード事実・ローカル実証済み）

- `package.json` の `test` は `node --test`（引数なし）。
- Node 20（v20.20.2で実証）: `node --test` の既定discoveryは `.ts` を含まないため、`test/e2e/*.spec.ts`（現在25ファイル）を**発見すらせず**実行0件のままexit 0。ジョブはpassする。
- Node 20で `.ts` を明示指定した場合は `ERR_UNKNOWN_FILE_EXTENSION` でexit 1（型ストリッピング非対応）。
- Node 22.22.0で実証: `node --test` は `.ts` specを発見し型ストリッピングで実行する。
- 実例: PR #370のCIで、Node 22レーンは tests 412 / Node 20レーンは tests 258。`.ts` spec由来の失敗はNode 22レーンでのみ検出された。
- `.github/workflows/ci.yml` のmatrixは node-version 20 / 22 の2レーンで、両レーンとも同一の `npm test` を実行している。

## Acceptance Criteria

- [ ] NCIT-S-1: `scripts/run-e2e-ts-specs.mjs` が `test/e2e/*.spec.ts` を決定的に列挙し、0件の場合はexit 1で失敗する（silent no-opの禁止）。
- [ ] NCIT-S-2: Node 22.6.0以上で実行された場合、列挙した全specファイルを `node --test` に明示的に渡して実行し、テスト失敗時は非0 exitを伝播する（必須ゲート化）。
- [ ] NCIT-S-3: Node 22.6.0未満で実行された場合、偽装実行せずスキップした旨とspec件数をGitHub Actions annotation（`::warning::`）および標準出力に明示してexit 0する。`ERR_UNKNOWN_FILE_EXTENSION` は発生させない。
- [ ] NCIT-S-4: `package.json` に `test:e2e:ts` scriptが定義され、`.github/workflows/ci.yml` の全matrixレーンで `npm test` 後のstepとして実行される。これによりNode 22レーンがe2e .ts specの必須ゲートになり、Node 20レーンはギャップ可視化になる。
- [ ] NCIT-S-5: 回帰テスト（`.js`、両レーンで実行される）が以下を固定する: (1) `test:e2e:ts` scriptとscripts本体の存在、(2) ci.ymlがstepとして参照していること、(3) 0件ガードが失敗すること、(4) Node versionしきい値判定（22.6.0境界）が正しいこと、(5) 実行モード/スキップモードの分岐がプロセス実行で再現されること。

## Non Goals

- Node 20サポート自体の打ち切り（engines変更・matrixからの除去）。
- `npm test`（`node --test` 引数なし）の既定discovery挙動の変更。
- 既存 `test/e2e/*.spec.ts` の内容変更・`.js` への変換。
- tsconfigや型チェック体制の変更。
