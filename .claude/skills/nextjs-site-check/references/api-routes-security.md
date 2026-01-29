# API Routes セキュリティチェック

Next.js App Router の Route Handlers（`app/api/**/route.ts`）を対象に、認証・認可・入力検証・CORS・エラーレスポンスを確認・報告する。

## 深刻度: High

## 出力先: `results/nextjs-check-api-routes.md`

API Routes の認証不備は、不正アクセス、データ漏洩、権限昇格につながる。

## 検出パターン

```
# API Routes（App Router）ファイル
app/api/.*route\.(ts|js)

# 認証チェックの有無
getServerSession|auth\(\)|auth\.|session|authOptions|getSession|verify|requireAuth

# 入力バリデーション
z\.object|zod|yup|joi|validate

# CORS設定
Access-Control-Allow-Origin
cors
OPTIONS

# レート制限
rateLimit|rate-limit|throttle|limiter
```

## リスク

- **認証バイパス**: 認証チェックなしでデータアクセス
- **認可不備**: 他ユーザーのデータへのアクセス
- **入力インジェクション**: バリデーション不足による攻撃
- **CORS設定ミス**: 意図しないオリジンからのアクセス

## チェック項目

### 公開API/保護APIの整理（前提）

公開APIと保護APIを分類し、保護APIに必須のチェック（認証・認可・入力検証）を重点確認する。

**公開APIの例**:
- ヘルスチェック（`/api/health`）
- 公開コンテンツ取得（認証不要の読み取り）
- 外部Webhook受信用（署名検証が前提）

**保護APIの例**:
- ユーザープロフィール取得/更新
- 課金・請求情報の更新
- 管理者操作、削除、権限変更

### 1. 認証チェックの実装

**検出対象**:
全 API Routes ファイルで認証チェックの有無を確認

```typescript
// NG: 認証チェックなし
export async function GET() {
  const users = await db.user.findMany();
  return Response.json(users);  // 誰でもアクセス可能
}

// OK: 認証チェックあり
export async function GET() {
  const session = await auth();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ...
}
```

**判定基準**:
- 公開APIか保護APIかを判断（エンドポイント名/処理内容から推測）
- 保護が必要なAPIに認証チェックがあるか
- better-auth などのセッション取得が行われているか（例: `auth.api.getSession` など）

**報告内容**:
- API Route ファイルパス
- エンドポイント（HTTP メソッド + パス）
- 認証チェックの有無
- 保護が必要と判断される理由

### 2. 認可チェック（権限確認）

**検出対象**:
```typescript
// NG: 認証のみで認可なし
export async function DELETE(req, { params }) {
  const session = await auth();
  if (!session) return unauthorized();

  await db.post.delete({ where: { id: params.id } });  // 他人の投稿も削除可能
}

// OK: 認可チェックあり
export async function DELETE(req, { params }) {
  const session = await auth();
  if (!session) return unauthorized();

  const post = await db.post.findUnique({ where: { id: params.id } });
  if (post.authorId !== session.user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  await db.post.delete({ where: { id: params.id } });
}
```

**報告内容**:
- 認可チェックが必要と思われる操作
- 現在の実装状況
- リスクの説明（所有者チェック/RBAC/ロール確認の不足など）

### 3. 入力バリデーション

**検出対象**:
```typescript
// NG: バリデーションなし
export async function POST(req) {
  const body = await req.json();
  await db.user.create({ data: body });  // 任意のフィールドを挿入可能
}

// OK: Zodでバリデーション
import { z } from 'zod';

const createUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
});

export async function POST(req) {
  const body = await req.json();
  const validated = createUserSchema.parse(body);
  await db.user.create({ data: validated });
}
```

**報告内容**:
- POST/PUT/PATCH エンドポイント一覧
- バリデーションライブラリの使用有無
- リクエストボディの処理方法
- `Content-Type` の確認や `safeParse` のエラーハンドリング有無

### 4. CORS 設定

**検出対象**:
```typescript
// カスタムCORS設定
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',  // 危険: 全オリジン許可
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
    },
  });
}
```

**報告内容**:
- CORS 設定の有無
- 許可されているオリジン
- リスク評価
- 方式が多様なため、明示的な設定が見つからない場合は **要手動確認** とする

### 5. レート制限（Rate Limiting）

**検出対象**:
- 認証・ログイン・パスワードリセット・検索・書き込み系APIなど
- middleware やライブラリでのリクエスト制限の有無

**報告内容**:
- レート制限の有無
- 対象エンドポイント
- 欠如時のリスク（ブルートフォース/DoS）

### 6. エラーレスポンス

**検出対象**:
```typescript
// NG: 内部エラー情報を返す
catch (error) {
  return Response.json({ error: error.message, stack: error.stack });
}

// OK: 一般的なエラーメッセージ
catch (error) {
  console.error(error);  // ログは内部で
  return Response.json({ error: 'Internal server error' }, { status: 500 });
}
```

**報告内容**:
- エラーハンドリングの実装
- 内部情報漏洩のリスク

## チェック結果の記載例

```markdown
## API Routes セキュリティ

### 検出結果
- 認証不備: 2件（High）
- 認可不備: 1件（High）
- 入力バリデーション不足: 3件（Medium）
- CORS設定: 要確認
- レート制限: 1件（Medium）

### API Routes 一覧

| ファイル | メソッド | エンドポイント | 認証 | バリデーション |
|----------|----------|----------------|------|----------------|
| app/api/users/route.ts | GET | /api/users | なし | - |
| app/api/users/route.ts | POST | /api/users | あり | なし |
| app/api/posts/[id]/route.ts | DELETE | /api/posts/:id | あり | - |
| app/api/public/health/route.ts | GET | /api/public/health | なし | - |

### 認証が必要なAPI（未実装）

| エンドポイント | 理由 |
|---------------|------|
| GET /api/users | ユーザー一覧取得は認証必要 |
| PUT /api/settings | 設定変更は認証必要 |

### 認可チェック不足

| エンドポイント | 問題 |
|---------------|------|
| DELETE /api/posts/:id | 他ユーザーの投稿も削除可能 |

### 入力バリデーション不足

| エンドポイント | リクエストボディ | バリデーション |
|---------------|-----------------|----------------|
| POST /api/users | { name, email, ... } | なし |
| PUT /api/posts/:id | { title, content } | なし |
| POST /api/comments | { postId, text } | なし |

### 推奨対応

1. `/api/users` GET に認証チェックを追加
2. `/api/posts/:id` DELETE に所有者確認を追加
3. 全 POST/PUT エンドポイントに Zod バリデーションを追加
```

## 安全な API Route 実装例

```typescript
// app/api/posts/[id]/route.ts
import { auth } from '@/lib/auth';
import { z } from 'zod';

const updatePostSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
});

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  // 1. 認証チェック
  const session = await auth();
  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. 入力バリデーション
  const body = await request.json();
  const result = updatePostSchema.safeParse(body);
  if (!result.success) {
    return Response.json({ error: 'Invalid input' }, { status: 400 });
  }

  // 3. 認可チェック（所有者確認）
  const post = await db.post.findUnique({ where: { id: params.id } });
  if (!post || post.authorId !== session.user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 4. 処理実行
  const updated = await db.post.update({
    where: { id: params.id },
    data: result.data,
  });

  return Response.json(updated);
}
```
