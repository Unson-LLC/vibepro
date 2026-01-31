# SQLインジェクション

深刻度: Critical
配点: 15点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| 文字列連結SQL | テンプレートリテラル/文字列連結でSQL構築していない | -10 |
| パラメータ化クエリ | プレースホルダーまたはクエリビルダーを使用 | -5 |
| RPC引数検証 | Supabase RPC に渡す引数が検証済み（要確認） | 要確認 |

## 検出パターン

```regex
# テンプレートリテラルでのSQL構築
`.*\$\{.*\}.*`.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN|ORDER|GROUP)

# 文字列連結でのSQL構築
['"].*['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)

# 危険な raw/unsafe 呼び出し
\$queryRaw|\$executeRaw|unsafe|raw
\.sql\s*\(\s*`[^`]*\$\{
\.query\s*\(\s*`[^`]*\$\{
```

## 定義

- **パラメータ化クエリ**: `$1`, `?` 等のプレースホルダー使用
- **クエリビルダー**: Supabase `.eq()` / Prisma `findUnique()` 等
- **タグ付きテンプレート**: ライブラリが安全に処理（仕様確認必要）
