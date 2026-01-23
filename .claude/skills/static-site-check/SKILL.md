---
name: static-site-check
description: 静的サイト（HTML/CSS/JSのみ）の公開前チェック。サーバサイド・DB・ビルド不要の静的アセット配信を対象とする。静的サイトの公開準備、セキュリティチェック、秘密情報混入確認、XSS対策確認時に使用。
---

# 静的サイト公開チェック

静的サイト（HTML/CSS/JSのみ）の公開前チェックを実行し、結果を報告する。
**チェックのみ行い、コードの修正は行わない。**

## 対象範囲

- サーバサイドなし・DBなし・ビルドなし
- 配信物: `*.html` / `*.css` / `*.js` / 画像など静的ファイルのみ
- 秘密情報を一切含めない前提

## チェック手順

1. [references/checklist.md](references/checklist.md) を読み込む
2. 対象コードに対して各チェック項目を確認
3. **問題検出時**: 該当するリファレンスを参照して報告内容を決定
4. 結果を `results/static-site-check-result.md` に保存

## リファレンス

問題検出時に参照するファイル（報告形式の参考用）:

| 検出内容 | 参照ファイル |
|----------|--------------|
| 静的ファイル以外 / index.html なし | [references/static-files.md](references/static-files.md) |
| 秘密情報（APIキー/認証情報） | [references/secret-leak.md](references/secret-leak.md) |
| XSS脆弱性（innerHTML/eval） | [references/xss.md](references/xss.md) |
| 外部CDN / サードパーティJS | [references/external-resources.md](references/external-resources.md) |
| package.json / npm脆弱性 | [references/npm-vulnerabilities.md](references/npm-vulnerabilities.md) |

## 自動検出パターン

### 秘密情報検出
```
# APIキー/トークンパターン
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)
sk-[a-zA-Z0-9]{20,}
[a-z0-9]{32,}

# 認証情報ファイル
\.env$|\.env\.|credentials|\.key$|\.pem$
```

### XSS脆弱性パターン
```
innerHTML\s*=
eval\s*\(
new\s+Function\s*\(
document\.write\s*\(
```

### 外部リソースパターン
```html
<script src="https?://
<link .* href="https?://
<iframe src="https?://
```

### npm パッケージ脆弱性
```
# ファイル存在チェック
package.json
package-lock.json
node_modules/
```

**検出時のアクション**:
1. `package.json` が存在する場合、`npm audit --json` を実行
2. high / critical の脆弱性があれば問題として報告

## 条件付き参照ロジック

チェック実行時、以下の条件でリファレンスを参照して報告形式を決定:

1. **静的ファイル構成に問題あり** → `references/static-files.md` の形式で報告
2. **秘密情報パターンにマッチ** → `references/secret-leak.md` の形式で報告
3. **XSSパターンにマッチ** → `references/xss.md` の形式で報告
4. **外部リソースを検出** → `references/external-resources.md` の形式で報告
5. **package.json が存在 & npm audit で脆弱性検出** → `references/npm-vulnerabilities.md` の形式で報告

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

## npm パッケージ（package.json がある場合）
- [ ] npm audit → 2件の脆弱性検出（high: 1, critical: 1）
- [x] 未使用パッケージなし

## 検出された問題

### 1. 秘密情報混入
| ファイル | 行 | 検出内容 | 種類（推定） |
|----------|-----|----------|--------------|
| api.js | 15 | sk-xxxx... | OpenAI API Key |

### 2. XSS脆弱性
| ファイル | 行 | 値の出所 | サニタイズ |
|----------|-----|----------|------------|
| app.js | 42 | URLパラメータ | なし |

### 3. 外部リソース
| リソース | ドメイン | SRI |
|----------|----------|-----|
| jQuery 3.6.0 | cdn.jsdelivr.net | なし |

## 総合判定

**NG** - 問題が検出されました
```

## 完了時の出力

チェック完了後、以下のメッセージを表示:

```
チェックが完了しました。結果: results/static-site-check-result.md
```
