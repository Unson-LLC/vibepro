# Next.js サイトセキュリティチェック結果

**診断日時**: 2026-01-31
**対象**: target/ (vibe-todos)
**技術スタック**: Next.js 16.1.4 / React 19.2.3 / Supabase / better-auth / TypeScript
**コード行数**: 約1,456行

---

## 総合スコア

| カテゴリ | スコア | 判定 |
|----------|--------|------|
| **セキュリティ** | 75/100 | B |
| **設定品質** | 70/100 | B |
| **総合** | 73/100 | B |

---

## セキュリティチェック結果（7カテゴリ）

### 1. 環境変数管理 [Critical] - 18/20点

**結果**: ⚠️ 軽微な問題あり

| チェック項目 | 結果 |
|--------------|------|
| `NEXT_PUBLIC_` に秘密情報が含まれていないか | ✅ OK |
| `.env` ファイルがリポジトリにコミットされていないか | ⚠️ `.env.local` が存在（ただし `.gitignore` に含まれている可能性あり） |
| 本番環境の認証情報がハードコードされていないか | ✅ OK |

**検出内容**:
- `.env.local` ファイルが存在し、ローカル開発用の認証情報が含まれている
- `NEXT_PUBLIC_` には適切な公開情報（URL、anon key）のみ

**推奨対応**:
- `.env.local` が `.gitignore` に含まれていることを確認
- 本番デプロイ時は環境変数をホスティングプラットフォームで設定

---

### 2. Server Components 秘密漏洩 [Critical] - 15/15点

**結果**: ✅ 問題なし

| チェック項目 | 結果 |
|--------------|------|
| クライアントへの秘密情報シリアライズ | ✅ OK |
| `"use client"` の不適切な使用 | ✅ OK |
| Server Actions での認証チェック | ✅ OK |

**検出内容**:
- `src/actions/todos.ts`: Server Actions で適切に `getSession()` による認証チェックを実施
- クライアントコンポーネントは適切に分離されている
- 秘密情報（`SUPABASE_SERVICE_ROLE_KEY`）はサーバーサイドでのみ使用

---

### 3. Supabase RLS 設定 [Critical] - 10/20点

**結果**: ❌ 重大な問題あり

| チェック項目 | 結果 |
|--------------|------|
| RLS ポリシーが設定されているか | ❌ 未設定 |
| `service_role` キーの露出 | ✅ サーバーサイドのみ |
| 認可制御の実装 | ⚠️ アプリ層のみ |

**検出内容**:
- `supabase/migrations/001_initial.sql`: RLS ポリシーが一切定義されていない
- `todo` テーブルに対する行レベルセキュリティが未設定
- 認可制御はアプリケーション層（`user_id` フィルタ）のみに依存

**リスク**:
- `service_role` キーが漏洩した場合、全ユーザーのデータにアクセス可能
- データベース直接アクセス時の防御層がない

**推奨対応**:
```sql
-- RLS を有効化
ALTER TABLE "todo" ENABLE ROW LEVEL SECURITY;

-- ポリシーを追加
CREATE POLICY "Users can only access their own todos"
ON "todo"
FOR ALL
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
```

---

### 4. SQL インジェクション [Critical] - 15/15点

**結果**: ✅ 問題なし

| チェック項目 | 結果 |
|--------------|------|
| 文字列連結によるクエリ構築 | ✅ なし |
| パラメータ化クエリの使用 | ✅ Supabase SDK 使用 |

**検出内容**:
- すべてのデータベース操作は Supabase SDK のメソッドを使用
- ユーザー入力はメソッドパラメータとして渡され、自動的にエスケープされる
- 生 SQL クエリの使用なし

---

### 5. API Routes 認証 [High] - 15/15点

**結果**: ✅ 問題なし

| チェック項目 | 結果 |
|--------------|------|
| 認証チェックなしの API ルート | ✅ なし |
| better-auth ハンドラーの設定 | ✅ 適切 |

**検出内容**:
- `src/app/api/auth/[...all]/route.ts`: better-auth のハンドラーを適切に設定
- カスタム API ルートは存在せず、すべて Server Actions 経由
- Server Actions は `getSession()` で認証を確認

---

### 6. better-auth 実装 [High] - 8/10点

**結果**: ⚠️ 軽微な問題あり

| チェック項目 | 結果 |
|--------------|------|
| セッション検証 | ✅ 適切 |
| リダイレクト設定 | ✅ 適切 |
| Middleware 認証 | ⚠️ Cookie 存在のみチェック |

**検出内容**:
- `src/lib/auth.ts`: 適切なセッション設定（7日間有効、1日更新）
- `src/middleware.ts`: Cookie の存在のみで認証判定（セッション有効性の検証なし）

**リスク**:
- Middleware レベルでは Cookie の存在のみチェックしており、セッションの有効性は検証していない
- 期限切れセッションでもページにアクセスできる可能性（ただし API 呼び出し時に拒否される）

**推奨対応**:
- Middleware での認証チェックを強化するか、現状の動作を許容する旨をドキュメント化

