# 環境変数管理

深刻度: Critical
配点: 20点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| NEXT_PUBLIC_秘密情報 | `NEXT_PUBLIC_` に SECRET/KEY/TOKEN/PASSWORD/PRIVATE を含まない | -10 |
| .env Git管理 | `.env*` が `.gitignore` に含まれ、Git追跡されていない | -5 |
| ハードコード認証情報 | ソースに API キー/トークン/パスワードを直接記述していない | -5 |
| BETTER_AUTH_SECRET強度 | 32文字以上のランダム文字列 | -3 |

## 検出パターン

```regex
# NEXT_PUBLIC_ 秘密情報
NEXT_PUBLIC_.*(SECRET|KEY|TOKEN|PASSWORD|PRIVATE|CREDENTIAL)

# .env ファイル
\.env$|\.env\.|\.env\.local|\.env\.production

# ハードコード認証情報
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"][^'"]+['"]
sk-[a-zA-Z0-9]{20,}
(password|secret)\s*[:=]\s*['"][^'"]+['"]

# BETTER_AUTH_SECRET 弱い値
BETTER_AUTH_SECRET=.{1,31}$
```

## 定義

- **NEXT_PUBLIC_ 変数**: クライアント JS にバンドルされ公開される
- **Service Role キー**: RLS をバイパスする特権キー、絶対に公開禁止
