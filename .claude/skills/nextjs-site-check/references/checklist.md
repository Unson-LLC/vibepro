# Next.js アプリ診断チェックリスト

対象: Next.js（App Router）+ Supabase + better-auth 構成

---

## 評価軸と配点

| 評価軸 | 対象カテゴリ | 満点 |
|--------|-------------|------|
| セキュリティ | 環境変数〜XSS（7カテゴリ） | 100点 |
| 設定品質 | npm〜next.config（3カテゴリ） | 100点 |

---

## カテゴリ別配点

### セキュリティ（100点満点）

| カテゴリ | 深刻度 | 配点 | リファレンス |
|----------|--------|------|--------------|
| 環境変数管理 | Critical | 20点 | [env-variables.md](env-variables.md) |
| Server Components秘密漏洩 | Critical | 15点 | [server-components-leak.md](server-components-leak.md) |
| Supabase RLS | Critical | 20点 | [supabase-rls.md](supabase-rls.md) |
| SQLインジェクション | Critical | 15点 | [sql-injection.md](sql-injection.md) |
| API Routes認証 | High | 15点 | [api-routes-security.md](api-routes-security.md) |
| better-auth実装 | High | 10点 | [better-auth.md](better-auth.md) |
| XSS対策 | High | 5点 | [xss.md](xss.md) |

### 設定品質（100点満点）

| カテゴリ | 深刻度 | 配点 | リファレンス |
|----------|--------|------|--------------|
| npm脆弱性 | Medium〜Critical | 40点 | [npm-vulnerabilities.md](npm-vulnerabilities.md) |
| TypeScript設定 | Medium | 30点 | [typescript-config.md](typescript-config.md) |
| next.config設定 | Medium | 30点 | [nextjs-config.md](nextjs-config.md) |

---

## 点数計算ルール

### 減点方式
- 各カテゴリは満点からスタート
- 問題検出ごとに重みに応じて減点
- 最低0点（マイナスにはならない）

### 減点の重み（各リファレンス内で定義）
- 重大な問題: 配点の50〜100%減点
- 中程度の問題: 配点の20〜50%減点
- 軽微な問題: 配点の10〜20%減点

---

## 総合判定基準

| 判定 | セキュリティ | 設定品質 | 意味 |
|------|-------------|----------|------|
| A | 90-100 | 90-100 | 商用リリース可能 |
| B | 70-89 | 70-89 | 軽微な修正で商用化可能 |
| C | 50-69 | 50-69 | 重要な修正が必要 |
| D | 0-49 | 0-49 | 根本的な見直しが必要 |

**総合判定**: 両軸の低い方の判定を採用

---

## 診断フロー

1. 各カテゴリのリファレンスを参照し検査
2. 検出された問題に応じて減点を計算
3. カテゴリ別スコアを集計
4. 評価軸ごとのスコアを算出
5. 総合判定を決定
6. 結果を `results/nextjs-site-check-result.md` に出力
