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
└── evidence.json
```

`vibepro-manifest.json` には最新の実行ID、ゲート状態、成果物パスを記録する。Brainbase はこの管理目録を読む。

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
