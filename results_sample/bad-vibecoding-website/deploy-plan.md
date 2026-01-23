# Cloudflare Pages デプロイ計画

作成日時: 2026-01-22 11:00
対象: target/

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| フレームワーク | 静的 HTML/CSS/JS（ビルド不要） |
| ビルドコマンド | なし（静的ファイル直接配信） |
| 出力ディレクトリ | `/`（ルート） |
| Functions | 不要 |

---

## デプロイ前チェックリスト

### 必須（デプロイ前に完了すること）

> **警告: 現在の状態ではデプロイできません**
>
> 静的サイトチェックで Critical レベルの問題が検出されています。
> 以下の項目を修正してからデプロイしてください。

- [ ] **秘密情報の削除**（Critical）
  - [ ] `.env` ファイルを削除
  - [ ] `.env.local` ファイルを削除
  - [ ] `config.secret.js` ファイルを削除
  - [ ] `credentials.json` ファイルを削除
  - [ ] `script.js` からハードコードされた API キー・トークンを削除（6-9行目）
  - [ ] `script.js` からデバッグログを削除（12-13行目）

- [ ] **XSS 脆弱性の修正**（Critical）
  - [ ] `innerHTML` を `textContent` に変更、または DOMPurify でサニタイズ（script.js: 28, 35, 60行目）
  - [ ] `eval()` の使用を削除（script.js: 42行目）
  - [ ] `new Function()` の使用を削除（script.js: 48行目）
  - [ ] `document.write()` の使用を削除（script.js: 53行目）

- [ ] **危険な CDN の削除**（Critical）
  - [ ] `polyfill.io` スクリプトを削除（index.html: 10-11行目）
  - [ ] `rawgit.com` スクリプトを削除（index.html: 18行目）

- [ ] **配信不要ファイルの除外**
  - [ ] `.gitignore` に以下を追加: `node_modules/`, `.env*`, `*.secret.js`, `credentials.json`
  - [ ] または配信時にこれらのファイルを除外

- [ ] **ビルドの成功確認**（静的サイトのため不要）

### 推奨（デプロイ後でも可）

- [ ] 外部 CDN に SRI（Subresource Integrity）を追加
- [ ] iframe に `sandbox` 属性を追加
- [ ] Google Fonts をセルフホスティングに変更（プライバシー向上）

---

## Cloudflare Pages 設定

### 1. プロジェクト作成

**Wrangler CLI を使用する場合:**
```bash
npm install -g wrangler
wrangler login
wrangler pages project create vibecoding-site
```

**Dashboard を使用する場合:**
1. https://dash.cloudflare.com/ にアクセス
2. Workers & Pages > Create > Pages
3. Direct Upload を選択（ビルド不要のため）

### 2. ビルド設定

| 設定項目 | 値 |
|----------|-----|
| Build command | （空欄 - 静的ファイルのため不要） |
| Build output directory | `/` |
| Root directory | `/` |

### 3. 環境変数

静的サイトのため、環境変数は不要です。

> **重要**: 現在コード内にハードコードされている API キーは、
> バックエンドサーバーまたは Cloudflare Workers で管理する必要があります。
> フロントエンドの JavaScript に秘密情報を含めないでください。

### 4. Functions

不要（静的サイトのため）

---

## デプロイ手順

### 方法1: Direct Upload（推奨）

静的サイトのため、Direct Upload が最もシンプルです。

**配信対象ファイル（これらのみをアップロード）:**
- `index.html`
- `style.css`
- `script.js`（秘密情報・XSS 脆弱性を修正後）
- `docs/`（必要な場合）

**除外すべきファイル:**
- `.env`, `.env.local`
- `config.secret.js`, `credentials.json`
- `node_modules/`
- `package.json`, `pnpm-lock.yaml`
- `.git/`, `.wrangler/`, `.gitignore`

**手順:**
1. 上記の配信対象ファイルのみを含むフォルダを作成
2. Dashboard > Workers & Pages > Create > Pages > Upload assets
3. フォルダをドラッグ＆ドロップ

### 方法2: Wrangler CLI

```bash
# 配信対象ファイルのみを含むディレクトリを作成
mkdir -p deploy
cp index.html style.css script.js deploy/
cp -r docs deploy/ 2>/dev/null || true

# デプロイ（本番）
wrangler pages deploy deploy --project-name=vibecoding-site

# デプロイ（プレビュー）
wrangler pages deploy deploy --project-name=vibecoding-site --branch=preview
```

### 方法3: Git 連携

**注意**: Git 連携を使用する場合は、`.gitignore` で秘密情報ファイルを除外してください。

1. GitHub にリポジトリを作成
2. `.gitignore` に秘密情報ファイルを追加
3. Cloudflare Dashboard で Git 連携を設定
4. 自動デプロイが有効化される

---

## カスタムドメイン設定（オプション）

1. Dashboard > Custom domains
2. ドメインを追加
3. DNS レコードを設定（Cloudflare DNS 推奨）

```
タイプ: CNAME
名前: @ または www
ターゲット: vibecoding-site.pages.dev
```

---

## 注意事項

### セキュリティに関する重要事項

1. **秘密情報は絶対に配信しない**
   - API キー、トークン、パスワードはすべてバックエンドで管理
   - フロントエンドには公開可能な情報のみを含める

2. **polyfill.io は使用禁止**
   - 2024年に悪意ある第三者に売却され、マルウェア配信に使用された
   - 代替: cdnjs.cloudflare.com または自己ホスティング

3. **XSS 対策は必須**
   - ユーザー入力を `innerHTML` に直接挿入しない
   - `textContent` を使用するか、DOMPurify でサニタイズ

### Cloudflare Pages の制限

- 最大ファイルサイズ: 25 MB
- 最大ファイル数: 20,000
- 最大アップロードサイズ: 500 MB

---

## 参考リンク

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Deploy a static site](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
