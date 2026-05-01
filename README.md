# VibePro - リポジトリ診断CLI

Vibe Coding で作成されたリポジトリの公開前チェックを支援する

## VibePro CLI

VibePro は対象リポジトリ内に `.vibepro/` 作業領域を作り、診断結果、証跡、ゲート状態、Brainbase 連携用の管理目録を管理する。

### インストール

```bash
npm install
node bin/vibepro.js --help
node bin/vibepro.js help
```

パッケージとして導入した場合:

```bash
npx vibepro --help
npx vibepro help
```

VibePro の会議、商用化ロードマップ、Brainbase/NocoDB 運用資料は `vibepro-project` で管理する。この `vibepro` リポジトリには、npm/OSS 配布する CLI 本体と公開可能な仕様だけを置く。

### 1. 初期化

```bash
npm install
node bin/vibepro.js init /path/to/repo
```

NocoDBなしで最初のStoryまで作る場合:

```bash
node bin/vibepro.js init /path/to/repo \
  --story-id story-local-hardening \
  --title "ローカル診断強化" \
  --view dev \
  --period 2026-W18
```

`--story-id` を指定すると、`ssot: local` のStoryを `.vibepro/config.json` に追加し、そのStoryを選択中にする。同じStory IDがすでにある場合は失敗する。

生成される主なファイル:

```text
/path/to/repo/
├── .vibepro/
│   ├── config.json
│   ├── vibepro-manifest.json
│   ├── graphify/
│   ├── diagnostics/
│   └── raw/
├── .vibeproignore
└── .gitignore
```

`.gitignore` には `.vibepro/raw/` など、生証跡を誤ってコミットしないための除外設定を追加する。

### 2. graphify 成果物の取り込み

VibePro から graphify を起動して取り込む場合:

```bash
node bin/vibepro.js graph /path/to/repo --run-graphify
```

内部では対象リポジトリで `graphify update .` を実行し、生成された `graphify-out/` を `.vibepro/graphify/` に取り込む。

graphify が未インストールの場合は、先にインストールする。

```bash
uv tool install graphifyy
```

対象リポジトリで graphify を実行し、`graphify-out/` がある場合:

```bash
node bin/vibepro.js graph /path/to/repo
```

別の場所に graphify 成果物がある場合:

```bash
node bin/vibepro.js graph /path/to/repo --from /path/to/graphify-out
```

取り込む対象:

- `graph.json`
- `GRAPH_REPORT.md`
- `graph.html`（存在する場合）

### 3. 診断

```bash
node bin/vibepro.js diagnose /path/to/repo
```

生成される主な成果物:

```text
.vibepro/diagnostics/<run-id>/
├── summary.md
├── risk-register.md
├── finding-review.md
├── architecture-profile.md
├── static-site-check-result.md
└── evidence.json

.vibepro/stories/<story-id>/tasks/
├── tasks.json
└── tasks.md
```

`evidence.json` が診断内容の機械可読な正本になる。Markdown は人間が確認するための投影として生成する。

`finding-review.md` は検出事項ごとのレビュー票であり、`true_positive`、`false_positive`、`false_negative`、`detector_gap`、`implementation_gap` の分類で確認できるようにする。初期状態では VibePro が `suggested_classification` を付けるが、確定分類ではなく `unreviewed` として扱う。これにより「実装が弱い」のか「診断器が拾えていない」のかを、修正前に切り分けられる。

`tasks.json` は診断結果から生成されたStory単位の作業分解であり、Critical/Highの未対応検出事項と `action_candidates[]` を実装前タスクへ正規化する。VibeProはv1ではタスク生成までを担当し、対象リポジトリの修正は行わない。

`story select` で選択中Storyがある場合、診断runはそのStoryに紐づく。`evidence.json` と `vibepro-manifest.json` の `runs[]` には `story_id` とStory情報を記録する。

診断ではモードを増やさず、まず対象リポジトリの構造プロファイルを作る。`package.json`、API route、配信設定、主要依存、認証境界、環境ファイルを読み、Architecture Views を組み立てる。そのうえでViewから適用するチェックを選ぶ。

最初のView:

- Structure: 種別、フレームワーク、構成要素
- Runtime: API route、middleware、server actionなどの実行入口
- Data: DB種別、アクセスパターン
- Security: 認証境界、秘密情報の置き場
- Deployment: Vercel、Fly、Dockerなどの配信先
- Quality: テスト、CI

共通チェックでは秘密情報候補、XSSリスク候補、graphify上の曖昧な関係を確認する。静的サイトに該当する場合だけ、次の観点を静的サイト固有チェックとして扱う。

`api-boundary` が適用される場合は、API routeを `public`、`authenticated`、`admin`、`internal`、`webhook`、`debug`、`cron_batch_queue` に分類し、middleware matcherやroute内の認証参照、webhook署名検証らしき実装を保護根拠として記録する。

- ルート `index.html` の有無
- 秘密情報候補
- XSS につながり得る DOM 操作
- 外部リソース参照
- 静的配信対象外のファイル候補

