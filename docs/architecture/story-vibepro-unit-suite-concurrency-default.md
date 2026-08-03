# Architecture: unit証跡の全体スイート実行契約（npm test 並列度と verify run 既定タイムアウト）

- design_root_id: vibepro-unit-suite-concurrency-default
- story: [story doc](../management/stories/active/story-vibepro-unit-suite-concurrency-default.md)
- spec: [contract doc](../specs/story-vibepro-unit-suite-concurrency-default.md)

## Owned surface

1. `package.json` `scripts.test` — unit 証跡コマンド形式ゲートが全体スイートとして受理する唯一の
   コマンド `npm test` の実体。ここが実測最適並列度（`--test-concurrency=2`）の正本。
2. `src/verification-runner.js` `DEFAULT_TIMEOUT_MS` — `verify run` がタイムアウト未指定時に
   適用する既定値の正本（7200000 ms）。

## Design decision

ゲートの受理面（`src/verification-evidence.js` `assertCommandMatchesVerificationKind`）を広げる案
（`node --test --test-concurrency=N` を全体スイートとして受理）は採らない。受理面の拡張は
コマンド形式検証の攻撃面・回帰面を増やすため、既に受理される `npm test` の実体を npm script 側で
最適化する。これによりゲート判定ロジックは無変更のまま、証跡コマンドと実実行の乖離が消える。

タイムアウト既定は実測駆動: 28 分（load ~100、無制限並列）と 56 分（load ~35、concurrency=2、
duration_ms=3379319）の実測に対し、タイムアウト kill が「テスト失敗ではない fail 証跡」を生むことを
踏まえ、最悪実測の約 2 倍（120 分）を既定余裕とする。`--timeout-ms` 明示は常に優先される。

## Regression guards

- `test/full-suite-command-form.test.js` — script pin の strict equality とゲート受理の関数レベル検証
- `test/verification-runner.test.js` — 既定タイムアウトの run artifact への反映を実実行で検証
