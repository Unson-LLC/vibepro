# Vercel リファレンス

## フレームワーク別ビルド設定

### Next.js (App Router)

| 設定 | 値 |
|------|-----|
| Framework Preset | Next.js |
| Build command | `npm run build` |
| Output directory | `.next` |
| Node.js | 18+ / 20+ |

**自動検出**: Vercel は Next.js を自動検出し、最適な設定を適用。

### Next.js (Static Export)

| 設定 | 値 |
|------|-----|
| Build command | `npm run build` |
| Output directory | `out` |

**必要な設定**:
```js
// next.config.js
module.exports = {
  output: 'export'
}
```

### React (Create React App)

| 設定 | 値 |
|------|-----|
| Framework Preset | Create React App |
| Build command | `npm run build` |
| Output directory | `build` |
| Node.js | 18+ |

### Vite (React/Vue/Svelte)

| 設定 | 値 |
|------|-----|
| Framework Preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 18+ |

### Nuxt 3

| 設定 | 値 |
|------|-----|
| Framework Preset | Nuxt.js |
| Build command | `npm run build` |
| Output directory | `.output` |
| Node.js | 18+ |

### Astro

| 設定 | 値 |
|------|-----|
| Framework Preset | Astro |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js | 18+ |

### SvelteKit

| 設定 | 値 |
|------|-----|
| Framework Preset | SvelteKit |
| Build command | `npm run build` |
| Output directory | `.svelte-kit` |
| Node.js | 18+ |

**必要**: `@sveltejs/adapter-vercel`

### 静的HTML

| 設定 | 値 |
|------|-----|
| Framework Preset | Other |
| Build command | なし |
| Output directory | `/` または `public` |

---

## API Routes / Route Handlers

### App Router (Next.js 13+)

```ts
// app/api/hello/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ message: 'Hello' });
}

export async function POST(request: Request) {
  const body = await request.json();
  return NextResponse.json({ received: body });
}
```

### Pages Router (Next.js 12以前)

```ts
// pages/api/hello.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  res.status(200).json({ message: 'Hello' });
}
```

### Edge Runtime

```ts
// app/api/edge/route.ts
export const runtime = 'edge';

export async function GET() {
  return new Response('Hello from Edge!');
}
```

---

## Server Actions (Next.js 14+)

```ts
// app/actions.ts
'use server';

export async function submitForm(formData: FormData) {
  const name = formData.get('name');
  // サーバーサイド処理
  return { success: true };
}
```

---

## 環境変数

### 種類

| プレフィックス | 公開範囲 | 用途 |
|----------------|----------|------|
| `NEXT_PUBLIC_` | クライアント + サーバー | 公開可能な設定 |
| なし | サーバーのみ | 秘密情報 |

### 設定方法

**Dashboard:**
Settings > Environment Variables

**CLI:**
```bash
# 追加
vercel env add DATABASE_URL

# 一覧
vercel env ls

# 取得（ローカル開発用）
vercel env pull .env.local
```

### 環境別設定

| 環境 | 説明 |
|------|------|
| Production | 本番デプロイ（mainブランチ） |
| Preview | プレビューデプロイ（PR、その他ブランチ） |
| Development | ローカル開発（`vercel dev`） |

---

## vercel.json 設定

### 基本設定

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": ".next",
  "installCommand": "npm install",
  "framework": "nextjs"
}
```

### リージョン設定

```json
{
  "regions": ["hnd1"]
}
```

| リージョン | 場所 |
|------------|------|
| hnd1 | 東京 |
| icn1 | ソウル |
| sfo1 | サンフランシスコ |
| iad1 | ワシントンDC |
| fra1 | フランクフルト |

### リダイレクト

```json
{
  "redirects": [
    { "source": "/old", "destination": "/new", "permanent": true }
  ]
}
```

### ヘッダー

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" }
      ]
    }
  ]
}
```

### Rewrites (プロキシ)

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.example.com/:path*" }
  ]
}
```

---

## Vercel CLI コマンド

### よく使うコマンド

```bash
# ログイン
vercel login

# プロジェクト初期化・デプロイ（プレビュー）
vercel

# 本番デプロイ
vercel --prod

# ローカル開発サーバー
vercel dev

# 環境変数をローカルに取得
vercel env pull .env.local

# プロジェクト設定をリンク
vercel link

# ログ確認
vercel logs [deployment-url]

# ドメイン追加
vercel domains add example.com
```

---

## ビルド制限（Hobby プラン）

| 項目 | 制限 |
|------|------|
| ビルド時間 | 45分 |
| Serverless Function実行時間 | 10秒 |
| Edge Function実行時間 | 30秒 |
| 帯域幅 | 100GB/月 |
| Serverless Function呼び出し | 100,000/月 |

### Pro プラン

| 項目 | 制限 |
|------|------|
| ビルド時間 | 45分 |
| Serverless Function実行時間 | 60秒 |
| Edge Function実行時間 | 30秒 |
| 帯域幅 | 1TB/月 |

---

## デバッグ

### ビルドログ確認

Dashboard > Deployments > View Build Logs

### 関数ログ確認

```bash
vercel logs [deployment-url] --follow
```

### ローカルでの本番環境再現

```bash
# 環境変数を取得
vercel env pull .env.local

# 本番ビルド
npm run build

# ローカルサーバー起動
vercel dev
```

---

## Supabase との連携

### 環境変数設定

```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # サーバーのみ
```

### Vercel Integration

1. https://vercel.com/integrations/supabase
2. Connect を選択
3. 環境変数が自動設定される

---

## トラブルシューティング

### ビルドエラー

1. ローカルで `npm run build` を実行して確認
2. Node.js バージョンを確認（package.json の engines）
3. 環境変数が設定されているか確認

### 関数タイムアウト

- Hobby: 10秒制限 → Pro へアップグレードまたは Edge Runtime を使用
- データベースクエリの最適化
- キャッシュの活用

### 環境変数が読めない

- `NEXT_PUBLIC_` プレフィックスを確認
- デプロイ後に環境変数を変更した場合は再デプロイが必要
