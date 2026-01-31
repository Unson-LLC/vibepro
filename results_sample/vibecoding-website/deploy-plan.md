# Cloudflare Pages デプロイ計画

作成日時: 2026-01-27 09:40
対象: target/

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| フレームワーク | 静的HTML/CSS/JS（フレームワークなし） |
| ビルドコマンド | 不要（静的ファイルをそのまま配信） |
| 出力ディレクトリ | `/`（ルート） |
| Functions | 不要 |

---

## デプロイ前チェックリスト

### 必須（デプロイ前に完了すること）

- [ ] ダミーURLを実際のURLに更新
  - `https://forms.gle/dummy` → 実際のGoogle Forms URL
  - `mailto:dummy@example.com` → 実際のメールアドレス
  - GitHub / X / LinkedInのダミーリンク → 実際のプロフィールURL
- [ ] プレースホルダー画像を実画像に差し替え
  - `https://placehold.jp/150x150.png` → 実際のプロフィール画像
- [ ] 配信不要ファイルの除外確認

### 推奨（デプロイ後でも可）

- [ ] OGP画像の設定
- [ ] ファビコンの追加
- [ ] Google Analyticsの設定（必要な場合）

---

## 配信対象ファイル

本プロジェクトは静的サイトのため、以下のファイルのみをデプロイします。

| ファイル | 配信対象 | 備考 |
|----------|---------|------|
| `index.html` | YES | メインページ |
| `style.css` | YES | スタイルシート |
| `script.js` | YES | JavaScript |
| `docs/` | 任意 | ドキュメント（公開する場合） |
| `node_modules/` | NO | 除外必須 |
| `package.json` | NO | 除外 |
| `pnpm-lock.yaml` | NO | 除外 |
| `.git/` | NO | 除外 |
| `.gitignore` | NO | 除外 |
| `README.md` | NO | 除外（公開不要） |

---

## Cloudflare Pages 設定

### 1. プロジェクト作成

**方法A: Wrangler CLI を使用する場合:**
```bash
# Wranglerのインストール
npm install -g wrangler

# ログイン
wrangler login

# プロジェクト作成
wrangler pages project create vibecoding-site
```

**方法B: Dashboardを使用する場合:**
1. https://dash.cloudflare.com/ にアクセス
2. Workers & Pages > Create > Pages
3. 「Direct Upload」を選択（Git連携なしの場合）

### 2. ビルド設定

本プロジェクトはビルド不要の静的サイトです。

| 設定項目 | 値 |
|----------|-----|
| Build command | _(空欄のまま)_ |
| Build output directory | `/` |
| Root directory | `/` |

**重要**: ビルドコマンドは設定不要です。静的ファイルをそのままアップロードします。

### 3. 環境変数

本プロジェクトでは環境変数は不要です。

| 変数名 | 説明 | 必要性 |
|--------|------|--------|
| - | - | 不要 |

---

## デプロイ手順

### 方法1: Direct Upload（推奨 - シンプルな静的サイト向け）

1. **配信用ディレクトリの作成**

```bash
# 配信用ディレクトリを作成
mkdir -p deploy

# 必要なファイルのみコピー
cp target/index.html deploy/
cp target/style.css deploy/
cp target/script.js deploy/
```

2. **Wrangler CLI でデプロイ**

```bash
# 本番デプロイ
wrangler pages deploy deploy --project-name=vibecoding-site
```

3. **またはDashboardからアップロード**
   - Dashboard > Pages > プロジェクト選択 > Upload assets
   - `deploy/` ディレクトリ内のファイルをアップロード

### 方法2: Git連携（継続的な更新がある場合）

1. **GitHubリポジトリを準備**

```bash
# 配信用ブランチを作成（不要ファイルを除外）
git checkout -b production
rm -rf node_modules package.json pnpm-lock.yaml
git add .
git commit -m "Production files only"
git push origin production
```

2. **Cloudflare PagesでGit連携を設定**
   - Dashboard > Workers & Pages > Create > Pages
   - 「Connect to Git」を選択
   - GitHubリポジトリを選択
   - Production branch: `production`
   - Build settings: 空欄（ビルド不要）

---

## カスタムドメイン設定（オプション）

### Cloudflare DNSを使用する場合（推奨）

1. Dashboard > Pages > プロジェクト選択 > Custom domains
2. 「Set up a custom domain」をクリック
3. ドメイン名を入力（例: `example.com`）
4. 自動的にDNSレコードが設定される

### 外部DNSを使用する場合

以下のCNAMEレコードを設定:

```
タイプ: CNAME
名前: @ または www
ターゲット: vibecoding-site.pages.dev
プロキシ: オン（Cloudflare経由）
```

---

## 注意事項

### 静的サイト固有の注意点

1. **画像の最適化**: 本番公開前にプレースホルダー画像を実画像に差し替えてください
2. **リンクの確認**: 全てのダミーURL（forms.gle, SNSリンク等）を実際のURLに更新してください
3. **メールアドレス**: `dummy@example.com` を実際の連絡先に更新してください

### セキュリティに関する注意点

1. **秘密情報**: 本プロジェクトには秘密情報は含まれていません（診断済み）
2. **外部リソース**: placehold.jp のプレースホルダー画像は本番では使用しないでください
3. **XSS対策**: 問題なし（innerHTML等の使用なし）

### デプロイ後の確認事項

- [ ] すべてのページが正しく表示されるか
- [ ] モバイル表示が正常か
- [ ] スムーススクロールが動作するか
- [ ] 外部リンク（SNS、フォーム）が正しく機能するか
- [ ] HTTPSでアクセスできるか

---

## コスト見込み

Cloudflare Pages の無料プランで十分対応可能です。

| 項目 | 無料枠 | 本プロジェクト |
|------|--------|---------------|
| ビルド | 500回/月 | ビルド不要 |
| リクエスト | 無制限 | 対応可 |
| 帯域幅 | 無制限 | 対応可 |
| カスタムドメイン | 対応 | 対応可 |
| SSL | 自動 | 対応可 |

---

## 参考リンク

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Custom Domains](https://developers.cloudflare.com/pages/platform/custom-domains/)

---

*VibePro Cloudflare Pages デプロイ計画 (cloudflare-pages-deploy)*
