---
name: static-site-check
description: 静的サイト（HTML/CSS/JSのみ）の公開前チェック。サーバサイド・DB・ビルド不要の静的アセット配信を対象とする。静的サイトの公開準備、セキュリティチェック、秘密情報混入確認、XSS対策確認時に使用。
---

# 静的サイト公開チェック

静的サイト（HTML/CSS/JSのみ）の公開前チェックを実行する。

## 対象範囲

- サーバサイドなし・DBなし・ビルドなし
- 配信物: `*.html` / `*.css` / `*.js` / 画像など静的ファイルのみ
- 秘密情報を一切含めない前提

## チェック手順

1. [references/checklist.md](references/checklist.md) を読み込む
2. 対象コードに対して各チェック項目を確認
3. 結果を報告（OK / NG / 要確認）

## 自動検出パターン

秘密情報検出（Grepで検索）:
```
# APIキー/トークンパターン
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)
sk-[a-zA-Z0-9]{20,}
[a-z0-9]{32,}

# 認証情報ファイル
\.env$|\.env\.|credentials|\.key$|\.pem$
```

XSS脆弱性パターン:
```
innerHTML\s*=
eval\s*\(
new\s+Function\s*\(
```

## 出力形式

チェック結果は以下の形式で報告:

```markdown
## 静的サイト公開チェック結果

### 前提確認
- [x] 静的ファイルのみ
- [x] index.html あり
- [ ] 秘密情報なし → NG: xxx.js に API キー検出

### セキュリティ
- [x] 認証情報ファイルなし
- [ ] XSS 脆弱性 → 要確認: innerHTML 使用箇所あり

### 総合判定
NG - 修正が必要
```
