# VibePro - 静的サイト診断

Vibe Coding で作成された静的サイトの公開前チェックを支援する

## VibePro CLI

VibePro は対象リポジトリ内に `.vibepro/` 作業領域を作り、診断結果、証跡、ゲート状態、Brainbase 連携用の管理目録を管理する。

### 1. 初期化

```bash
npm install
node bin/vibepro.js init /path/to/repo
```

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
├── static-site-check-result.md
└── evidence.json
```

`evidence.json` が診断内容の機械可読な正本になる。Markdown は人間が確認するための投影として生成する。

静的サイト診断では、次の観点を `.vibepro/diagnostics/<run-id>/` 配下に記録する。

- ルート `index.html` の有無
- 秘密情報候補
- XSS につながり得る DOM 操作
- 外部リソース参照
- 静的配信対象外のファイル候補

秘密情報候補がある場合、`production-readiness` ゲートは `block` になる。高または中の確認事項がある場合は `needs_review` になる。

`vibepro-manifest.json` には最新の実行ID、ゲート状態、成果物パスを記録する。Brainbase はこの管理目録を読む。

### 4. Brainbase 取り込み状態の生成

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

`--story-id` は `import-state.json` の `stories[]` から対象Storyを選ぶ。未指定時は互換用の先頭 `story` を使う。

対象Story、NocoDB の `Horizon` / `View` / `Period` / `開始日` / `期限日` は `.vibepro/config.json` の `brainbase.stories[]` で管理する。複数Storyを設定でき、`import-state.json` には `stories[]` と互換用の先頭 `story` が出力される。

```json
{
  "brainbase": {
    "stories": [
      {
        "story_id": "story-vibepro-diagnosis-commercialization-roadmap",
        "title": "M1: VibePro 診断→商用化ロードマップ",
        "ssot": "NocoDB",
        "horizon": "month",
        "view": "dev",
        "period": "2026-04",
        "started_at": "2026-04-01",
        "due_at": "2026-04-30"
      }
    ]
  }
}
```

## 対象

- HTML/CSS/JS のみで構成された静的サイト
- サーバサイド・DB・ビルド不要の静的アセット配信

## 診断コマンドの使い方

### 1. 診断対象コードの配置

`target/` ディレクトリに診断対象の静的サイトを配置してください。

```bash
# 方法1: 既存プロジェクトをコピー
cp -r /path/to/your/site/* target/

# 方法2: git cloneで配置
git clone https://github.com/your/repo.git target/

# 方法3: シンボリックリンク（元のコードを直接参照）
ln -s /path/to/your/site target
```

### 2. 診断の実行

see [STATICSITE_FLOW.md](./STATICSITE_FLOW.md)
