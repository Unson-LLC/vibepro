# XSS（クロスサイトスクリプティング）対策

ユーザ入力やURLパラメータを通じた悪意あるスクリプト実行を防ぐための対応方法。

## 検出パターン

```
innerHTML\s*=
eval\s*\(
new\s+Function\s*\(
document\.write\s*\(
```

## 対応方法

### 1. innerHTML の使用が検出された場合

**問題**: `innerHTML` でユーザ入力やURLパラメータを直接挿入している

**対応**:

```javascript
// NG - XSS脆弱性あり
element.innerHTML = userInput;

// OK - textContent を使用
element.textContent = userInput;

// OK - DOMを構築して追加
const text = document.createTextNode(userInput);
element.appendChild(text);
```

**innerHTML が必要な場合**:
- サニタイズライブラリ（DOMPurify）を使用

```javascript
// DOMPurify でサニタイズ
element.innerHTML = DOMPurify.sanitize(userInput);
```

### 2. eval() の使用が検出された場合

**問題**: `eval()` で動的コード実行している

**対応**:
1. `eval()` を削除し、別の方法で実装
2. JSONパースなら `JSON.parse()` を使用

```javascript
// NG
const data = eval('(' + jsonString + ')');

// OK
const data = JSON.parse(jsonString);
```

### 3. new Function() の使用が検出された場合

**問題**: `new Function()` で動的に関数を生成している

**対応**:
1. 静的な関数定義に置き換え
2. テンプレートリテラルや条件分岐で代替

```javascript
// NG
const fn = new Function('a', 'b', 'return a + b');

// OK
const fn = (a, b) => a + b;
```

### 4. URLパラメータの直接使用が検出された場合

**問題**: `location.search` や `location.hash` をそのまま表示している

**対応**:

```javascript
// NG
const params = new URLSearchParams(location.search);
document.getElementById('name').innerHTML = params.get('name');

// OK
const params = new URLSearchParams(location.search);
document.getElementById('name').textContent = params.get('name');
```

## 予防策

- ユーザ入力は常に `textContent` で表示
- 動的HTML生成が必要な場合は DOMPurify を導入
- Content Security Policy (CSP) ヘッダを設定（ホスティング側）
