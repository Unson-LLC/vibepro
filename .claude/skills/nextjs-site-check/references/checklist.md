# Next.js アプリ公開チェックリスト（App Router）

対象: Next.js + Supabase + better-auth 構成のウェブアプリケーション
技術スタック: Next.js / React / TypeScript / Supabase / better-auth / Tailwind CSS

---

## 0. 技術スタック確認

- [ ] Next.js（App Router）を使用
- [ ] TypeScript を使用
- [ ] Supabase をデータベースとして使用
- [ ] better-auth を認証に使用

---

## 1. 最優先（Critical）: 情報漏洩・データ破壊のリスク

### 1.1 環境変数管理

→ 対応方法: [env-variables.md](env-variables.md)
→ 出力先: `results/nextjs-check-env-variables.md`

- [ ] `NEXT_PUBLIC_` 変数に秘密情報（SECRET/KEY/TOKEN/PASSWORD）が含まれていない
- [ ] `.env*` ファイルが `.gitignore` に含まれている
- [ ] コード内にハードコードされた認証情報がない
- [ ] 本番用の環境変数が適切に管理されている（Vercel等）
- [ ] `BETTER_AUTH_SECRET` が十分な強度のランダム文字列である

検出パターン:
```
NEXT_PUBLIC_.*(SECRET|KEY|TOKEN|PASSWORD|PRIVATE)
\.env$|\.env\.|\.env\.local
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]
sk-[a-zA-Z0-9]{20,}
BETTER_AUTH_SECRET=.{1,20}$
```

### 1.2 Server Components 秘密漏洩

→ 対応方法: [server-components-leak.md](server-components-leak.md)
→ 出力先: `results/nextjs-check-server-components.md`

- [ ] Server Components から Client Components への props に秘密情報を渡していない
- [ ] `console.log` で機密情報（キー/トークン/パスワード）を出力していない
- [ ] Server Actions で秘密情報をクライアントに返していない
- [ ] レスポンスに不要な内部情報を含めていない

検出パターン:
```
export\s+default\s+(?:async\s+)?function.*\{[\s\S]*?(apiKey|secret|token|password)[\s\S]*?return.*<.*Client
console\.log\(.*(?:key|secret|token|password)
```

### 1.3 Supabase RLS

→ 対応方法: [supabase-rls.md](supabase-rls.md)
→ 出力先: `results/nextjs-check-supabase-rls.md`

- [ ] Service Role キーがクライアントコードに露出していない
- [ ] `NEXT_PUBLIC_SUPABASE_*` に Service Role キーを設定していない
- [ ] RLSポリシーが全テーブルに設定されている（要手動確認）
- [ ] anon key 使用時は適切なRLSポリシーで保護されている

検出パターン:
```
NEXT_PUBLIC_SUPABASE.*SERVICE.*ROLE
supabaseServiceRole.*createClient
\.rls_enabled\s*=\s*false
```

### 1.4 SQLインジェクション

→ 対応方法: [sql-injection.md](sql-injection.md)
→ 出力先: `results/nextjs-check-sql-injection.md`

- [ ] 文字列連結によるSQL構築をしていない
- [ ] パラメータ化クエリ / Prepared Statements を使用
- [ ] Supabase のクエリビルダーを正しく使用
- [ ] ユーザー入力をSQL文に直接埋め込んでいない

検出パターン:
```
\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)
`.*\$\{.*\}.*`.*(?:sql|query|execute)
```

---

## 2. 高優先（High）: 認証バイパス・XSSのリスク

### 2.1 API Routes セキュリティ

→ 対応方法: [api-routes-security.md](api-routes-security.md)
→ 出力先: `results/nextjs-check-api-routes.md`

- [ ] 保護が必要なエンドポイントに認証チェックが実装されている
- [ ] 入力バリデーション（Zod等）が実装されている
- [ ] CORS設定が適切（必要な場合）
- [ ] Rate limiting が考慮されている
- [ ] エラーレスポンスに内部情報を含めていない

検出パターン:
```
app/api/.*route\.(ts|js)
# 各ファイルで以下を確認:
# - getServerSession / auth() の呼び出し有無
# - 入力バリデーション（Zod等）の有無
```

### 2.2 better-auth 実装

→ 対応方法: [better-auth.md](better-auth.md)
→ 出力先: `results/nextjs-check-better-auth.md`

- [ ] セッション設定が適切（有効期限等）
- [ ] Cookie設定が安全（secure, httpOnly, sameSite）
- [ ] 保護ルートに適切な認証チェックがある
- [ ] ログイン/ログアウト処理が正しく実装されている
- [ ] パスワードリセット機能がある場合、適切に保護されている

検出パターン:
```
secure:\s*false
httpOnly:\s*false
sameSite:\s*['"]none['"]
session:.*expires
```

### 2.3 XSS対策

→ 対応方法: [xss.md](xss.md)
→ 出力先: `results/nextjs-check-xss.md`

- [ ] `dangerouslySetInnerHTML` の使用箇所がサニタイズされている
- [ ] `eval()` / `new Function()` を使用していない
- [ ] ユーザー入力を直接DOMに挿入していない
- [ ] URLパラメータを安全に処理している

検出パターン:
```
dangerouslySetInnerHTML\s*=
eval\s*\(
new\s+Function\s*\(
```

---

## 3. 中優先（Medium）: 品質・メンテナンス性

### 3.1 npm パッケージ脆弱性

→ 対応方法: [npm-vulnerabilities.md](npm-vulnerabilities.md)
→ 出力先: `results/nextjs-check-npm.md`

- [ ] `npm audit` で high/critical の脆弱性がない
- [ ] 未使用パッケージを削除済み
- [ ] 依存パッケージが定期的に更新されている

検出方法: `package.json` が存在する場合、`npm audit --json` を実行

### 3.2 TypeScript 設定

→ 対応方法: [typescript-config.md](typescript-config.md)
→ 出力先: `results/nextjs-check-typescript.md`

- [ ] `strict: true` が設定されている
- [ ] `noImplicitAny: true` が有効
- [ ] 型安全性が確保されている

検出パターン:
```
"strict":\s*false
# または strict 未設定
```

### 3.3 next.config セキュリティ

→ 対応方法: [nextjs-config.md](nextjs-config.md)
→ 出力先: `results/nextjs-check-nextjs-config.md`

- [ ] セキュリティヘッダーが設定されている
  - [ ] X-Content-Type-Options
  - [ ] X-Frame-Options
  - [ ] Content-Security-Policy（または適切なCSP）
- [ ] `images.remotePatterns` が適切に制限されている
- [ ] 不要なリダイレクトやリライトがない

検出パターン:
```
headers\(\).*\[
X-Content-Type-Options
X-Frame-Options
Content-Security-Policy
```
