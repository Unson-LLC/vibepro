# next.config設定

深刻度: Medium
配点: 30点

## チェック項目

| 項目 | 判断基準 | 減点 |
|------|----------|------|
| X-Content-Type-Options | `nosniff` が設定されている | -5 |
| X-Frame-Options | `DENY` または `SAMEORIGIN` が設定されている | -5 |
| Content-Security-Policy | 適切なポリシーが設定されている | -10 |
| images.remotePatterns | `hostname: '**'` を使用していない | -5 |
| poweredByHeader | `false` が設定されている | -2 |

## 検出パターン

```regex
# セキュリティヘッダー
headers\(\)
X-Content-Type-Options
X-Frame-Options
Content-Security-Policy

# 危険な画像設定
hostname:\s*['"][*]{1,2}['"]

# 推奨設定
poweredByHeader:\s*false
```

## 定義

- **X-Content-Type-Options**: MIME スニッフィング防止
- **X-Frame-Options**: クリックジャッキング防止
- **CSP**: XSS/インジェクション防止
- **remotePatterns**: 外部画像ソースの許可リスト
