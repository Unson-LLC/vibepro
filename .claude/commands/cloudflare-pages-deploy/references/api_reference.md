# Cloudflare Pages リファレンス

## フレームワーク別ビルド設定

### React (Create React App)

| 設定 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output | `build` |
| Node.js | 18+ |

### Vite (React/Vue/Svelte)

| 設定 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output | `dist` |
| Node.js | 18+ |

### Next.js (Static Export)

| 設定 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output | `out` |
| Node.js | 18+ |

**注意**: `next.config.js` に `output: 'export'` が必要。

### Next.js (SSR with @cloudflare/next-on-pages)

| 設定 | 値 |
|------|-----|
| Build command | `npx @cloudflare/next-on-pages` |
| Build output | `.vercel/output/static` |
| Node.js | 18+ |

**必要な設定**:
```js
// next.config.js
module.exports = {
  experimental: {
    runtime: 'edge'
  }
}
```

### Nuxt 3

| 設定 | 値 |
|------|-----|
| Build command | `npm run generate` |
| Build output | `.output/public` |
| Node.js | 18+ |

### Astro

| 設定 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output | `dist` |
| Node.js | 18+ |

### SvelteKit

| 設定 | 値 |
|------|-----|
| Build command | `npm run build` |
| Build output | `.svelte-kit/cloudflare` |
| Node.js | 18+ |

**必要**: `@sveltejs/adapter-cloudflare`

### 静的HTML

| 設定 | 値 |
|------|-----|
| Build command | なし |
| Build output | `/` または `public` |

---

## Pages Functions

### ディレクトリ構造

```
project/
├── functions/
│   ├── api/
│   │   └── hello.js    → /api/hello
│   └── [[path]].js     → キャッチオール
└── public/
```

### 基本的なFunction

```js
// functions/api/hello.js
export async function onRequest(context) {
  return new Response(JSON.stringify({ message: 'Hello' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
```

### メソッド別ハンドラ

```js
export async function onRequestGet(context) {
  // GET
}

export async function onRequestPost(context) {
  // POST
}
```

---

## 環境変数

### 設定方法

**Dashboard:**
Settings > Environment variables

**CLI:**
```bash
wrangler pages secret put API_KEY
```

### アクセス方法

**ビルド時 (静的)**:
```js
process.env.API_KEY  // Vite: import.meta.env.VITE_API_KEY
```

**Functions (ランタイム)**:
```js
export async function onRequest(context) {
  const apiKey = context.env.API_KEY;
}
```

---

## カスタムドメイン

### 設定手順

1. Dashboard > Custom domains > Add
2. ドメイン入力
3. DNS設定（自動 or 手動）

### DNS設定（手動の場合）

```
# Apex domain (@)
CNAME  @  project.pages.dev

# www subdomain
CNAME  www  project.pages.dev
```

---

## リダイレクトとヘッダー

### _redirects

```
# 静的リダイレクト
/old-path  /new-path  301

# SPA フォールバック
/*  /index.html  200
```

### _headers

```
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
```

---

## ビルド制限

| 項目 | 制限 |
|------|------|
| ビルド時間 | 20分 |
| ファイル数 | 20,000 |
| ファイルサイズ | 25MB/ファイル |
| 合計サイズ | 制限なし（Enterpriseは25GB） |

---

## デバッグ

### ビルドログ確認

Dashboard > Deployments > View details

### ローカル開発

```bash
wrangler pages dev ./dist
```

### Functionsローカルテスト

```bash
wrangler pages dev ./dist --binding API_KEY=xxx
```
