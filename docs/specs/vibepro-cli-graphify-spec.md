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

### `vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]`

対象リポジトリに VibePro 作業領域を作る。

作成するもの:

- `.vibepro/config.json`
- `.vibepro/vibepro-manifest.json`
- `.vibepro/graphify/`
- `.vibepro/diagnostics/`
- `.vibepro/raw/`
- `.vibeproignore`
- `.gitignore` の VibePro 生証跡除外

`--story-id` を指定した場合は、同じ初期化の中でローカルStoryも作成し、`.vibepro/config.json` の `brainbase.current_story_id` に選択状態として保存する。

作成するStory:

- `story_id`
- `title`
- `ssot: local`
- `status: active`
- `horizon`
- `view`
- `period`
- `started_at`
- `due_at`

`--story-id` 指定時は `--title` を必須とする。同じ `story_id` がすでに存在する場合は失敗する。

### `vibepro graph [repo] [--from <graphify-out>] [--run-graphify]`

graphify の成果物を `.vibepro/graphify/` に取り込む。

`--from` がない場合は、対象リポジトリ直下の `graphify-out/` を読む。

`--run-graphify` がある場合は、取り込み前に対象リポジトリで次を実行する。

```bash
graphify update .
```

`--from <path>` と併用する場合は、`graphify update .` が生成した `graphify-out/` の成果物を `<path>` に複製してから取り込む。

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
- `.vibepro/diagnostics/<run-id>/architecture-profile.md`
- `.vibepro/diagnostics/<run-id>/static-site-check-result.md`
- `.vibepro/diagnostics/<run-id>/evidence.json`

選択中Storyがある場合、診断runはそのStoryに紐づく。`evidence.json` と管理目録の `runs[]` には次を記録する。

- `story_id`
- `story`

診断はモードを増やさず、最初に構造プロファイルを作る。構造プロファイルは `package.json`、API route、配信設定、主要依存、認証境界、環境ファイルから次を判定する。

- system type: `web_application` / `static_site` / `unknown`
- 種別: `static_site` / `web_app` / `unknown`
- frameworks: `nextjs` / `react` / `vue` / `svelte`
- 描画方式: `nextjs` / `react` / `vue` / `svelte`
- Architecture Views: `structure` / `runtime` / `data` / `security` / `deployment` / `quality`
- 適用チェック一覧

適用チェックは `evidence.check_catalog.selected_views[]` と `evidence.check_catalog.applicable_checks[]` に記録する。例:

- 共通: `secrets`、`xss`、`dependency-graph`
- 静的サイト: `static-entry`、`static-publish-surface`、`external-resources`
- Webアプリ: `api-boundary`
- DBあり: `database-access`
- 認証あり: `auth-boundary`
- 配信設定あり: `deployment-readiness`

### `vibepro story list [repo] [--all]`

`.vibepro/config.json` の `brainbase.stories[]` を表示する。

通常は `status: archived` のStoryを表示しない。`--all` 指定時は archived Story も表示する。`brainbase.current_story_id` と一致するStoryには選択中マーカーを付ける。

### `vibepro story add [repo] --id <id> --title <title> [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]`

NocoDBを使わず、対象リポジトリ内の `.vibepro/config.json` にローカルStoryを追加する。

追加するStory:

- `story_id`
- `title`
- `ssot: local`
- `status: active`
- `horizon`
- `view`
- `period`
- `started_at`
- `due_at`

同じ `story_id` がすでに存在する場合は失敗する。

### `vibepro story select [repo] --id <id>`

`.vibepro/config.json` の `brainbase.current_story_id` を更新する。

選択中Storyは `vibepro brainbase` が生成する `import-state.json` の代表 `story` になる。archived Storyは選択できない。

### `vibepro story archive [repo] --id <id>`

対象Storyの `status` を `archived` にする。

