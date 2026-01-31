# Supabase RLS

深刻度: Critical
配点: 20点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| Service Role キー露出 | `NEXT_PUBLIC_` に service_role を設定していない | -15 |
| クライアントでの不適切使用 | `'use client'` ファイルで service_role を使用していない | -10 |
| RLSポリシー確認 | 全テーブルで RLS が有効（要手動確認） | 要確認 |

## 検出パターン

```regex
# Service Role キー環境変数露出
NEXT_PUBLIC_SUPABASE.*SERVICE.*ROLE
NEXT_PUBLIC.*service_role

# クライアントでの Service Role 使用
createBrowserClient.*service_role
# 'use client' ファイル内での使用を確認

# RLS 無効化
\.rls_enabled\s*=\s*false
```

## 定義

- **anon key**: 公開可、RLS 適用下で使用
- **service_role key**: RLS バイパス、サーバーサイド専用
- **RLS**: Row Level Security、行単位のアクセス制御
