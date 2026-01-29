  # XSS（クロスサイトスクリプティング）チェック

React / Next.js アプリケーションにおける XSS 脆弱性を検出・報告する。

## 深刻度: High

## 出力先: `results/nextjs-check-xss.md`

XSS 脆弱性は、セッションハイジャック、フィッシング、マルウェア配布につながる。

## 検出パターン

```
# dangerouslySetInnerHTML
dangerouslySetInnerHTML\s*=

# 危険な JavaScript 関数
eval\s*\(
new\s+Function\s*\(
setTimeout\s*\(\s*['"`]
setInterval\s*\(\s*['"`]

# document操作
document\.write\s*\(
\.innerHTML\s*=
\.outerHTML\s*=
insertAdjacentHTML\s*\(

# iframe/srcDoc
srcDoc\s*=
```

## リスク

- **セッションハイジャック**: Cookie窃取
- **フィッシング**: 偽のログインフォーム表示
- **マルウェア配布**: 悪意あるスクリプト実行
- **データ窃取**: フォーム入力の盗聴

## チェック項目

### 1. dangerouslySetInnerHTML の使用

**検出対象**:
```tsx
// 要確認: dangerouslySetInnerHTML の使用
<div dangerouslySetInnerHTML={{ __html: content }} />
```

**判定基準**:

除外条件（安全とみなす）:
- 固定のリテラル文字列のみ
- DOMPurify 等のサニタイズライブラリを通した値
- 信頼できるCMS/APIからの事前サニタイズ済みコンテンツ

**補足**:
- DOMPurify の設定（許可タグ/属性）が適切か確認
- 可能なら `ALLOWED_TAGS` / `ALLOWED_ATTR` を明示

報告対象:
- ユーザー入力を含む値
- URLパラメータを含む値
- サニタイズ処理なしの外部データ

**報告内容**:
- 検出箇所（ファイル名:行番号）
- 設定される値の出所
- サニタイズ処理の有無

### 2. eval() / new Function() の使用

**検出対象**:
```typescript
// NG: eval の使用
eval(userInput);

// NG: new Function の使用
const fn = new Function('return ' + userInput);

// NG: 文字列を渡す setTimeout/setInterval
setTimeout('alert("hello")', 1000);
```

**報告内容**:
- 検出箇所（ファイル名:行番号）
- 実行される文字列の出所
- 代替手段の提案

### 3. DOM 操作による HTML 挿入

**検出対象**:
```typescript
// NG: innerHTML への代入
element.innerHTML = userContent;

// NG: document.write
document.write(content);

// NG: insertAdjacentHTML
element.insertAdjacentHTML('beforeend', userContent);
```

**注意**: React では通常 DOM 直接操作は避けるべきだが、レガシーコードや外部ライブラリ連携で発生する可能性がある。外部ライブラリ経由の場合は **要確認** とする。

**報告内容**:
- 検出箇所
- 挿入される内容の出所
- React的な代替手段の提案

### 4. URL パラメータの不適切な使用

**検出対象**:
```typescript
// NG: URLパラメータを直接表示
const params = new URLSearchParams(window.location.search);
const name = params.get('name');
return <div dangerouslySetInnerHTML={{ __html: name }} />;

// NG: href に未検証のURLを設定
<a href={userProvidedUrl}>Link</a>  // javascript: スキーム攻撃
```

**報告内容**:
- 検出箇所
- パラメータの使用方法
- サニタイズの有無
- `javascript:` / `data:` スキームの許可有無

### 5. React の安全なパターン確認

**確認項目**:
```tsx
// OK: React の自動エスケープ
<div>{userContent}</div>  // 自動的にHTMLエスケープ

// OK: textContent 相当
<span>{message}</span>

// OK: 属性値もエスケープ
<input value={userInput} />
```

## React 特有の注意点

React は JSX 内の変数を自動的にエスケープするため、多くの XSS は防がれる。
ただし以下は例外:

1. `dangerouslySetInnerHTML` - 明示的に HTML を許可
2. `href`/`src` 属性 - `javascript:` スキーム
3. `style` 属性 - CSS インジェクション（限定的）
4. Server Components での `<script>` タグ生成
5. `srcDoc` 属性 - iframe にHTMLを直接埋め込み

## 追加の対策（推奨）

- CSP（Content-Security-Policy）を設定し、インラインスクリプトの実行を制限
- Trusted Types の導入を検討（大規模アプリ向け）

## チェック結果の記載例

```markdown
## XSS脆弱性

### 検出結果
- dangerouslySetInnerHTML: 3件
- eval()/new Function(): 0件
- DOM直接操作: 1件
- URLパラメータ: 1件

### dangerouslySetInnerHTML

| ファイル | 行 | 値の出所 | サニタイズ | 判定 |
|----------|-----|----------|------------|------|
| components/BlogPost.tsx | 42 | CMS API | DOMPurify | OK |
| components/Comment.tsx | 15 | ユーザー入力 | なし | NG |
| pages/preview.tsx | 28 | URLパラメータ | なし | NG |

### DOM直接操作

| ファイル | 行 | 操作 | 内容の出所 |
|----------|-----|------|------------|
| utils/legacy.ts | 55 | innerHTML | 外部ライブラリ |

### URLパラメータの不適切な使用

| ファイル | 行 | パラメータ | 使用方法 |
|----------|-----|------------|----------|
| components/Link.tsx | 12 | redirect | href属性に直接使用 |

### 推奨対応

1. `Comment.tsx`: DOMPurify でサニタイズ、または textContent で表示
2. `preview.tsx`: URLパラメータをエスケープ処理
3. `Link.tsx`: 許可されたURLパターンのみ受け入れる
```

## 安全な実装例

```tsx
// DOMPurify を使用したサニタイズ
import DOMPurify from 'dompurify';

function SafeHTML({ html }: { html: string }) {
  const sanitized = DOMPurify.sanitize(html);
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

// URL の安全な検証
function SafeLink({ url, children }: { url: string; children: React.ReactNode }) {
  const isValidUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  if (!isValidUrl(url)) {
    return <span>{children}</span>;
  }

  return <a href={url}>{children}</a>;
}

// ユーザー入力は常にテキストとして表示
function UserContent({ content }: { content: string }) {
  return <p>{content}</p>;  // React が自動エスケープ
}
```
