# Vercel デプロイ計画

**作成日**: 2026-01-31
**対象**: target/ (vibe-todos)
**プラットフォーム**: Vercel
**技術スタック**: Next.js 16.1.4 / React 19.2.3 / Supabase / better-auth

---

## 概要

Next.js（App Router）アプリケーションを Vercel にデプロイするための計画書。Supabase をバックエンドとし、better-auth で認証を管理する構成。

---

## 1. 事前準備

### 1.1 必要なアカウント

| サービス | 用途 | プラン |
|----------|------|--------|
| [Vercel](https://vercel.com) | ホスティング | Hobby（無料）または Pro |
| [Supabase](https://supabase.com) | データベース・認証基盤 | Free または Pro |
| [GitHub](https://github.com) | ソースコード管理 | 無料 |

### 1.2 デプロイ前チェック

- [ ] Next.js のバージョンを 16.1.5 以上に更新（脆弱性対応）
- [ ] Supabase プロジェクトを作成済み
- [ ] RLS ポリシーを設定済み（セキュリティチェック結果参照）
- [ ] 本番用環境変数を準備

---

## 2. ビルド設定

### 2.1 Vercel 自動検出設定

| 項目 | 値 |
|------|-----|
| Framework Preset | Next.js |
| Build Command | `pnpm run build` |
| Output Directory | `.next` |
| Install Command | `pnpm install` |
| Node.js Version | 20.x |

**注意**: Vercel は Next.js を自動検出するため、特別な設定は不要。

### 2.2 パッケージマネージャー

```bash
# pnpm 使用（pnpm-lock.yaml 存在により自動検出）
pnpm install
pnpm run build
```

---

## 3. 環境変数設定

### 3.1 必要な環境変数

| 変数名 | 説明 | 公開範囲 |
|--------|------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase プロジェクト URL | クライアント + サーバー |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key | クライアント + サーバー |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key | サーバーのみ |
| `DATABASE_URL` | PostgreSQL 接続文字列 | サーバーのみ |
| `BETTER_AUTH_SECRET` | セッション暗号化キー | サーバーのみ |
| `NEXT_PUBLIC_APP_URL` | アプリケーション URL | クライアント + サーバー |

### 3.2 環境変数の取得

**Supabase から取得**:
1. Supabase Dashboard > Settings > API
2. Project URL → `NEXT_PUBLIC_SUPABASE_URL`
3. anon public → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. service_role → `SUPABASE_SERVICE_ROLE_KEY`

**Supabase から取得（データベース）**:
1. Supabase Dashboard > Settings > Database
2. Connection string (URI) → `DATABASE_URL`

**生成が必要**:
```bash
# BETTER_AUTH_SECRET の生成
openssl rand -base64 32
```

### 3.3 Vercel での設定方法

**Dashboard から設定**:
1. Vercel Dashboard > Project > Settings > Environment Variables
2. 各変数を追加（Production / Preview / Development を選択）

**CLI から設定**:
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add DATABASE_URL
vercel env add BETTER_AUTH_SECRET
vercel env add NEXT_PUBLIC_APP_URL
```

---

## 4. デプロイ手順

### 4.1 初回デプロイ

```bash
# 1. Vercel CLI インストール
npm i -g vercel

# 2. Vercel にログイン
vercel login

# 3. プロジェクトディレクトリで初期化
cd target
vercel link

# 4. 環境変数を設定（前述の手順）

# 5. プレビューデプロイ
vercel

# 6. 本番デプロイ
vercel --prod
```

### 4.2 GitHub 連携（推奨）

1. GitHub にリポジトリをプッシュ
2. Vercel Dashboard > Add New > Project
3. GitHub リポジトリを選択
4. Import
5. 環境変数を設定
6. Deploy

**メリット**:
- プッシュ時に自動デプロイ
- PR ごとにプレビュー環境を自動作成

### 4.3 Supabase Integration（推奨）

1. https://vercel.com/integrations/supabase
2. Add Integration
3. Supabase プロジェクトを選択
4. 環境変数が自動設定される

---

## 5. 推奨設定

### 5.1 vercel.json

```json
{
  "regions": ["hnd1"],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]
    }
  ]
}
```

**リージョン設定**:
- `hnd1`: 東京（日本向けサービスに推奨）

### 5.2 next.config.ts の更新

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // セキュリティヘッダー
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
```

