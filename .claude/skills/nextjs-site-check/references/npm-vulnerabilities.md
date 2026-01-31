# npm脆弱性

深刻度: Medium〜Critical
配点: 40点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| critical脆弱性 | `npm audit` で critical が 0 件 | -20/件 |
| high脆弱性 | `npm audit` で high が 0 件 | -10/件 |
| moderate脆弱性 | `npm audit` で moderate が 0 件 | -3/件 |
| 本番依存の脆弱性 | dependencies 内の脆弱性は優先度高 | 上記に含む |

## 検出方法

```bash
npm audit --json
# または
pnpm audit --json
yarn audit --json
```

## 定義

- **critical**: 即時悪用可能、修正必須
- **high**: 悪用可能、修正必須
- **moderate**: 条件付き悪用、推奨
- **low**: 悪用困難、任意
- **dependencies**: 本番環境で使用
- **devDependencies**: 開発時のみ（優先度低）
