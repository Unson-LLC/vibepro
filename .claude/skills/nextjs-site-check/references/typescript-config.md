# TypeScript設定

深刻度: Medium
配点: 30点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| strict モード | `"strict": true` が設定されている | -15 |
| noImplicitAny | strict または個別で有効 | -8 |
| strictNullChecks | strict または個別で有効 | -7 |
| noUncheckedIndexedAccess | 有効（推奨） | -3 |

## 検出パターン

```regex
# tsconfig.json 内
"strict":\s*false
"strict":\s*true
"noImplicitAny":\s*false
"strictNullChecks":\s*false
```

## 定義

- **strict**: 全ての厳密チェックを有効化
- **noImplicitAny**: 暗黙の any を禁止
- **strictNullChecks**: null/undefined を厳密にチェック
- **noUncheckedIndexedAccess**: 配列アクセスの安全性向上