---

### 7. XSS 対策 [High] - 5/5点

**結果**: ✅ 問題なし

| チェック項目 | 結果 |
|--------------|------|
| `dangerouslySetInnerHTML` の使用 | ✅ なし |
| 未サニタイズ入力の出力 | ✅ なし |

**検出内容**:
- `dangerouslySetInnerHTML` の使用なし
- React の自動エスケープ機能を活用
- ユーザー入力はすべて適切に処理

---

## 設定品質チェック結果（3カテゴリ）

### 1. npm 脆弱性 [Medium〜Critical] - 20/40点

**結果**: ❌ 重大な問題あり

| 深刻度 | 件数 |
|--------|------|
| High | 1 |
| Moderate | 2 |
| Total | 3 |

**検出された脆弱性**:

| パッケージ | 脆弱性 | 深刻度 | CVE |
|------------|--------|--------|-----|
| next@16.1.4 | HTTP request deserialization DoS | High | CVE-2026-23864 |
| next@16.1.4 | Image Optimizer DoS | Moderate | CVE-2025-59471 |
| next@16.1.4 | PPR Resume Endpoint DoS | Moderate | CVE-2025-59472 |

**推奨対応**:
```bash
pnpm update next@16.1.5
```

---

### 2. TypeScript 設定 [Medium] - 30/30点

**結果**: ✅ 問題なし

| チェック項目 | 結果 |
|--------------|------|
| `strict: true` | ✅ 有効 |
| `any` の多用 | ✅ なし |
| 適切な型定義 | ✅ あり |

**検出内容**:
- `tsconfig.json`: `strict: true` が設定されている
- 型定義ファイル `src/types/index.ts` で適切に型を定義
- `any` 型の使用なし

---

### 3. next.config 設定 [Medium] - 20/30点

**結果**: ⚠️ 改善の余地あり

| チェック項目 | 結果 |
|--------------|------|
| セキュリティヘッダー | ⚠️ 未設定 |
| 本番環境最適化 | ⚠️ 未設定 |

**検出内容**:
- `next.config.ts`: 空の設定（デフォルトのみ）
- セキュリティヘッダー（CSP、X-Frame-Options 等）が未設定

**推奨対応**:
```typescript
const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    },
  ],
};
```

---

## スコア詳細

### セキュリティスコア（100点満点）

| カテゴリ | 配点 | 得点 | 減点理由 |
|----------|------|------|----------|
| 環境変数管理 | 20 | 18 | .env.local の存在 |
| Server Components | 15 | 15 | - |
| Supabase RLS | 20 | 10 | RLS 未設定 |
| SQL インジェクション | 15 | 15 | - |
| API Routes 認証 | 15 | 15 | - |
| better-auth 実装 | 10 | 8 | Middleware 認証の不完全 |
| XSS 対策 | 5 | 5 | - |
| **合計** | **100** | **86** | |

※ RLS 未設定は重大なため、重み付けにより 75/100 に調整

### 設定品質スコア（100点満点）

| カテゴリ | 配点 | 得点 | 減点理由 |
|----------|------|------|----------|
| npm 脆弱性 | 40 | 20 | High 1件、Moderate 2件 |
| TypeScript 設定 | 30 | 30 | - |
| next.config 設定 | 30 | 20 | セキュリティヘッダー未設定 |
| **合計** | **100** | **70** | |

---

## 検出リスク一覧

| # | カテゴリ | 深刻度 | 内容 | ファイル |
|---|----------|--------|------|----------|
| 1 | Supabase RLS | Critical | RLS ポリシー未設定 | supabase/migrations/001_initial.sql |
| 2 | npm 脆弱性 | High | Next.js DoS 脆弱性 | package.json (next@16.1.4) |
| 3 | npm 脆弱性 | Moderate | Next.js Image Optimizer DoS | package.json (next@16.1.4) |
| 4 | npm 脆弱性 | Moderate | Next.js PPR Resume DoS | package.json (next@16.1.4) |
| 5 | next.config | Medium | セキュリティヘッダー未設定 | next.config.ts |
| 6 | better-auth | Low | Middleware 認証の不完全 | src/middleware.ts |

---

## 商用化判定

**判定**: ⚠️ **重要な修正が必要**

### 理由

1. **Critical レベルの問題**:
   - Supabase RLS が未設定（データ漏洩リスク）

2. **High レベルの問題**:
   - Next.js に既知の DoS 脆弱性（CVE-2026-23864）

### 商用化に必要な対応

| 優先度 | 対応内容 | 工数目安 |
|--------|----------|----------|
| 必須 | Supabase RLS ポリシーの設定 | 2-4時間 |
| 必須 | Next.js 16.1.5 へのアップデート | 1時間 |
| 推奨 | next.config へのセキュリティヘッダー追加 | 1時間 |

---

## 次のステップ

1. `/vercel-deploy` でデプロイ計画を作成
2. `/risk-register` でリスク台帳を作成
3. `/estimate` で見積もりを作成
