# 静的サイト公開チェック結果

診断日時: 2026-01-22 11:00
対象: target/

---

## 前提確認
- [x] 静的ファイルのみ（.html / .css / .js / 画像）
- [x] index.html あり
- [ ] 秘密情報なし → **NG: 複数ファイルに秘密情報を検出**

## セキュリティ
- [ ] 認証情報ファイルなし → **NG: .env, .env.local, credentials.json, config.secret.js を検出**
- [ ] XSS 脆弱性 → **NG: innerHTML, eval, new Function, document.write 使用箇所あり**

## 外部リソース
- [ ] 危険なCDN → **NG: polyfill.io（マルウェア配信歴あり）を検出**
- [ ] 外部リソースSRI → **NG: SRI なしの外部リソースあり**

## npm パッケージ（package.json あり）
- [x] npm audit → 脆弱性なし（pnpm audit 実行）
- [ ] 配信不要ファイル → **NG: package.json, node_modules/ が配信物に含まれる**

---

## 検出された問題

### 1. 秘密情報混入（Critical）

#### 認証情報ファイル（4件）

| ファイル | 種類 |
|----------|------|
| `.env` | 環境変数ファイル（複数の API キー・DB 認証情報） |
| `.env.local` | 環境変数ファイル（ローカル秘密情報） |
| `config.secret.js` | 設定ファイル（API キー・DB 認証情報） |
| `credentials.json` | GCP サービスアカウント秘密鍵 |

#### コード内 API キー（4件）

| ファイル | 行 | 検出内容 | 種類（推定） |
|----------|-----|----------|--------------|
| script.js | 6 | `sk-proj-abc123...` | OpenAI API Key |
| script.js | 7 | `AIzaSyC1a2b3...` | Google API Key |
| script.js | 8 | `ghp_1234567890...` | GitHub Personal Access Token |
| script.js | 9 | `hooks.slack.com/services/...` | Slack Webhook URL |

#### デバッグログでの秘密情報出力（2件）

| ファイル | 行 | 内容 |
|----------|-----|------|
| script.js | 12 | `console.log("API Key initialized:", OPENAI_API_KEY)` |
| script.js | 13 | `console.log("Auth token:", access_token)` |

#### .env ファイル内の秘密情報

| 項目 | 種類 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API Key |
| `GOOGLE_API_KEY` | Google API Key |
| `DATABASE_URL` | PostgreSQL 接続文字列（パスワード含む） |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS 認証情報 |
| `STRIPE_SECRET_KEY` | Stripe 本番用シークレットキー |
| `GITHUB_TOKEN` | GitHub トークン |
| `SLACK_WEBHOOK_URL` | Slack Webhook URL |
| `JWT_SECRET` | JWT 署名用シークレット |

---

### 2. XSS 脆弱性（Critical）

#### innerHTML（4件）

| ファイル | 行 | 値の出所 | サニタイズ |
|----------|-----|----------|------------|
| script.js | 28 | URLパラメータ (`name`) | なし |
| script.js | 35 | URLパラメータ (`message`) | なし |
| script.js | 60 | `location.hash` | なし |

#### eval()（1件）

| ファイル | 行 | 内容 |
|----------|-----|------|
| script.js | 42 | `eval(code)` - ユーザー入力を直接実行 |

#### new Function()（1件）

| ファイル | 行 | 内容 |
|----------|-----|------|
| script.js | 48 | `new Function('x', 'y', body)` - 動的関数生成 |

#### document.write()（1件）

| ファイル | 行 | 内容 |
|----------|-----|------|
| script.js | 53 | `document.write('<script src="' + url + '">...')` - 外部スクリプト動的読み込み |

---

### 3. 外部リソース（High）

#### 危険なサービス（警告）

> **警告: 危険なサービスを検出**
>
> `polyfill.io` からのスクリプト読み込みを検出しました。
> このサービスは2024年に悪意ある第三者に売却され、マルウェア配信に使用された実績があります。
> **即時削除** を強く推奨します。

| ファイル | 行 | URL |
|----------|-----|-----|
| index.html | 10 | `https://polyfill.io/v3/polyfill.min.js` |
| index.html | 11 | `https://cdn.polyfill.io/v2/polyfill.min.js` |

#### 廃止されたサービス（警告）

| ファイル | 行 | URL | 理由 |
|----------|-----|-----|------|
| index.html | 18 | `https://rawgit.com/user/repo/master/script.js` | 2019年にサービス終了 |

#### 外部 CDN（SRI なし）

| リソース | ドメイン | SRI |
|----------|----------|-----|
| jQuery 3.6.0 | cdn.jsdelivr.net | なし |
| Bootstrap 5.0 CSS | cdn.jsdelivr.net | なし |
| Google Fonts | fonts.googleapis.com | - |

#### サードパーティスクリプト

| サービス | ドメイン | 読み込み |
|----------|----------|----------|
| Google Tag Manager | googletagmanager.com | async |

#### iframe（sandbox なし）

| コンテンツ | ドメイン | sandbox |
|------------|----------|---------|
| YouTube 動画 | youtube.com | なし |
| Vimeo 動画 | vimeo.com | なし |
| Google Maps | google.com/maps | なし |

---

### 4. 配信すべきでないファイル（Medium）

| ファイル | 種類 |
|----------|------|
| `node_modules/` | 開発用ディレクトリ |
| `package.json` | 設定ファイル |
| `pnpm-lock.yaml` | ロックファイル |
| `.env` | 環境変数ファイル |
| `.env.local` | 環境変数ファイル |
| `config.secret.js` | 秘密設定ファイル |
| `credentials.json` | 認証情報ファイル |
| `.git/` | Git リポジトリ |
| `.wrangler/` | Wrangler 設定 |
| `.gitignore` | Git 設定 |

---

## 検出結果サマリー

| カテゴリ | 件数 | 深刻度 |
|----------|------|--------|
| 秘密情報混入 | 10件 | Critical |
| XSS 脆弱性 | 7件 | Critical |
| 危険な外部サービス | 3件 | Critical |
| 外部リソース（SRI なし） | 3件 | Medium |
| 配信不要ファイル | 10件 | Medium |

---

## 総合判定

**NG（商用化不可）** - 複数の Critical レベルの問題が検出されました

### 即時対応が必要な項目

1. **秘密情報の削除** - API キー、認証情報が公開されると不正利用・課金被害のリスク
2. **XSS 脆弱性の修正** - 悪意あるスクリプト実行によるセッションハイジャック、フィッシングのリスク
3. **危険な CDN の削除** - polyfill.io はマルウェア配信歴があり即時削除が必要