秘密情報候補がある場合、`production-readiness` ゲートは `block` になる。高または中の確認事項がある場合は `needs_review` になる。

`vibepro-manifest.json` には最新の実行ID、ゲート状態、成果物パスを記録する。Brainbase はこの管理目録を読む。

### 4. 点検

```bash
node bin/vibepro.js doctor /path/to/repo
node bin/vibepro.js doctor /path/to/repo --fix
node bin/vibepro.js doctor /path/to/repo --json
```

`doctor` は `.vibepro/` の整合性を点検する。未初期化リポジトリでは `.vibepro/` を作らず、`uninitialized` と次の案内だけを返す。

主な点検項目:

- `current_story_id` が存在するactive Storyを指しているか
- `latest_run` と `latest_run_by_story` が実在runを指しているか
- 診断runが存在する `evidence.json` を参照しているか
- graphify成果物参照が実在ファイルを指しているか
- `story-catalog.json` と `config.json` のStory一覧がずれていないか
- handoff/execution成果物内の briefing / plan / handoff 参照が欠けていないか

`--fix` を付けた場合は、欠けた参照だけを管理情報から整理する。具体的には、欠けたevidenceを参照するrunの除去、存在しないlatest run参照の解除、存在しないgraphify成果物参照の解除、存在しないcurrent Storyの解除、Story catalogからconfigへの不足Story追加、古い派生Storyのarchiveを行う。対象リポジトリのコード、Story成果物、診断成果物そのものは変更しない。

`status` は `doctor` の読み取り点検を内部で実行し、保守が必要な場合は次のコマンドとして `vibepro doctor` と `vibepro doctor --fix` を先に表示する。

`doctor` の結果には `next_commands` が含まれる。task workflow成果物の欠けた参照については、該当する `vibepro task handoff ...` または `vibepro task execute ...` の再実行コマンドまで表示する。

点検結果は以下に出力する。

```text
.vibepro/doctor/
├── doctor-result.json
└── doctor-result.md
```

### 5. ローカルStory管理

NocoDBを使わず、対象リポジトリの `.vibepro/config.json` だけでStoryを管理できる。

初回から診断までの最短手順:

```bash
node bin/vibepro.js init /path/to/repo \
  --story-id story-local-hardening \
  --title "ローカル診断強化" \
  --view dev \
  --period 2026-W18

node bin/vibepro.js story diagnose /path/to/repo --id story-local-hardening --run-graphify
```

Storyを後から追加する場合:

```bash
node bin/vibepro.js story add /path/to/repo \
  --id story-local-hardening \
  --title "ローカル診断強化" \
  --horizon sprint \
  --view dev \
  --period 2026-W18

node bin/vibepro.js story select /path/to/repo --id story-local-hardening
node bin/vibepro.js story list /path/to/repo
node bin/vibepro.js story runs /path/to/repo
node bin/vibepro.js story status /path/to/repo
node bin/vibepro.js story report /path/to/repo
node bin/vibepro.js story archive /path/to/repo --id story-local-hardening
```

コードGraphを更新してからリポジトリ全体のStory候補を作る場合:

```bash
node bin/vibepro.js story derive /path/to/repo --run-graphify
```

Story選択から診断レポート生成までをまとめて実行する場合:

```bash
node bin/vibepro.js story diagnose /path/to/repo --id story-local-hardening --run-graphify
```

リポジトリ全体の状態を見る場合:

```bash
node bin/vibepro.js status /path/to/repo
node bin/vibepro.js status /path/to/repo --json
```

`status` は未初期化リポジトリでも安全に実行できる。`.vibepro` は作らず、初期化済みか、選択中Story、active Story、最新run、選択中Storyの最新run、ゲート、検出事項数、主要成果物、次に実行するコマンドを表示する。

`story select` は `brainbase.current_story_id` を更新する。`diagnose` は選択中Storyをrunに記録し、`brainbase` コマンドは選択中Storyを代表Storyとして `import-state.json` に出力する。`archived` のStoryは通常の `story list` と `import-state.json` から除外される。確認したい場合は `story list --all` を使う。

`story diagnose` はStory選択、graphify取り込み、診断、Storyレポート生成、status表示を一度に行う。`story runs` は選択中Storyまたは `--id` 指定Storyに紐づく診断run一覧を表示する。`story status` はStoryの最新run、ゲート状態、検出事項数、artifactパスを表示する。`story report` は `.vibepro/stories/<story-id>/story-report.md` にStory単位の診断レポートを生成する。診断時には `.vibepro/stories/<story-id>/tasks/tasks.json` と `tasks.md` も自動生成し、Storyレポートには生成タスク一覧を投影する。いずれもNocoDBなしにローカルの `.vibepro/` だけで動く。

### 6. PR準備

Story実装後、PRを作る前に差分範囲を確認し、PR本文ドラフトを生成する。

```bash
node bin/vibepro.js pr prepare /path/to/repo --base origin/develop
```

生成される主な成果物:

```text
.vibepro/pr/<story-id>/
├── pr-prepare.json
├── pr-prepare.md
└── pr-body.md
```

