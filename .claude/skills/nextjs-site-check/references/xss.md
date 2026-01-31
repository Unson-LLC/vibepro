# XSS対策

深刻度: High
配点: 5点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| dangerouslySetInnerHTML | 未サニタイズのユーザー入力を使用していない | -3 |
| eval/new Function | 使用していない、または信頼できるソースのみ | -2 |
| href属性 | ユーザー入力URL に javascript: スキーム検証がある | -1 |

## 検出パターン

```regex
# dangerouslySetInnerHTML（サニタイズ確認必要）
dangerouslySetInnerHTML\s*=

# 危険な JavaScript 関数
eval\s*\(
new\s+Function\s*\(

# DOM 直接操作
\.innerHTML\s*=
document\.write\s*\(

# iframe srcDoc
srcDoc\s*=
```

## 定義

- **自動エスケープ**: React JSX `{変数}` は自動的に HTML エスケープ
- **サニタイズ**: DOMPurify 等で危険なタグ/属性を除去
- **javascript: スキーム**: `href="javascript:..."` による XSS 攻撃