archived Storyは通常の `story list` と `import-state.json` の `stories[]` から除外する。選択中Storyをarchiveした場合は `brainbase.current_story_id` を `null` にする。

### `vibepro story runs [repo] [--id <id>]`

選択中Storyまたは `--id` 指定Storyに紐づく診断run一覧を表示する。

表示する項目:

- Story ID
- Story名
- Run ID
- 作成日時
- ゲート状態
- evidence artifactパス

### `vibepro story status [repo] [--id <id>]`

選択中Storyまたは `--id` 指定Storyの現在状態を表示する。

表示する項目:

- Story ID
- Story名
- Story status
- View
- Period
- 最新run
- 最新runのゲート状態
- 検出事項数
- run数
- artifactパス

### `vibepro story report [repo] [--id <id>]`

選択中Storyまたは `--id` 指定Storyの診断レポートを生成する。

出力:

- `.vibepro/stories/<story-id>/story-report.md`

レポートには次を含める。

- Story基本情報
- 最新run
- ゲート状態
- graphify集計
- 構造プロファイル
- 共通スキャン集計
- 検出事項一覧
- artifactパス
- 次に見るファイル

管理目録の `stories.<story-id>.latest_report` に最新レポートのパスを記録する。

### `vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>]`

NocoDBなしのローカルStory診断フローを1コマンドで実行する。

実行順序:

1. `story select`
2. `graph`
3. `diagnose`
4. `story report`
5. `story status`

`--run-graphify` 指定時は `graph` でgraphifyも実行する。`--run-id` 指定時は診断run IDに使う。

### `vibepro status [repo] [--json]`

対象リポジトリの VibePro 状態を表示する。

未初期化リポジトリでも実行できる。この場合、`.vibepro` は作らず、`initialized: false` と次に実行する `vibepro init` を返す。

表示する項目:

- 初期化済みか
- 選択中Story
- active Story一覧
- リポジトリ全体の最新run
- 選択中Storyに紐づく最新run
- ゲート状態
- 検出事項数
- 主要artifactパス
- 次に実行するコマンド

`--json` 指定時は同じ内容を機械可読JSONとして出力する。active Story一覧は選択中Storyを先頭に並べる。

### `vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]`

最新の診断runを Brainbase が読める形に正規化する。

入力:

- `.vibepro/vibepro-manifest.json`
- 最新runの `.vibepro/diagnostics/<run-id>/evidence.json`
- `--sync-stories` 指定時は NocoDB ストーリーテーブル

`brainbase.current_story_id` に紐づく診断runが存在する場合は、そのStoryの最新runを優先する。該当runがない場合は、リポジトリ全体の `latest_run` にフォールバックする。

出力:

- `.vibepro/brainbase/import-state.json`
- `.vibepro/brainbase/import-summary.md`
- `--publish-status --dry-run` 指定時は `.vibepro/brainbase/publish-preview.json`
- `--publish-status --dry-run` 指定時は `.vibepro/brainbase/publish-preview.md`
- `--publish-status` 指定時は `.vibepro/brainbase/publish-backup.json`
- `--publish-status` 指定時は `.vibepro/brainbase/publish-result.json`

`import-state.json` には次を含める。

- `stories[]`
- 代表 `story`
- 最新run ID
- 最新runの `story_id`
- ゲート状態
- graphify の集計シグナル
- 構造プロファイル
- 共通スキャンの集計シグナル
- 検出事項
- 成果物パス

`--sync-stories` 指定時は、NocoDB の `archived` 以外の Story レコードを読み、`.vibepro/config.json` の `brainbase.stories[]` を更新してから `import-state.json` を生成する。

`--publish-status` 指定時は、生成した `import-state.json` をもとに代表Storyの NocoDB レコードを `Story ID` で検索し、`説明` カラムの `VibePro診断同期` セクションを追記または置換する。Story本来の `ステータス` カラムは変更しない。

