# Cloudflare Pages デプロイ計画

作成日時: 2026-01-23 10:30
対象: target/

---

## プロジェクト概要

| 項目 | 内容 |
|------|------|
| フレームワーク | 静的HTML（Vanilla HTML/CSS/JS） |
| ビルドコマンド | 不要（ビルドなし） |
| 出力ディレクトリ | `/`（ルート直下） |
| Functions | 不要 |

---

## デプロイ前チェックリスト

### 必須（デプロイ前に完了すること）

- [x] セキュリティチェック完了（問題なし）
- [ ] プレースホルダー画像を本番用に置き換え（placehold.jp → 自前画像）
- [ ] ダミーURLを本番用に更新
  - forms.gle/dummy → 実際のGoogle FormのURL
  - github.com/dummy → 実際のGitHubプロフィール
  - x.com/dummy → 実際のXアカウント
  - linkedin.com/in/dummy → 実際のLinkedInプロフィール
  - dummy@example.com → 実際のメールアドレス
- [ ] node_modules をデプロイ対象から除外

### 推奨（デプロイ後でも可）

- [ ] OGP（Open Graph Protocol）タグの追加
- [ ] ファビコンの設定
- [ ] Google Analyticsの設定（必要な場合）

---

## Cloudflare Pages 設定

### 1. プロジェクト作成

**Wrangler CLI を使用する場合:**
```bash
npm install -g wrangler
wrangler login
wrangler pages project create vibecoding-site
```

**Dashboardを使用する場合:**
1. https://dash.cloudflare.com/ にアクセス
2. Workers & Pages > Create > Pages
3. Git連携 または Direct Upload を選択

### 2. ビルド設定

| 設定項目 | 値 |
|----------|-----|
| Build command | （空欄 - ビルド不要） |
| Build output directory | `/` |
| Root directory | `/` |
| Node.js version | 不要 |

### 3. 環境変数

本プロジェクトでは環境変数は不要です。

### 4. 除外ファイル設定

デプロイ時に以下を除外してください：

- `node_modules/`
- `.git/`
- `pnpm-lock.yaml`
- `package.json`（本番環境では不要）

---

## デプロイ手順

### 方法1: Git連携（推奨）

1. GitHubまたはGitLabにリポジトリをプッシュ
2. Cloudflare Dashboard で Git連携を設定
3. 以下のファイルを `.gitignore` に追加（既に設定済み）
   ```
   node_modules/
   .env
   ```
4. 自動デプロイが有効化される

### 方法2: Wrangler CLI（Direct Upload）

```bash
# target ディレクトリに移動
cd target

# 不要ファイルを除外してデプロイ
wrangler pages deploy . --project-name=vibecoding-site \
  --exclude node_modules \
  --exclude .git \
  --exclude pnpm-lock.yaml \
  --exclude package.json
```

### 方法3: Direct Upload（Dashboard）

1. `target/` 内の以下のファイルのみをアップロード
   - `index.html`
   - `style.css`
   - `script.js`
   - `docs/`（必要な場合）
2. Dashboard > Upload assets からアップロード

---

## カスタムドメイン設定（オプション）

1. Dashboard > Custom domains
2. ドメインを追加
3. DNSレコードを設定（Cloudflare DNS推奨）

```
タイプ: CNAME
名前: @ または www
ターゲット: vibecoding-site.pages.dev
```

---

## 注意事項

### 静的サイト固有の注意点

1. **キャッシュ設定**: Cloudflare Pagesは自動的にCDNキャッシュを設定します。CSS/JSを更新する場合は、ファイル名にバージョン番号を付与するか、キャッシュをパージしてください。

2. **HTTPSリダイレクト**: Cloudflare Pagesは自動的にHTTPSを強制します。追加設定は不要です。

3. **レスポンシブ対応**: 本サイトは既にレスポンシブ対応済みです。モバイル表示も問題ありません。

### 本番公開前の最終確認

1. ダミーURL・メールアドレスが本番用に更新されているか
2. プレースホルダー画像が本番用に置き換えられているか
3. Google Form が正しく動作するか

---

## 参考リンク

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Direct Upload Guide](https://developers.cloudflare.com/pages/get-started/direct-upload/)
- [Wrangler CLI Reference](https://developers.cloudflare.com/workers/wrangler/)

---

*作成: VibePro診断チーム*
