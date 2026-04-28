# VibePro CLI graphify 連携 Spec

## Source

| 項目 | 参照 |
|------|------|
| Story SSOT | NocoDB `番号=2`: M1: VibePro 診断→商用化ロードマップ |
| Story ID | `story-vibepro-diagnosis-commercialization-roadmap` |
| Architecture | [VibePro CLI graphify 連携 Architecture](../architecture/vibepro-cli-graphify-architecture.md) |
| Frame | [VibePro リポジトリ内制御基盤 Frame](../frames/vibepro-repo-local-control-plane-frame.md) |

## 目的

VibePro CLI は、対象リポジトリに `.vibepro/` 作業領域を作り、graphify の文脈成果物を取り込み、本番化診断の成果物と Brainbase 連携用の管理目録を生成する。

## コマンド

### `vibepro init [repo]`

対象リポジトリに VibePro 作業領域を作る。

作成するもの:

- `.vibepro/config.json`
- `.vibepro/vibepro-manifest.json`
- `.vibepro/graphify/`
- `.vibepro/diagnostics/`
- `.vibepro/raw/`
- `.vibeproignore`
- `.gitignore` の VibePro 生証跡除外

### `vibepro graph [repo] [--from <graphify-out>] [--run-graphify]`

graphify の成果物を `.vibepro/graphify/` に取り込む。

`--from` がない場合は、対象リポジトリ直下の `graphify-out/` を読む。

`--run-graphify` がある場合は、取り込み前に対象リポジトリで次を実行する。

```bash
graphify . --out graphify-out
```

`--from <path>` と併用する場合は、`graphify . --out <path>` を実行してから取り込む。

graphify が見つからない場合は、`uv tool install graphifyy` を案内して失敗する。

必須入力:

- `graph.json`
- `GRAPH_REPORT.md`

任意入力:

- `graph.html`

### `vibepro diagnose [repo] [--run-id <id>]`

`.vibepro/graphify/graph.json` を入力として診断runを作る。

出力:

- `.vibepro/diagnostics/<run-id>/summary.md`
- `.vibepro/diagnostics/<run-id>/risk-register.md`
- `.vibepro/diagnostics/<run-id>/evidence.json`

## 管理目録

管理目録は `.vibepro/vibepro-manifest.json` とする。

最小構造:

```json
{
  "schema_version": "0.1.0",
  "tool": "vibepro",
  "repo": {
    "root": ".",
    "git_remote": null,
    "commit": null
  },
  "latest_run": null,
  "artifacts": {},
  "runs": []
}
```

`graph` 実行後、`artifacts.graphify_json` と `artifacts.graphify_report` を更新する。

`--run-graphify` 付きで実行した場合は、`graphify.last_execution` に実行コマンド、開始時刻、終了時刻、終了コードを記録する。

`diagnose` 実行後、`latest_run` と `runs[0]` を更新する。

## 証跡

`evidence.json` は、graphify 由来の文脈品質を構造化して保存する。

最小項目:

- node 数
- edge 数
- 抽出された関係
- 推論された関係
- 曖昧な関係
- 検出事項
- ゲート結果

## ゲート

初期実装では `production-readiness` ゲートのみを持つ。

判定:

- 曖昧な関係がある場合: `needs_review`
- 中以上の確認事項がない場合: `pass`

## 受け入れ条件

- `init` で `.vibepro/` と除外設定が作られる。
- `graph` で graphify 成果物が `.vibepro/graphify/` に入る。
- `graph` で管理目録に graphify 成果物のパスが記録される。
- `diagnose` で `summary.md`、`risk-register.md`、`evidence.json` が作られる。
- `diagnose` で管理目録の `latest_run` と `runs[0]` が更新される。
- 生証跡は `.gitignore` でデフォルト除外される。
