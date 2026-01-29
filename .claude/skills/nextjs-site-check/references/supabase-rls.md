# Supabase RLS（Row Level Security）チェック

Supabase のセキュリティ設定、特に Service Role キーの露出と RLS ポリシーを確認・報告する。

## 深刻度: Critical

## 出力先: `results/nextjs-check-supabase-rls.md`

Service Role キーが漏洩すると、RLS をバイパスして全データにアクセス可能になる。

## 検出パターン

```
# Service Role キーのクライアント露出
NEXT_PUBLIC_SUPABASE.*SERVICE.*ROLE
NEXT_PUBLIC.*service_role

# Service Role キーの直接使用（クライアントコード内）
createClient.*service_role
supabase.*service.*role
createBrowserClient.*service_role
SUPABASE_SERVICE_ROLE_KEY

# RLS無効化パターン
\.rls_enabled\s*=\s*false
SECURITY\s+DEFINER
```

## リスク

- **Service Role キー漏洩**: RLS バイパス、全データアクセス
- **RLS 未設定**: 認証されていないユーザーによるデータアクセス
- **不適切なポリシー**: 他ユーザーのデータへのアクセス

## チェック項目

### 1. Service Role キーのクライアント露出

**検出対象**:
- `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` の設定
- クライアントコードでの `service_role` キー使用
- `'use client'` ファイル内での Service Role キー参照

**報告内容**:
- 検出箇所（ファイル名:行番号または環境変数ファイル）
- 露出の種類（環境変数/直接記述）

### 2. Supabase クライアント初期化の確認

**検出対象**:
```typescript
// NG: クライアントで service_role を使用
'use client'
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

// OK: サーバーサイドのみで service_role を使用
// lib/supabase-admin.ts（'use client' なし）
const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
```

**報告内容**:
- Supabase クライアント初期化ファイル一覧
- 各ファイルで使用されているキーの種類（anon/service_role）
- Server/Client Component の判別
- `createBrowserClient` / `createClient` の使い分け

### 3. RLS ポリシーの確認（手動確認フラグ）

**注意**: RLS ポリシーはデータベース側の設定のため、コードからは完全に確認できない。

**確認すべき項目**（Supabase ダッシュボードで確認）:
- 全テーブルで RLS が有効か
- 適切な SELECT/INSERT/UPDATE/DELETE ポリシーがあるか
- `auth.uid()` を使用した認証ユーザー制限
- 公開読み取りが必要なテーブルは `SELECT` ポリシーの例外が意図どおりか

**報告内容**:
- 手動確認が必要な旨を報告
- 確認すべきテーブル一覧（コードから推測）

**確認方法（例）**:
1. Supabase ダッシュボード → Table Editor
2. 各テーブルで「RLS enabled」を確認
3. Authentication → Policies でポリシー内容を確認

### 4. anon キーの安全な使用

**確認対象**:
```typescript
// OK: クライアントで anon キー使用（RLS で保護）
'use client'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

**報告内容**:
- anon キー使用箇所
- RLS ポリシー確認の必要性
- `anon` と `service_role` の混同がないか

## Supabase キーの種類

| キー | 用途 | RLS | クライアント露出 |
|------|------|-----|-----------------|
| anon key | 匿名/認証済みユーザー用 | 適用 | OK（NEXT_PUBLIC_可） |
| service_role key | 管理者用、RLSバイパス | バイパス | NG（絶対に公開しない） |

**注意**:
- `SECURITY DEFINER` は用途がある場合もあるため、関数の用途と権限範囲を要確認

## チェック結果の記載例

```markdown
## Supabase RLS セキュリティ

### 検出結果
- Service Role キー露出: 0件
- クライアントでの不適切な使用: 1件（Critical）
- RLS確認: 要手動確認

### Service Role キーの使用状況

| ファイル | キー種類 | Server/Client | 判定 |
|----------|----------|---------------|------|
| lib/supabase.ts | anon | Client | OK |
| lib/supabase-admin.ts | service_role | Server | OK |
| utils/db.ts | service_role | Client | NG |

### 検出された問題

| ファイル | 行 | 問題 |
|----------|-----|------|
| utils/db.ts | 5 | 'use client' ファイルで service_role キーを使用 |

### 手動確認が必要な項目

以下のテーブルで RLS ポリシーを確認してください:
- users
- posts
- comments

確認方法:
1. Supabase ダッシュボード → Table Editor
2. 各テーブルで「RLS enabled」を確認
3. Authentication → Policies でポリシー内容を確認

### 推奨対応

1. `utils/db.ts` を Server Component 専用に変更、または anon キーを使用
2. 全テーブルで RLS を有効化
3. `auth.uid()` を使用した適切なポリシーを設定
```

## 安全な Supabase 構成例

```typescript
// lib/supabase.ts - クライアント用（anon key）
import { createBrowserClient } from '@supabase/ssr';

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// lib/supabase-admin.ts - サーバー用（service_role key）
import { createClient } from '@supabase/supabase-js';

// Server Components / API Routes でのみ import
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```
