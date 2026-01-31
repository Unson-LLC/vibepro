# better-auth実装

深刻度: High
配点: 10点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| Cookie設定 | `secure: true`（本番）, `httpOnly: true`, `sameSite: 'lax'` | -4 |
| シークレット管理 | 環境変数から取得、32文字以上 | -3 |
| 保護ルート | dashboard/settings/admin に認証チェックまたは middleware 保護 | -3 |

## 検出パターン

```regex
# 危険な Cookie 設定
secure:\s*false
httpOnly:\s*false
sameSite:\s*['"]none['"]

# シークレット弱い/ハードコード
secret:\s*['"][^'"]{1,31}['"]

# セッション取得
auth\.api\.getSession|getSession|session\(\)|auth\(\)

# 保護すべきルート
app/(dashboard|settings|admin|billing)
```

## 定義

- **secure**: HTTPS でのみ Cookie 送信
- **httpOnly**: JavaScript から Cookie アクセス不可
- **sameSite**: CSRF 対策（lax 推奨）
