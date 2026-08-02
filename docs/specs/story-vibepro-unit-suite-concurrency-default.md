# Spec: unit証跡の全体スイート実行を実測最適並列度に正本化する

- story_id: story-vibepro-unit-suite-concurrency-default
- machine_spec: `.vibepro/spec/story-vibepro-unit-suite-concurrency-default/spec.json`（validateSpec で機械検証される正本。本書は人間可読の contract doc）

## Contract: `npm test`（公開実行契約）

| 観点 | 旧 | 新 |
|---|---|---|
| `package.json` `scripts.test` | `node --test` | `node --test --test-concurrency=2` |
| コマンド surface | `npm test` | `npm test`（不変） |
| exit code / TAP 出力 | node:test 準拠 | node:test 準拠（不変） |
| 並列度 | `os.availableParallelism`（無制限） | 2（実測最適） |

互換性: `npm test` を呼ぶすべての消費者（CI 3 workflow、`vibepro verify run`、開発者手元）は
コマンド文字列不変のまま新しい並列度を得る。unit 証跡コマンド形式ゲート
（`src/verification-evidence.js` `assertCommandMatchesVerificationKind`）は本変更で一切変更されず、
`npm test` の受理は関数レベル回帰テストで固定される。

根拠となる実測: 本スイートは I/O 律速でネガティブスケーリングする。無制限並列は
load average ~100 で 28 分。`--test-concurrency=2` は実測最適（過去セッションの独立測定）。

## Contract: `verify run` 既定タイムアウト

| 観点 | 旧 | 新 |
|---|---|---|
| `DEFAULT_TIMEOUT_MS`（`src/verification-runner.js`） | 1800000 (30分) | 7200000 (120分) |
| `--timeout-ms` 明示時 | 明示値 | 明示値（不変） |
| 観測性 | `run.timeout_ms` に記録 | `run.timeout_ms` に記録（不変） |

方向性: permissive-only。旧既定で完走していた run はすべて完走する。タイムアウト kill は
「テスト失敗ではない fail 証跡」を生むため、最悪実測（load ~35・concurrency=2 で 56 分、
duration_ms=3379319）の約 2 倍を既定余裕とする。ハングしたコマンドが最長 120 分 runner を
占有し得る新リスクは、`--timeout-ms` 明示で呼び出し側が常に上書きできることで有界。

## Invariants（機械検証との対応）

- INV-001: `scripts.test` は `node --test --test-concurrency=2` そのものであり、ゲートが受理する
  唯一の全体スイートコマンド `npm test` が実測最適並列度で実行される。
  回帰: `test/full-suite-command-form.test.js`（strict equality、pin 喪失で fail）
- SLA-001: タイムアウト未指定の `verify run` は `run.timeout_ms=7200000` を artifact に記録する。
  回帰: `test/verification-runner.test.js`（実行後 artifact への strict equality、縮小で fail）

## Rollback

`package.json` の script 1 行と `DEFAULT_TIMEOUT_MS` 1 定数の revert で完全復元。運用手順の変更なし。
