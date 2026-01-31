# API Routes認証

深刻度: High
配点: 15点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| 認証チェック | 保護APIに認証チェック（auth() / getSession）がある | -6 |
| 認可チェック | リソース操作に所有者/権限確認がある | -4 |
| 入力バリデーション | POST/PUT に Zod 等のスキーマ検証がある | -3 |
| エラーレスポンス | エラーに内部情報（stack trace 等）を含まない | -2 |

## 検出パターン

```regex
# API Routes ファイル
app/api/.*route\.(ts|js)

# 認証チェックの存在
getServerSession|auth\(\)|auth\.|session|getSession|requireAuth

# 入力バリデーション
z\.object|zod|yup|joi|validate|safeParse

# 内部エラー漏洩
error\.message|error\.stack|JSON\.stringify\(error
```

## 定義

- **公開API**: ヘルスチェック、公開読み取り、Webhook受信（署名検証前提）
- **保護API**: ユーザー情報、課金、管理者操作、削除処理
- **認可**: リソースへのアクセス権限確認（所有者チェック/RBAC）
