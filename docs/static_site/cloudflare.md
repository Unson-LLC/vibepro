# Cloudflare Pages 固有の設定

## 2.1 セキュリティヘッダ（`_headers`）
- [ ] 静的アセットのルートに `_headers` ファイルを配置

例：
```
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
```
※ CSP は最初は入れなくてもよい（必要になったら追加）

## 2.2 リダイレクト（`_redirects`）
- [ ] `index.html` 直アクセスを `/` に統一（任意）

例：
```
/index.html  /  301
```

---

## 3. デプロイ前チェック

### 3.1 ディレクトリ構成
- [ ] `index.html` が公開ルートに存在する
- [ ] `_headers` / `_redirects` が同じディレクトリにある

### 3.2 プレビュー確認
- [ ] Pages の Preview URL で表示できる
- [ ] ブラウザ Console にエラーが出ていない
- [ ] 主要導線が一通り動く

---

## 4. HTTPS / ドメイン

### 4.1 pages.dev
- [ ] `*.pages.dev` ドメインで表示できる

### 4.2 カスタムドメイン（任意）
- [ ] Pages に Custom domain を設定
- [ ] DNS に CNAME を追加
- [ ] HTTPS でアクセスできることを確認

---

## 5. 公開後チェック（最低限）
- [ ] バージョン表記が画面内にある（例：v0.1.0）
- [ ] 問い合わせ先 / Issue 管理先が明記されている
- [ ] セキュリティヘッダが反映されている（`curl -I` 等で確認）

---

## 6. 静的サイト卒業サイン（要再設計）
- APIキーをブラウザに置かないと動かない
- ログインが必要
- 個人情報を収集・保存したい
- ユーザごとのデータをサーバで保持したい

---

## 推奨ファイル構成
```
/
  index.html
  app.js
  style.css
  _headers
  _redirects
  assets/
  README.md
  LICENSE
```
