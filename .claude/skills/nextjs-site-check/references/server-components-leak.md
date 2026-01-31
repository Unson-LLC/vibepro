# Server Components 秘密漏洩

深刻度: Critical
配点: 15点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| props経由漏洩 | Server→Client への props に秘密情報を渡していない | -8 |
| console.log機密出力 | 本番で機密情報をログ出力していない | -4 |
| Server Actions return | 秘密情報をクライアントに返していない | -3 |

## 検出パターン

```regex
# Server → Client props（要コンテキスト確認）
<\w+Client.*\b(apiKey|secret|token|password)\s*=

# console.log 機密出力
console\.log\(.*(?:key|secret|token|password|credential)

# Server Actions return（'use server' ファイル内）
return.*(?:apiKey|secret|token|password)
Response\.json\(.*(?:apiKey|secret|token|password)
```

## 定義

- **Server Component**: `'use client'` なしのコンポーネント（App Router デフォルト）
- **Client Component**: ファイル先頭に `'use client'` を記述
- **Server Action**: `'use server'` を記述した関数
