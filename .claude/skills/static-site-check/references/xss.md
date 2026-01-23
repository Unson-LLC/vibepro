# XSS（クロスサイトスクリプティング）チェック

ユーザ入力やURLパラメータを通じた悪意あるスクリプト実行の可能性を検出・報告する。

## 検出パターン

```
innerHTML\s*=
eval\s*\(
new\s+Function\s*\(
document\.write\s*\(
```

## リスク

- 悪意あるスクリプトの実行
- セッションハイジャック（Cookie窃取）
- フィッシング（偽コンテンツ表示）
- マルウェア配布

## チェック項目

### 1. innerHTML の使用

検出対象:
- `element.innerHTML = ...`
- `element.outerHTML = ...`
- `insertAdjacentHTML()`

除外条件（以下の場合は安全とみなし報告不要）:
- 固定のリテラル文字列のみを代入している場合（例: `el.innerHTML = '<div class="empty"></div>'`）
- テンプレートリテラルで変数を含まない場合
- DOMPurify等のサニタイズライブラリを通した値を代入している場合
- textContentやinnerTextで代替可能な単純テキストの場合

報告対象:
- ユーザ入力やURLパラメータを含む値を代入している場合
- 外部APIから取得したデータを代入している場合
- サニタイズ処理なしで変数を含むテンプレートリテラルを代入している場合

報告内容:
- 検出箇所（ファイル名:行番号）
- 代入される値の出所（ユーザ入力/URLパラメータ/外部API）
- サニタイズ処理の有無

### 2. eval() の使用

検出対象:
- `eval(...)`
- `setTimeout(string, ...)`
- `setInterval(string, ...)`

報告内容:
- 検出箇所（ファイル名:行番号）
- 実行される文字列の出所

### 3. new Function() の使用

検出対象:
- `new Function(...)`

報告内容:
- 検出箇所（ファイル名:行番号）
- 関数本体の出所

### 4. document.write の使用

検出対象:
- `document.write(...)`
- `document.writeln(...)`

報告内容:
- 検出箇所（ファイル名:行番号）
- 書き込まれる内容の出所

### 5. URLパラメータの直接使用

検出対象:
- `location.search` の値を DOM に挿入
- `location.hash` の値を DOM に挿入
- `URLSearchParams` で取得した値を innerHTML に挿入

報告内容:
- 検出箇所（ファイル名:行番号）
- パラメータ名
- 挿入方法（innerHTML/textContent）

## チェック結果の記載例

```markdown
## XSS脆弱性

### 検出結果
- innerHTML: 2件
- eval(): 0件
- new Function(): 0件
- document.write: 1件
- URLパラメータ直接使用: 1件

### innerHTML

| ファイル | 行 | 値の出所 | サニタイズ |
|----------|-----|----------|------------|
| app.js | 42 | URLパラメータ | なし |
| render.js | 15 | 固定値 | - |

### document.write

| ファイル | 行 | 内容の出所 |
|----------|-----|------------|
| legacy.js | 8 | 外部スクリプト読み込み |

### URLパラメータ直接使用

| ファイル | 行 | パラメータ | 挿入方法 |
|----------|-----|------------|----------|
| app.js | 42 | name | innerHTML |
```
