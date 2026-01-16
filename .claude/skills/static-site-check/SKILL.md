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
3. **問題検出時**: 該当する対応方法ファイルを読み込んで対応策を提示
4. 結果を `results/static-site-check-result.md` に保存

## 対応方法リファレンス

問題検出時に参照するファイル:

| 検出内容 | 参照ファイル |
|----------|--------------|
| 静的ファイル以外 / index.html なし | [references/static-files.md](references/static-files.md) |
| 秘密情報（APIキー/認証情報） | [references/secret-leak.md](references/secret-leak.md) |
| XSS脆弱性（innerHTML/eval） | [references/xss.md](references/xss.md) |
| 外部CDN / サードパーティJS | [references/external-resources.md](references/external-resources.md) |

## 自動検出パターン

### 秘密情報検出（→ secret-leak.md）
```
# APIキー/トークンパターン
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)
sk-[a-zA-Z0-9]{20,}
[a-z0-9]{32,}

# 認証情報ファイル
\.env$|\.env\.|credentials|\.key$|\.pem$
```

### XSS脆弱性パターン（→ xss.md）
```
innerHTML\s*=
eval\s*\(
new\s+Function\s*\(
document\.write\s*\(
```

### 外部リソースパターン（→ external-resources.md）
```html
<script src="https?://
<link .* href="https?://
<iframe src="https?://
```

## 条件付き参照ロジック

チェック実行時、以下の条件で対応方法を読み込む:

1. **静的ファイル構成に問題あり** → `references/static-files.md` を読み込み、対応策を提示
2. **秘密情報パターンにマッチ** → `references/secret-leak.md` を読み込み、対応策を提示
3. **XSSパターンにマッチ** → `references/xss.md` を読み込み、対応策を提示
4. **外部リソースを検出** → `references/external-resources.md` を読み込み、対応策を提示

## 出力形式

チェック結果を `results/static-site-check-result.md` に以下の形式で保存:

```markdown
# 静的サイト公開チェック結果

診断日時: YYYY-MM-DD HH:MM
対象: [対象ディレクトリパス]

---

## 前提確認
- [x] 静的ファイルのみ
- [x] index.html あり
- [ ] 秘密情報なし → NG: xxx.js に API キー検出

## セキュリティ
- [x] 認証情報ファイルなし
- [ ] XSS 脆弱性 → 要確認: innerHTML 使用箇所あり

## 検出された問題と対応方法

### 1. 秘密情報混入
- **検出箇所**: xxx.js:15
- **対応方法**: [secret-leak.md より]
  - 該当コードを削除
  - バックエンドAPI経由でアクセスする設計に変更

### 2. XSS脆弱性
- **検出箇所**: main.js:42
- **対応方法**: [xss.md より]
  - innerHTML を textContent に変更

## 総合判定

**NG** - 修正が必要
```

## 完了時の出力

チェック完了後、以下のメッセージを表示:

```
チェックが完了しました。結果: results/static-site-check-result.md
```
