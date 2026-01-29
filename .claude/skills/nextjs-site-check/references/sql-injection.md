# SQLインジェクションチェック

文字列連結によるSQL構築やユーザー入力の直接埋め込みを検出・報告する。

## 深刻度: Critical

## 出力先: `results/nextjs-check-sql-injection.md`

SQLインジェクションはデータベースの不正アクセス、データ漏洩、改ざん、削除を引き起こす。

## 検出パターン

```
# テンプレートリテラルでのSQL構築
`.*\$\{.*\}.*`.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER|GROUP)

# 文字列連結でのSQL構築
['"].*['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)

# 危険な sql / query 関数呼び出し
\.sql\s*\(\s*`[^`]*\$\{
\.query\s*\(\s*`[^`]*\$\{
\.execute\s*\(\s*`[^`]*\$\{
\$queryRaw|\$executeRaw|unsafe|raw
```

## リスク

- **データ漏洩**: 全ユーザーデータの取得
- **データ改ざん**: レコードの不正更新
- **データ削除**: テーブルのドロップ、レコード削除
- **認証バイパス**: ログイン認証の回避
- **権限昇格**: 管理者権限の取得

## チェック項目

### 1. 文字列連結によるSQL構築

**検出対象**:
```typescript
// NG: テンプレートリテラルで直接埋め込み
const query = `SELECT * FROM users WHERE id = ${userId}`;

// NG: 文字列連結
const query = "SELECT * FROM users WHERE name = '" + userName + "'";
```

**報告内容**:
- 検出箇所（ファイル名:行番号）
- 埋め込まれている変数名
- 変数の出所（ユーザー入力/URLパラメータ/クエリパラメータ/その他）

### 2. Supabase クエリビルダーの不適切な使用

**検出対象**:
```typescript
// NG: 文字列でフィルター条件を構築（入力未検証）
const { data } = await supabase
  .from('users')
  .select('*')
  .filter('id', 'eq', `${userInput}`);  // 危険な可能性

// NG: rpc に直接文字列を渡す
await supabase.rpc('get_user', { query: userInput });
```

**報告内容**:
- 検出箇所
- 使用されているメソッド
- 入力値の検証有無
- 入力がバリデーション済みかどうかで判定

### 3. Raw SQL の使用

**検出対象**:
```typescript
// Prisma
await prisma.$executeRaw`SELECT * FROM users WHERE id = ${userId}`;

// Drizzle
await db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);
```

**判定基準**:
- プレースホルダー（`$1`, `?` 等）を使用 → 安全
- テンプレートリテラル内でタグ付きテンプレートを正しく使用 → 安全
- 文字列連結や `${}` で直接埋め込み → 危険
- 文字列連結でプレースホルダーを組み立てている場合も危険

**報告内容**:
- 検出箇所
- パラメータ化の有無
- 安全/危険の判定

### 4. Supabase RPC 関数

**検出対象**:
```typescript
// 確認が必要: RPC関数内でのSQL処理
await supabase.rpc('search_users', { search_term: userInput });
```

**報告内容**:
- RPC 関数名
- 渡される引数
- 関数内のSQL処理確認の必要性（手動確認フラグ）
- DB側でパラメータ化しているか（要確認）

## 安全なパターン

```typescript
// OK: Supabase クエリビルダー（自動的にパラメータ化）
const { data } = await supabase
  .from('users')
  .select('*')
  .eq('id', userId);

// OK: Prisma（自動的にパラメータ化）
const user = await prisma.user.findUnique({
  where: { id: userId }
});

// OK: Drizzle（タグ付きテンプレートで安全）
const result = await db.select().from(users).where(eq(users.id, userId));

// OK: プレースホルダー使用
const query = 'SELECT * FROM users WHERE id = $1';
await client.query(query, [userId]);
```

**注意**:
- タグ付きテンプレートは安全な場合が多いが、ライブラリの仕様確認が必要

## チェック結果の記載例

```markdown
## SQLインジェクション

### 検出結果
- 文字列連結SQL: 2件（Critical）
- 不適切なクエリビルダー使用: 1件（High）
- Raw SQL: 1件（要確認）

### 文字列連結によるSQL

| ファイル | 行 | 検出内容 | 変数の出所 |
|----------|-----|----------|------------|
| lib/db.ts | 25 | `SELECT * FROM users WHERE id = ${userId}` | URLパラメータ |
| api/search.ts | 42 | "SELECT * FROM posts WHERE title LIKE '%" + term + "%'" | ユーザー入力 |

### 不適切なクエリビルダー使用

| ファイル | 行 | 問題 |
|----------|-----|------|
| services/user.ts | 18 | filter条件に未検証の入力を使用 |

### Raw SQL（確認が必要）

| ファイル | 行 | 使用方法 | 判定 |
|----------|-----|----------|------|
| lib/reports.ts | 55 | Prisma $executeRaw | 要確認 |

### 推奨対応

1. 文字列連結を Supabase クエリビルダーに置き換え
2. プレースホルダーまたはパラメータ化クエリを使用
3. ユーザー入力のバリデーションを追加
```

## 入力バリデーションの例

```typescript
import { z } from 'zod';

// ユーザーIDのバリデーション
const userIdSchema = z.string().uuid();

export async function getUser(id: string) {
  const validatedId = userIdSchema.parse(id);  // 不正な形式はエラー
  return await supabase
    .from('users')
    .select('*')
    .eq('id', validatedId)
    .single();
}
```