`--publish-status --dry-run` 指定時は、NocoDB へのPATCHを行わず、更新後の `説明` を preview artifact に保存する。管理目録の `brainbase.last_publish_preview` に preview artifact のパスを記録する。

`--publish-status` 指定時は、PATCH前に現在の `説明` と更新予定の `説明` を backup artifact に保存する。PATCH後は対象Storyを再取得し、`説明` が更新予定の内容と一致することを検証する。検証に成功した場合のみ result artifact を保存し、管理目録の `brainbase.last_publish_result` に backup / result artifact のパスを記録する。

`--story-id <id>` 指定時は、`import-state.json` の `stories[]` から対象Storyを選ぶ。指定IDが存在しない場合は失敗する。未指定時は代表 `story` を使う。

NocoDB 接続は次を使う。

- `NOCODB_URL`
- `NOCODB_TOKEN`
- `NOCODB_STORY_BASE_ID`
- `NOCODB_STORY_TABLE_ID`

`NOCODB_STORY_BASE_ID` と `NOCODB_STORY_TABLE_ID` が未指定の場合は、VibePro の既定 Story base / table を使う。

Story 設定は `.vibepro/config.json` の `brainbase.stories[]` を読む。各Storyは NocoDB のストーリーテーブル正本カラムに合わせて次を持つ。

- `story_id`
- `title`
- `ssot`
- `status`
- `horizon`
- `view`
- `period`
- `started_at`
- `due_at`

`brainbase.current_story_id` が active Storyを指している場合、そのStoryを `import-state.json` の代表 `story` にする。未指定または該当なしの場合は active Storyの先頭を代表にする。

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

`diagnose` 実行後、`latest_run`、`latest_run_by_story`、`runs[0]` を更新する。

`brainbase` 実行後、`artifacts.brainbase_import_state`、`artifacts.brainbase_import_summary`、`brainbase.last_export` を更新する。

`brainbase --publish-status --dry-run` 実行後、`brainbase.last_publish_preview` に preview artifact のパスを記録する。

`brainbase --publish-status` 実行後、`brainbase.last_publish_result` に publish 対象Story、検証状態、backup / result artifact のパスを記録する。

## 証跡

`evidence.json` は、graphify 由来の文脈品質、構造プロファイル、API境界、共通スキャン、静的サイト固有チェックを構造化して保存する。Markdown レポートはこの構造化証跡から生成される投影とする。

最小項目:

- `graphify.node_count`
- `graphify.edge_count`
- `graphify.extracted_edges`
- `graphify.inferred_edges`
- `graphify.ambiguous_edges`
- `static_site.has_index_html`
- `static_site.scanned_files`
- `static_site.secret_hits`
- `static_site.secret_hits[].source_kind`
- `static_site.secret_hits[].confidence`
- `static_site.secret_hits[].gate_effect`
- `static_site.xss_risk_hits`
- `static_site.xss_risk_hits[].source_kind`
- `static_site.xss_risk_hits[].confidence`
- `static_site.xss_risk_hits[].gate_effect`
- `static_site.risk_summary`
- `static_site.external_resources`
- `static_site.non_static_files`
- `architecture_profile.system_type`
- `architecture_profile.app_type`
- `architecture_profile.frameworks`
- `architecture_profile.rendering`
- `architecture_profile.views`
- `architecture_profile.has_api_routes`
- `architecture_profile.has_database`
- `architecture_profile.has_auth`
- `check_catalog.selected_views`
- `check_catalog.applicable_checks`
- `api_boundary.route_count`
- `api_boundary.middleware.matchers`
- `api_boundary.summary`
- `api_boundary.protection_summary`
- `api_boundary.routes[].route_path`
- `api_boundary.routes[].classification`
- `api_boundary.routes[].protection`
- `api_boundary.routes[].risk_hints`
- `action_candidates[].id`
- `action_candidates[].finding_id`
- `action_candidates[].target_count`
- `action_candidates[].execution_policy`
- `action_candidates[].mutates_repository`
- `action_candidates[].route_examples`
- 検出事項
- ゲート結果

