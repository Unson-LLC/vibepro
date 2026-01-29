# better-auth 実装チェック

better-auth を使用した認証実装のセキュリティ設定を確認・報告する。

## 深刻度: High

## 出力先: `results/nextjs-check-better-auth.md`

認証設定の不備は、セッションハイジャック、認証バイパス、アカウント乗っ取りにつながる。

## 検出パターン

```
# Cookie設定
secure:\s*false
httpOnly:\s*false
sameSite:\s*['"]none['"]
cookie:\s*\{

# セッション設定
session:.*expires
expiresIn:
maxAge:
updateAge:

# 不適切なシークレット
secret:\s*['"][^'"]{1,20}['"]
BETTER_AUTH_SECRET=.{1,20}$

# 認証セッション取得
auth\.api\.getSession|getSession|session\(\)|auth\(\)

# レート制限
rateLimit|rate-limit|throttle|limiter
```

## リスク

- **セッションハイジャック**: Cookie 設定不備による盗聴
- **CSRF攻撃**: sameSite 設定不備
- **セッション固定攻撃**: セッション管理の不備
- **ブルートフォース攻撃**: Rate limiting 未実装

## チェック項目

### 1. Cookie 設定

**検出対象**:
```typescript
// NG: 本番環境で secure: false
cookie: {
  secure: false,  // HTTPS必須の環境では危険
  httpOnly: false,  // XSSでCookie窃取可能
  sameSite: 'none',  // CSRF攻撃のリスク
}
```

**適切な設定**:
```typescript
cookie: {
  secure: process.env.NODE_ENV === 'production',
  httpOnly: true,
  sameSite: 'lax',  // または 'strict'
}
```

**報告内容**:
- 検出箇所（ファイル名:行番号）
- 問題のある設定項目
- 推奨される設定値
- `secure/httpOnly/sameSite` が明示的に安全値になっているか

### 2. セッション設定

**検出対象**:
- セッション有効期限の設定
- リフレッシュトークンの設定
- セッションストレージの種類

**確認項目**:
```typescript
session: {
  expiresIn: 60 * 60 * 24 * 7,  // 7日 - 適切か？
  updateAge: 60 * 60 * 24,  // 1日ごとに更新
}
```

**報告内容**:
- セッション有効期限
- 更新間隔
- 推奨事項（一般的には 7〜30日 / 更新 1日程度を目安に妥当性を判断）

### 3. シークレット設定

**検出対象**:
```typescript
// NG: 短いまたは推測可能なシークレット
const auth = betterAuth({
  secret: 'my-secret',  // 短すぎる
});

// NG: ハードコード
const auth = betterAuth({
  secret: 'super-long-secret-key-12345',  // 環境変数を使用すべき
});
```

**適切な設定**:
```typescript
const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,  // 環境変数から
});
```

**報告内容**:
- シークレットの設定方法
- 推定される強度
- 環境変数使用の有無

### 4. 保護ルートの実装

**検出対象**:
- 認証が必要なページ/APIでの認証チェック有無
- middleware.ts での認証チェック

```typescript
// 確認対象: 認証が必要そうなルート
app/dashboard/*
app/settings/*
app/api/user/*
app/admin/*
app/billing/*
```

**報告内容**:
- 保護が必要と思われるルート
- 認証チェックの実装有無
- middleware での保護状況
- better-auth のセッション取得方法（例: `auth.api.getSession`）の使用有無

### 5. ソーシャルログイン設定

**検出対象**:
```typescript
socialProviders: {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  }
}
```

**確認項目**:
- クライアントシークレットの管理方法
- コールバックURLの設定（HTTPS・プロバイダー側との一致）

**報告内容**:
- 使用しているプロバイダー
- シークレットの管理状況
- コールバックURLの整合性

### 6. レート制限（Rate Limiting）

**検出対象**:
- ログイン、パスワードリセット、認証API、検索、書き込み系API
- middleware または better-auth の `rateLimit` 設定

**報告内容**:
- レート制限の有無
- 対象エンドポイント
- 欠如時のリスク（ブルートフォース/DoS）

### 7. パスワードリセットの保護

**検出対象**:
- リセットトークンの有効期限
- トークンの一回限り使用
- 失敗時のログとメッセージ（情報漏洩防止）

**報告内容**:
- 実装有無と保護状況
- 不足時のリスク

## チェック結果の記載例

```markdown
## better-auth 実装

### 検出結果
- Cookie設定: 1件（High）
- セッション設定: 要確認
- シークレット設定: OK
- 保護ルート: 2件（Medium）
- レート制限: 1件（Medium）

### Cookie 設定

| 設定項目 | 現在値 | 推奨値 | 問題 |
|----------|--------|--------|------|
| secure | false | true（本番） | HTTPSでないとCookie盗聴リスク |
| httpOnly | true | true | OK |
| sameSite | 'none' | 'lax' | CSRF攻撃リスク |

### セッション設定

| 設定項目 | 現在値 | コメント |
|----------|--------|----------|
| expiresIn | 7日 | 用途に応じて妥当か確認 |
| updateAge | 1日 | OK |

### 保護ルート

| ルート | 認証チェック | middleware保護 |
|--------|-------------|----------------|
| /dashboard | なし | なし |
| /api/user | あり | - |
| /settings | なし | なし |

### 推奨対応

1. Cookie の `secure` を本番環境で `true` に設定
2. `sameSite` を `'lax'` に変更
3. `/dashboard`, `/settings` に認証チェックを追加
4. middleware.ts で保護ルートを一括管理
```

## 安全な better-auth 設定例

```typescript
// lib/auth.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  database: prismaAdapter(prisma),
  session: {
    expiresIn: 60 * 60 * 24 * 7,  // 7日
    updateAge: 60 * 60 * 24,  // 1日ごとに更新
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,  // 60秒
    max: 10,  // 最大10リクエスト
  },
});
```

```typescript
// middleware.ts
import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

const protectedRoutes = ['/dashboard', '/settings', '/api/user'];

export async function middleware(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route))) {
    if (!session) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*', '/api/user/:path*'],
};
```