---

## 6. データベースマイグレーション

### 6.1 Supabase 本番環境へのマイグレーション

```bash
# Supabase CLI を使用
pnpm dlx supabase link --project-ref <project-id>
pnpm dlx supabase db push

# または SQL を直接実行
# Supabase Dashboard > SQL Editor で 001_initial.sql を実行
```

### 6.2 RLS ポリシーの追加（必須）

```sql
-- セキュリティチェックで検出された問題を修正
ALTER TABLE "todo" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own todos"
ON "todo"
FOR ALL
USING (user_id = current_setting('request.jwt.claim.sub', true))
WITH CHECK (user_id = current_setting('request.jwt.claim.sub', true));
```

**注意**: better-auth を使用しているため、Supabase Auth の JWT ではなく、アプリケーション層での認証となる。RLS ポリシーは `service_role` キー使用時の防御として設定。

---

## 7. ドメイン設定

### 7.1 カスタムドメインの追加

1. Vercel Dashboard > Project > Settings > Domains
2. Add Domain
3. ドメインを入力
4. DNS 設定を更新

**DNS 設定例**:
| タイプ | 名前 | 値 |
|--------|------|-----|
| A | @ | 76.76.21.21 |
| CNAME | www | cname.vercel-dns.com |

### 7.2 環境変数の更新

本番ドメイン設定後、`NEXT_PUBLIC_APP_URL` を更新:

```
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

---

## 8. 監視・運用

### 8.1 ログ確認

```bash
# デプロイログ
vercel logs <deployment-url>

# リアルタイムログ
vercel logs <deployment-url> --follow
```

### 8.2 Analytics（Pro プラン）

- Vercel Analytics: ページビュー、Web Vitals
- Vercel Speed Insights: パフォーマンス分析

### 8.3 エラー監視（推奨）

- Sentry 連携: https://vercel.com/integrations/sentry
- LogRocket 連携: https://vercel.com/integrations/logrocket

---

## 9. プラン比較

| 機能 | Hobby（無料） | Pro（$20/月） |
|------|---------------|---------------|
| Serverless Function 実行時間 | 10秒 | 60秒 |
| 帯域幅 | 100GB/月 | 1TB/月 |
| 関数呼び出し | 100,000/月 | 無制限 |
| チームメンバー | 1 | 無制限 |
| Analytics | なし | あり |
| Password Protection | なし | あり |

**推奨**: MVP/PoC では Hobby、商用化時は Pro へアップグレード

---

## 10. チェックリスト

### デプロイ前

- [ ] Next.js 16.1.5 以上に更新
- [ ] `pnpm run build` がローカルで成功
- [ ] Supabase プロジェクト作成済み
- [ ] RLS ポリシー設定済み
- [ ] 環境変数を Vercel に設定済み
- [ ] `BETTER_AUTH_SECRET` を生成済み

### デプロイ後

- [ ] ログイン・サインアップが動作
- [ ] Todo の CRUD が動作
- [ ] HTTPS でアクセス可能
- [ ] エラーログを確認

---

## 11. トラブルシューティング

### ビルドエラー

1. ローカルで `pnpm run build` を実行
2. Node.js バージョンを確認（20.x 推奨）
3. 環境変数がすべて設定されているか確認

### 関数タイムアウト

- Hobby プランは 10 秒制限
- データベースクエリの最適化
- Edge Runtime の検討

### 環境変数が読めない

- `NEXT_PUBLIC_` プレフィックスを確認
- 再デプロイが必要（環境変数変更後）

---

## 関連ドキュメント

- [Vercel Next.js ドキュメント](https://vercel.com/docs/frameworks/nextjs)
- [Supabase Vercel Integration](https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
- [better-auth ドキュメント](https://better-auth.com)