対象リポジトリが未初期化の場合、成果物は一時ディレクトリに出力されます。この場合、`pr prepare` は対象リポジトリに `.vibepro/` や ignore 設定を作らないため、PR用のクリーンブランチを汚さずに差分診断だけを実行できます。

`pr prepare` は以下を確認する。

- 選択中Story
- Story文書から抽出した要求、背景、受け入れ基準
- ADR差分またはStory内のADR不要理由
- baseからHEADまでの変更ファイル
- Story / Architecture / Spec / Source / Test / repo制御ファイルの差分分類
- baseからのcommit数
- 未コミット差分
- 現在ブランチでPR化してよいか、クリーンブランチへ切り出すべきか

`pr-body.md` は、レビュアーが最初に確認したい情報を含む。

- 背景・要求
- 実装判断
- 変更内容
- 受け入れ基準
- 検証候補コマンド
- レビュー観点
- リスク・確認事項

差分が大きい、`.claude/` や `AGENTS.md` などのrepo制御ファイルが混ざる、複数commitが混在する、未コミット差分が残る場合は `needs_clean_branch` と判定する。この場合、VibePro は自動でPRを作らず、クリーンブランチ作成と cherry-pick の次コマンドを提示する。

例:

```bash
node bin/vibepro.js pr prepare /path/to/repo \
  --story-id story-local-hardening \
  --base origin/develop \
  --branch feat/local-hardening
```

機械可読な結果だけを見る場合:

```bash
node bin/vibepro.js pr prepare /path/to/repo --base origin/develop --json
```

### 7. Brainbase 取り込み状態の生成

```bash
node bin/vibepro.js brainbase /path/to/repo
```

生成される主な成果物:

```text
.vibepro/brainbase/
├── import-state.json
└── import-summary.md
```

`import-state.json` は Brainbase が読むための構造化状態であり、最新run、ゲート状態、診断シグナル、検出事項、成果物パスを含む。Brainbase は Markdown ではなく、このJSONを取り込み口として扱う。

生成タスクは `signals.tasks[]` に含まれる。Brainbase側は `action_candidates[]` ではなく、作業分解済みの `signals.tasks[]` を次の実装単位として扱える。

選択中Storyに紐づく診断runがある場合、`brainbase` はリポジトリ全体の最新runよりも、そのStoryの最新runを優先して `import-state.json` に出力する。

NocoDB のストーリー正本から対象Storyを同期する場合:

```bash
node bin/vibepro.js brainbase /path/to/repo --sync-stories
```

診断結果をNocoDB Storyの `説明` に書き戻す場合:

```bash
node bin/vibepro.js brainbase /path/to/repo --publish-status
```

書き戻し前にプレビューだけを作る場合:

```bash
node bin/vibepro.js brainbase /path/to/repo --publish-status --dry-run
```

対象Storyを明示する場合:

```bash
node bin/vibepro.js brainbase /path/to/repo --publish-status --dry-run --story-id story-vibepro-dev-brainbase-integration
```

必要な環境変数:

- `NOCODB_URL`
- `NOCODB_TOKEN`
- `NOCODB_STORY_BASE_ID`（省略時は既定のVibePro base）
- `NOCODB_STORY_TABLE_ID`（省略時は既定のストーリーテーブル）

`--sync-stories` は NocoDB のストーリーテーブルから `archived` 以外のStoryを読み、`.vibepro/config.json` の `brainbase.stories[]` を更新してから `import-state.json` を生成する。

`--publish-status` は代表Storyの `説明` に `VibePro診断同期` セクションを追記または置換する。Storyの `ステータス` は変更しない。

`--publish-status --dry-run` は NocoDB へPATCHせず、`.vibepro/brainbase/publish-preview.json` と `.vibepro/brainbase/publish-preview.md` を生成する。管理目録には `brainbase.last_publish_preview` を記録する。

`--publish-status` を実行した場合は、更新前の説明と更新予定内容を `.vibepro/brainbase/publish-backup.json` に保存してから NocoDB へPATCHする。PATCH後は対象Storyを再取得し、`説明` が生成した更新後説明と一致することを検証する。検証結果は `.vibepro/brainbase/publish-result.json` に保存し、管理目録には `brainbase.last_publish_result` を記録する。

`--story-id` は `import-state.json` の `stories[]` から対象Storyを選ぶ。未指定時は代表 `story` を使う。

対象Story、`Horizon` / `View` / `Period` / `開始日` / `期限日` は `.vibepro/config.json` の `brainbase.stories[]` で管理する。複数Storyを設定でき、`import-state.json` には active な `stories[]` と代表 `story` が出力される。NocoDBを使う場合は `--sync-stories` で正本から同期できる。

```json
{
  "brainbase": {
    "current_story_id": "story-local-hardening",
    "stories": [
      {
        "story_id": "story-local-hardening",
        "title": "ローカル診断強化",
        "ssot": "local",
        "status": "active",
        "horizon": "sprint",
        "view": "dev",
        "period": "2026-W18",
        "started_at": null,
        "due_at": null
      }
    ]
  }
}
```
