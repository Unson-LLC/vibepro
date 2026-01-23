# 静的サイト診断サマリー

| 項目 | 内容 |
|------|------|
| 診断日時 | 2026-01-22 11:00 |
| 対象 | target/ |
| 診断バージョン | 1.0 |

---

## 総合評価

### 商用化不可

複数の Critical レベルのセキュリティリスクが検出されました。API キー・認証情報の公開、XSS 脆弱性、マルウェア配信歴のある CDN 使用など、即時対応が必要な問題があります。

---

## リスクサマリー

| 深刻度 | 件数 | 対応要否 |
|--------|------|----------|
| Critical | 4件 | 即時対応必須 |
| High | 2件 | 商用化前必須 |
| Medium | 2件 | 推奨 |
| Low | 1件 | 任意 |
| **合計** | **9件** | |

---

## 診断結果概要

### 1. セキュリティチェック

| 項目 | 結果 | 詳細 |
|------|------|------|
| 秘密情報混入 | ✕ | APIキー、認証情報が複数箇所で検出 |
| XSS脆弱性 | ✕ | innerHTML、eval、new Function、document.write 使用 |
| npm脆弱性 | ○ | pnpm audit で脆弱性なし |
| 外部依存 | ✕ | polyfill.io（危険）、rawgit.com（廃止）使用 |

### 2. 構成チェック

| 項目 | 結果 | 詳細 |
|------|------|------|
| index.html | ○ | ルートに存在 |
| 静的ファイルのみ | ○ | HTML/CSS/JS/画像のみ |
| 配信不要ファイル除外 | ✕ | .env、node_modules、credentials.json 等が含まれる |

### 3. デプロイ準備

| 項目 | 内容 |
|------|------|
| フレームワーク | 静的HTML/CSS/JS（ビルド不要） |
| ビルド要否 | 不要 |
| 推奨デプロイ方法 | Cloudflare Pages Direct Upload |

---

## 検出された主な問題

### 優先度: 最高（Critical）

1. **APIキー・認証情報の公開** - OpenAI、Google、GitHub、Slack のキーがJSファイルにハードコード
2. **認証情報ファイルの公開** - .env、credentials.json 等が配信対象に含まれる
3. **XSS脆弱性** - URLパラメータがサニタイズなしでinnerHTMLに挿入される
4. **危険なCDN使用** - polyfill.io（マルウェア配信歴あり）からスクリプト読み込み

### 優先度: 高（High）

1. **デバッグログでの機密情報出力** - console.log でAPIキーを出力
2. **廃止サービスへの依存** - rawgit.com（2019年終了）からスクリプト読み込み

### 優先度: 中（Medium）

1. **外部リソースSRIなし** - jQuery、Bootstrap のCDNにSRIハッシュなし
2. **iframe sandboxなし** - YouTube、Vimeo、Google Maps の埋め込みにsandbox属性なし

---

## 見積もり概要

| 項目 | 内容 |
|------|------|
| 判定規模 | スタンダード |
| 診断費用（実施済み） | ¥500,000 |
| 商用化費用 | ¥2,000,000 |
| 運用保守（月額） | ¥400,000 |
| **初期費用合計** | **¥2,500,000** |

---

## 推奨アクション

### 商用化前（必須）

- [ ] `.env`、`.env.local`、`config.secret.js`、`credentials.json` を削除
- [ ] `script.js` からハードコードされたAPIキー・トークンを削除（6-9行目）
- [ ] `script.js` からデバッグログを削除（12-13行目）
- [ ] `innerHTML` を `textContent` に変更、または DOMPurify でサニタイズ
- [ ] `eval()`、`new Function()`、`document.write()` の使用を削除
- [ ] `polyfill.io` スクリプトを削除（index.html: 10-11行目）
- [ ] `rawgit.com` スクリプトを削除（index.html: 18行目）
- [ ] 漏洩した可能性のあるAPIキーをすべて無効化・再発行

### 商用化後（推奨）

- [ ] 外部CDNにSRI（Subresource Integrity）を追加
- [ ] iframeにsandbox属性を追加
- [ ] Google Fontsをセルフホスティングに変更

---

## 生成されたファイル

| ファイル | 内容 | 用途 |
|----------|------|------|
| [static-site-check-result.md](static-site-check-result.md) | セキュリティ・構成チェック | 技術者向け |
| [deploy-plan.md](deploy-plan.md) | デプロイ手順 | 技術者向け |
| [risk-register.md](risk-register.md) | リスク台帳 | お客様提出用 |
| [estimate.md](estimate.md) | 見積書 | お客様提出用 |

---

## 次のステップ

1. **見積書を確認** - `estimate.md` で費用・スケジュールを確認
2. **リスク台帳を確認** - `risk-register.md` で検出されたリスクと対応方法を確認
3. **問題を修正** - 優先度に従って Critical → High → Medium の順に対応
4. **デプロイを実行** - `deploy-plan.md` の手順に従ってデプロイ

---

*本診断は VibePro 診断チームによって実施されました*