## ゲート

初期実装では `production-readiness` ゲートのみを持つ。

判定:

- 秘密情報候補など Critical の検出事項がある場合: `block`
- 曖昧な関係、XSSリスク候補、適用チェック上の High / Medium の検出事項がある場合: `needs_review`
- 中以上の確認事項がない場合: `pass`

## 受け入れ条件

- `init` で `.vibepro/` と除外設定が作られる。
- `init --story-id` でNocoDBなしにローカルStoryを作り、選択中Storyにできる。
- `init --story-id` で同じStory IDがすでに存在する場合は失敗する。
- `graph` で graphify 成果物が `.vibepro/graphify/` に入る。
- `graph` で管理目録に graphify 成果物のパスが記録される。
- `diagnose` で `summary.md`、`risk-register.md`、`architecture-profile.md`、`static-site-check-result.md`、`evidence.json` が作られる。
- `diagnose` で `evidence.architecture_profile` と `evidence.check_catalog.applicable_checks` が記録される。
- `diagnose` で `api-boundary` が適用される場合、`evidence.api_boundary.routes[]` にAPI route分類、保護根拠、risk hintsが記録される。
- `diagnose` で `evidence.static_site` に共通スキャン結果と静的サイト固有チェック結果が記録される。
- `diagnose` でWebアプリを検出した場合、`index.html` 不在と非静的ファイル混在を静的サイトの検出事項として扱わない。
- `diagnose` で `evidence.story_id` と `runs[].story_id` が選択中Storyに紐づく。
- `diagnose` で管理目録の `latest_run`、`latest_run_by_story`、`runs[0]` が更新される。
- `story add` でNocoDBなしにローカルStoryを追加できる。
- `story list` でactive Storyを表示できる。
- `story select` で代表Storyを選択できる。
- `story archive` でStoryをarchivedにできる。
- `story runs` でStoryに紐づく診断run一覧を表示できる。
- `story status` でStoryの最新run、ゲート状態、検出事項数、artifactパスを表示できる。
- `story report` でStory単位の診断レポートartifactを生成できる。
- `story diagnose` でStory選択、graphify取り込み、診断、レポート生成、status表示を1コマンドで実行できる。
- `status` は未初期化リポジトリでも `.vibepro` を作らず状態を表示できる。
- `status` で選択中Story、active Story、最新run、選択中Storyの最新run、ゲート、検出事項数、artifact、次のコマンドを表示できる。
- `status --json` で同じ状態を機械可読JSONとして出力できる。
- `brainbase` で `import-state.json` と `import-summary.md` が作られる。
- `brainbase` で選択中Storyが代表 `story` に記録される。
- `brainbase` で選択中Storyに紐づく最新runが優先される。
- `brainbase` で複数active Story、view、期間が `import-state.json` に記録される。
- `brainbase` でarchived Storyは `import-state.json` から除外される。
- `brainbase --sync-stories` でNocoDBのactive Storyが `brainbase.stories[]` に同期される。
- `brainbase --publish-status` でNocoDB Storyの `説明` に診断同期セクションが書き戻される。
- `brainbase --publish-status` でPATCH前の説明が backup artifact に保存される。
- `brainbase --publish-status` でPATCH後にStoryを再取得し、`説明` の一致が検証される。
- `brainbase --publish-status` で検証結果が result artifact と管理目録に記録される。
- `brainbase --publish-status` でNocoDB Storyの `ステータス` は変更されない。
- `brainbase --publish-status --dry-run` でNocoDBへPATCHせずに preview artifact が作られる。
- `brainbase --publish-status --story-id <id>` で書き戻し対象Storyを明示できる。
- `brainbase` で管理目録に Brainbase 取り込み成果物のパスが記録される。
- 生証跡は `.gitignore` でデフォルト除外される。
