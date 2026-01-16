# 静的サイト公開チェックリスト（HTML / CSS / JSのみ）

対象：サーバサイドなし・DBなし・ビルドなし（静的アセットをそのまま配信）
前提：秘密情報（APIキー/トークン等）を一切含めない

---

## 0. 最初に確認（この枠に収まっているか）

→ 対応方法: [static-files.md](static-files.md)

- [ ] 配信物は `*.html` / `*.css` / `*.js` / 画像など静的ファイルのみ
- [ ] 配信物に `index.html` を含む
- [ ] 秘密情報（APIキー/トークン/パスワード/Webhook URLなど）が **一切ない**
- [ ] ユーザデータをサーバに保存しない（必要なら localStorage / IndexedDB）

---

## 1. 公開前セキュリティ（静的でも必須）

### 1.1 秘密情報混入ゼロ（最重要）

→ 対応方法: [secret-leak.md](secret-leak.md)

- [ ] `.env` / `*.key` / 認証情報ファイルがリポジトリに無い
- [ ] JS / HTML にキーっぽい文字列が無い
- [ ] デバッグ用ログに機密情報を出していない

### 1.2 XSS（HTML注入）対策

→ 対応方法: [xss.md](xss.md)

- [ ] ユーザ入力やURLパラメータを `innerHTML` に直接入れていない（原則 `textContent`）
- [ ] `eval()` / `new Function()` を使っていない

### 1.3 外部リソース最小化

→ 対応方法: [external-resources.md](external-resources.md)

- [ ] 外部CDN / サードパーティJSの利用を最小限にしている
- [ ] iframe 等の埋め込みは信頼できるもののみ

### 1.4 npm パッケージ脆弱性（package.json がある場合）

→ 対応方法: [npm-vulnerabilities.md](npm-vulnerabilities.md)

- [ ] `npm audit` で高・重大な脆弱性がない
- [ ] 未使用パッケージを削除済み
- [ ] 配信物に `package.json` / `node_modules` を含めない
