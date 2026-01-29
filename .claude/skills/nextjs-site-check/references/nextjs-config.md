# next.config セキュリティチェック

Next.js の設定ファイル（`next.config.js` / `next.config.ts` / `next.config.mjs`）のセキュリティ設定を確認・報告する。

## 深刻度: Medium

## 出力先: `results/nextjs-check-nextjs-config.md`

next.config の設定不備は、セキュリティヘッダー不足、意図しないリソースアクセスにつながる。

## 検出パターン

```
# セキュリティヘッダー
headers\(\)
X-Content-Type-Options
X-Frame-Options
Content-Security-Policy
X-XSS-Protection
Referrer-Policy
Strict-Transport-Security

# 画像設定
images:.*remotePatterns
images:.*domains

# リダイレクト/リライト
redirects\(\)
rewrites\(\)
```

## リスク

- **クリックジャッキング**: X-Frame-Options 未設定
- **MIMEタイプ偽装**: X-Content-Type-Options 未設定
- **XSS**: CSP 未設定
- **画像の不正読み込み**: remotePatterns の過剰許可

## チェック項目

### 1. セキュリティヘッダー

**検出対象**:
```typescript
// next.config.ts
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
```

**確認項目**:

| ヘッダー | 用途 | 推奨値 |
|----------|------|--------|
| X-Content-Type-Options | MIMEスニッフィング防止 | nosniff |
| X-Frame-Options | クリックジャッキング防止 | DENY または SAMEORIGIN |
| Content-Security-Policy | XSS/インジェクション防止 | 適切なポリシー |
| Referrer-Policy | リファラー情報の制御 | strict-origin-when-cross-origin |
| Strict-Transport-Security | HTTPS強制 | max-age=31536000 |
| X-XSS-Protection | レガシー向け | 任意（現代ブラウザでは非推奨） |

**報告内容**:
- 設定されているヘッダー
- 不足しているヘッダー
- 推奨値との差異
- `headers()` の `source` によって API/特定パスへ適用漏れがないか

### 2. images.remotePatterns

**検出対象**:
```typescript
// NG: ワイルドカードで全許可
images: {
  remotePatterns: [
    { protocol: 'https', hostname: '**' },  // 危険
  ],
}

// OK: 必要なドメインのみ許可
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'images.example.com' },
    { protocol: 'https', hostname: '*.supabase.co' },
  ],
}
```

**判定基準**:
- `hostname: '**'` や `hostname: '*'` → 警告
- 具体的なドメイン指定 → OK

**報告内容**:
- 許可されているパターン
- 過剰な許可がある場合の警告

### 3. 非推奨の images.domains

**検出対象**:
```typescript
// 非推奨（Next.js 14+）
images: {
  domains: ['example.com'],  // 非推奨
}
```

**報告内容**:
- `domains` の使用を検出
- `remotePatterns` への移行を推奨

**移行例**:
```typescript
images: {
  remotePatterns: [{ protocol: 'https', hostname: 'example.com' }],
}
```

### 4. redirects / rewrites

**検出対象**:
```typescript
async redirects() {
  return [
    {
      source: '/old-path',
      destination: '/new-path',
      permanent: true,
    },
  ];
}
```

**確認項目**:
- 外部URLへのリダイレクトがある場合、意図したものか
- オープンリダイレクト脆弱性のリスク
- `destination` にクエリ/パスを連結していないか（例: `?next=${...}`）

**報告内容**:
- 外部URLへのリダイレクト
- ユーザー入力を含む可能性のあるリダイレクト

### 5. 実験的機能

**検出対象**:
```typescript
experimental: {
  serverActions: true,
  // その他の実験的機能
}
```

**報告内容**:
- 使用している実験的機能
- 本番環境での使用に関する注意

### 6. 環境変数の公開設定

**検出対象**:
```typescript
env: {
  CUSTOM_KEY: 'value',  // クライアントに公開される
}
```

**報告内容**:
- `env` で公開されている変数
- 秘密情報が含まれていないか

## 推奨される next.config 設定

```typescript
// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // セキュリティヘッダー
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },

  // 画像の外部ソース
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.example.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },

  // その他の推奨設定
  poweredByHeader: false,  // X-Powered-By ヘッダーを削除
  reactStrictMode: true,
};

export default nextConfig;
```

## Content-Security-Policy の例

```typescript
const cspHeader = `
  default-src 'self';
  script-src 'self';
  style-src 'self';
  img-src 'self' blob: data: https:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
`.replace(/\n/g, '');

// 注意: 必要がない限り 'unsafe-inline' や 'unsafe-eval' は避ける

// headers() 内で使用
{
  key: 'Content-Security-Policy',
  value: cspHeader,
}
```

## チェック結果の記載例

```markdown
## next.config セキュリティ

### 検出結果
- セキュリティヘッダー: 一部不足
- images.remotePatterns: 要確認
- redirects: 問題なし

### セキュリティヘッダー

| ヘッダー | 設定 | 推奨値 | 判定 |
|----------|------|--------|------|
| X-Content-Type-Options | nosniff | nosniff | OK |
| X-Frame-Options | 未設定 | DENY | NG |
| Content-Security-Policy | 未設定 | 要設定 | NG |
| Referrer-Policy | 未設定 | strict-origin-when-cross-origin | NG |

### images.remotePatterns

| パターン | 判定 |
|----------|------|
| https://*.supabase.co | OK |
| https://** | NG - 全ホスト許可 |

### その他の設定

| 設定 | 現在値 | 推奨 |
|------|--------|------|
| poweredBy | true（デフォルト） | false |
| reactStrictMode | true | true |

### 推奨対応

1. セキュリティヘッダーを `headers()` で設定
2. `images.remotePatterns` を必要なドメインのみに制限
3. `poweredBy: false` を追加
```
