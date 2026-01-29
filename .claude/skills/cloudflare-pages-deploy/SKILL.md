---
name: cloudflare-pages-deploy
description: Cloudflare Pagesへのデプロイ計画を作成する。target/内の静的サイト・JAMstackアプリを分析し、デプロイに必要な設定・手順・注意点をまとめた計画書をresults/deploy-plan.mdに出力する。VibePro診断（/diagnose）実行後に使用することを想定。診断結果がある場合はそれを参照して計画に反映する。
---

# Cloudflare Pages デプロイ計画

`target/` 内のコードを分析し、Cloudflare Pagesへのデプロイ計画を `results/deploy-plan.md` に出力する。

## 前提条件

- 診断結果（`results/summary.md`等）がある場合は参照する
- ない場合は独自にコードを分析する

## 実行手順

### Step 1: コード分析

`target/` ディレクトリを分析し以下を特定：

1. **フレームワーク検出**
   - React / Vue / Next.js / Nuxt / Astro / Svelte / 静的HTML等
   - package.json のdependencies確認

2. **ビルド設定確認**
   - ビルドコマンド（`npm run build` 等）
   - 出力ディレクトリ（`dist/`, `build/`, `out/`, `.next/` 等）
   - 環境変数の有無

3. **API/バックエンド確認**
   - Functionsが必要か（`/functions` または `_worker.js`）
   - 外部APIへの依存

### Step 2: 診断結果の参照（存在する場合）

`results/` 内の診断ファイルから以下を抽出：

- セキュリティ上の懸念（デプロイ前に修正すべき項目）
- 推奨規模（ライト/スタンダード/エンタープライズ）
- 重要なリスク項目

### Step 3: デプロイ計画の作成

`results/deploy-plan.md` に以下を出力：

```markdown
# Cloudflare Pages デプロイ計画

作成日時: YYYY-MM-DD HH:MM
対象: target/

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| フレームワーク | [検出されたフレームワーク] |
| ビルドコマンド | [npm run build 等] |
| 出力ディレクトリ | [dist 等] |
| Functions | [必要/不要] |

---

## デプロイ前チェックリスト

### 必須（デプロイ前に完了すること）

- [ ] [診断で検出されたCritical/High項目があれば記載]
- [ ] 環境変数の設定確認
- [ ] ビルドの成功確認（`npm run build`）
- [ ] .gitignore に node_modules, .env が含まれているか

### 推奨（デプロイ後でも可）

- [ ] [Medium項目があれば記載]

---

## Cloudflare Pages 設定

### 1. プロジェクト作成

**Wrangler CLI を使用する場合:**
```bash
npm install -g wrangler
wrangler login
wrangler pages project create [プロジェクト名]
```

**Dashboardを使用する場合:**
1. https://dash.cloudflare.com/ にアクセス
2. Workers & Pages > Create > Pages
3. Git連携 または Direct Upload を選択

### 2. ビルド設定

| 設定項目 | 値 |
|----------|-----|
| Build command | `[検出されたビルドコマンド]` |
| Build output directory | `[検出された出力ディレクトリ]` |
| Root directory | `/` |
| Node.js version | `[package.jsonから推定]` |

### 3. 環境変数

以下の環境変数を Cloudflare Pages の設定画面で登録：

| 変数名 | 説明 | Production | Preview |
|--------|------|------------|---------|
| [検出された変数] | [説明] | 要設定 | 要設定 |

**設定方法:**
1. Dashboard > Settings > Environment variables
2. または `wrangler pages secret put [変数名]`

### 4. Functions（必要な場合）

[Functionsが必要な場合の設定を記載]

---

## デプロイ手順

### 方法1: Git連携（推奨）

1. GitHubまたはGitLabにリポジトリをプッシュ
2. Cloudflare Dashboard で Git連携を設定
3. 自動デプロイが有効化される

### 方法2: Wrangler CLI

```bash
# ビルド
npm run build

# デプロイ（本番）
wrangler pages deploy [出力ディレクトリ] --project-name=[プロジェクト名]

# デプロイ（プレビュー）
wrangler pages deploy [出力ディレクトリ] --project-name=[プロジェクト名] --branch=preview
```

### 方法3: Direct Upload

1. `npm run build` でビルド
2. Dashboard > Upload assets から出力ディレクトリをアップロード

---

## カスタムドメイン設定（オプション）

1. Dashboard > Custom domains
2. ドメインを追加
3. DNSレコードを設定（Cloudflare DNS推奨）

```
タイプ: CNAME
名前: @ または www
ターゲット: [プロジェクト名].pages.dev
```

---

## 注意事項

[コード分析や診断結果から得られた注意点を記載]

- [フレームワーク固有の注意点]
- [環境変数に関する注意点]
- [セキュリティに関する注意点]

---

## 参考リンク

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Framework Guide](https://developers.cloudflare.com/pages/framework-guides/)
```

## 完了時の出力

```
デプロイ計画を作成しました。

生成されたファイル:
- results/deploy-plan.md

次のステップ:
1. デプロイ前チェックリストを確認
2. Cloudflare アカウントを準備
3. 計画に従ってデプロイを実行
```

## 参考: フレームワーク別設定

詳細は [references/api_reference.md](references/api_reference.md) を参照。
