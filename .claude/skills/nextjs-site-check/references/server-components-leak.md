# Server Components 秘密漏洩チェック

Next.js Server Components から Client Components への秘密情報漏洩を検出・報告する。

## 深刻度: Critical

## 出力先: `results/nextjs-check-server-components.md`

Server Components で取得した秘密情報が誤って Client Components に渡されると、ブラウザに露出する。

## 検出パターン

```
# Server → Client props経由の漏洩
# Server Component内でapiKey/secret/token/passwordを取得し、Client Componentに渡す

# console.logでの機密出力
console\.log\(.*(?:key|secret|token|password|credential)

# Server Actions での return / Response
return.*(?:apiKey|secret|token|password)
Response\.json\(.*(?:apiKey|secret|token|password)

# 典型的な秘密情報の取得元
process\.env\.(?:[A-Z0-9_]+)
cookies\(\)|headers\(\)
```

## リスク

- **秘密情報のブラウザ露出**: DevTools で誰でも閲覧可能
- **認証情報漏洩**: APIキー、トークン、パスワードの流出
- **デバッグログ経由**: 本番環境でも console.log が残っている場合

## チェック項目

### 1. Server → Client Components への props 渡し

**検出対象**:
Server Component 内で以下のパターン:
```typescript
// NG: 秘密情報を props で渡す
export default async function Page() {
  const apiKey = process.env.API_SECRET;
  return <ClientComponent apiKey={apiKey} />;  // 危険
}
```

**報告内容**:
- Server Component ファイル名と行番号
- 渡されている props 名
- 受け取る Client Component 名

### 2. console.log での機密情報出力

**検出対象**:
```typescript
console.log(apiKey);
console.log({ token, secret });
console.log("API Key:", process.env.API_SECRET);
```

**除外条件**:
- 開発環境限定のログ（`if (process.env.NODE_ENV === 'development')`）
- マスク処理されたログ

**報告内容**:
- 検出箇所（ファイル名:行番号）
- 出力される可能性のある情報

### 3. Server Actions での秘密情報 return

**検出対象**:
```typescript
'use server'

export async function getConfig() {
  return {
    apiKey: process.env.API_SECRET,  // 危険
  };
}
```

**報告内容**:
- Server Action ファイル名と関数名
- return される秘密情報
- `Response.json` などのレスポンスで秘密情報が返っていないか

### 4. fetch レスポンスの不適切な転送

**検出対象**:
```typescript
// Server Component
const response = await fetch('...', {
  headers: { Authorization: `Bearer ${token}` }
});
const data = await response.json();
// data にトークンや認証情報が含まれる可能性
return <ClientComponent data={data} />;  // 確認が必要
```

**報告内容**:
- 検出箇所
- 転送されるデータの内容（確認推奨）
- トークン/署名/秘密情報が含まれる可能性がある場合は **要確認**

## Server/Client Component の判別方法

```typescript
// Client Component（ファイル先頭に 'use client'）
'use client'
export function ClientComponent() { ... }

// Server Component（'use client' なし、デフォルト）
export default async function ServerPage() { ... }

// Server Action（ファイル先頭に 'use server' または関数内）
'use server'
export async function serverAction() { ... }
```

**補足**:
- App Router では `use client` がない限り Server Component として扱われる
- ルート配下 (`app/**`) は原則 Server Component デフォルト

## チェック結果の記載例

```markdown
## Server Components 秘密漏洩

### 検出結果
- props経由の漏洩: 1件（Critical）
- console.log機密出力: 2件（High）
- Server Actions return: 0件

### props経由の秘密漏洩

| Server Component | Client Component | 渡される props |
|-----------------|------------------|----------------|
| app/dashboard/page.tsx:15 | components/ApiClient.tsx | apiKey |

### console.log 機密出力

| ファイル | 行 | 出力内容 |
|----------|-----|----------|
| lib/auth.ts | 42 | console.log(token) |
| services/api.ts | 28 | console.log({ secret }) |

### 推奨対応

1. `apiKey` は Server Component 内でのみ使用し、Client Component には渡さない
2. 本番環境では console.log を削除、または環境変数で制御
3. 必要な場合は、秘密情報を使う処理を API Route に移動
```

## 安全なパターン

```typescript
// OK: Server Component 内で完結
export default async function Page() {
  const apiKey = process.env.API_SECRET;
  const data = await fetchWithApiKey(apiKey);  // サーバーで完結
  return <ClientComponent data={data.publicInfo} />;  // 公開情報のみ渡す
}

// OK: Server Action で最小限のみ返す
'use server'
export async function getPublicConfig() {
  return {
    publicFlag: true,
  };
}

// OK: API Route 経由
// app/api/data/route.ts
export async function GET() {
  const apiKey = process.env.API_SECRET;
  const data = await fetchWithApiKey(apiKey);
  return Response.json(data.publicInfo);
}

// Client Component
'use client'
export function ClientComponent() {
  const { data } = useSWR('/api/data', fetcher);
  // ...
}
```
