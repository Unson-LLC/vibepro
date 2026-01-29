---
name: nextjs-site-check
description: Next.js ウェブアプリ（App Router）の公開前セキュリティチェック。Next.js + Supabase + better-auth 構成のアプリケーションを対象とし、セキュリティ・構成・認証設定を診断。
---

# Next.js アプリ公開チェック

Next.js（App Router）ウェブアプリの公開前セキュリティチェックを実行し、結果を報告する。
**チェックのみ行い、コードの修正は行わない。**

## 対象範囲

- Next.js（App Router）アプリケーション
- 想定技術スタック: Next.js / React / TypeScript / Supabase / better-auth
- Server Components / API Routes を含むフルスタックアプリ

## チェック手順

1. [references/checklist.md](references/checklist.md) を読み込む
2. 対象コードに対して各チェック項目を確認
3. **問題検出時**: 該当するリファレンスを参照して報告内容を決定
4. 各カテゴリの結果を個別ファイルに保存
5. 全カテゴリ完了後、サマリーを `results/nextjs-site-check-result.md` に保存

## 出力ファイル一覧

各チェックカテゴリの結果を個別ファイルに保存し、最後にサマリーを出力する。

| カテゴリ | 深刻度 | 出力ファイル | リファレンス |
|----------|--------|-------------|--------------|
| 環境変数管理 | Critical | `results/nextjs-check-env-variables.md` | [references/env-variables.md](references/env-variables.md) |
| Server Components | Critical | `results/nextjs-check-server-components.md` | [references/server-components-leak.md](references/server-components-leak.md) |
| Supabase RLS | Critical | `results/nextjs-check-supabase-rls.md` | [references/supabase-rls.md](references/supabase-rls.md) |
| SQLインジェクション | Critical | `results/nextjs-check-sql-injection.md` | [references/sql-injection.md](references/sql-injection.md) |
| API Routes認証 | High | `results/nextjs-check-api-routes.md` | [references/api-routes-security.md](references/api-routes-security.md) |
| better-auth設定 | High | `results/nextjs-check-better-auth.md` | [references/better-auth.md](references/better-auth.md) |
| XSS対策 | High | `results/nextjs-check-xss.md` | [references/xss.md](references/xss.md) |
| npm脆弱性 | Medium〜Critical | `results/nextjs-check-npm.md` | [references/npm-vulnerabilities.md](references/npm-vulnerabilities.md) |
| TypeScript設定 | Medium | `results/nextjs-check-typescript.md` | [references/typescript-config.md](references/typescript-config.md) |
| next.config設定 | Medium | `results/nextjs-check-nextjs-config.md` | [references/nextjs-config.md](references/nextjs-config.md) |
| **サマリー** | - | `results/nextjs-site-check-result.md` | - |

## 個別結果ファイルの形式

各カテゴリの結果ファイルは以下の形式で保存:

```markdown
# [カテゴリ名]チェック結果

診断日時: YYYY-MM-DD HH:MM
対象: [対象ディレクトリパス]
深刻度: Critical / High / Medium

---

## 判定: OK / NG / 要確認

## チェック項目

- [x] チェック項目1（OK の場合）
- [ ] チェック項目2 → NG: 具体的な問題内容

## 検出された問題

（NG の場合のみ。リファレンスの記載例に従って記述）

| ファイル | 行 | 検出内容 | 種類 |
|----------|-----|----------|------|
| ... | ... | ... | ... |

## 推奨対応

1. ...
2. ...
```

## サマリーファイルの形式

全カテゴリの結果を集約し `results/nextjs-site-check-result.md` に保存:

```markdown
# Next.js アプリ公開チェック結果

診断日時: YYYY-MM-DD HH:MM
対象: [対象ディレクトリパス]
フレームワーク: Next.js (App Router)

---

## サマリー

| カテゴリ | 深刻度 | 結果 | 検出数 | 詳細 |
|----------|--------|------|--------|------|
| 環境変数管理 | Critical | OK/NG | 0 | [詳細](nextjs-check-env-variables.md) |
| Server Components | Critical | OK/NG | 0 | [詳細](nextjs-check-server-components.md) |
| Supabase RLS | Critical | 要確認 | - | [詳細](nextjs-check-supabase-rls.md) |
| SQLインジェクション | Critical | OK/NG | 0 | [詳細](nextjs-check-sql-injection.md) |
| API Routes認証 | High | OK/NG | 0 | [詳細](nextjs-check-api-routes.md) |
| better-auth設定 | High | OK/NG | 0 | [詳細](nextjs-check-better-auth.md) |
| XSS対策 | High | OK/NG | 0 | [詳細](nextjs-check-xss.md) |
| npm脆弱性 | Medium | OK/NG | 0 | [詳細](nextjs-check-npm.md) |
| TypeScript設定 | Medium | OK/NG | 0 | [詳細](nextjs-check-typescript.md) |
| next.config | Medium | OK/NG | 0 | [詳細](nextjs-check-nextjs-config.md) |

## 検出された問題（Critical / High のみ抜粋）

### Critical

（各カテゴリの NG 項目を抜粋）

### High

（各カテゴリの NG 項目を抜粋）

---

## 手動確認が必要な項目

- [ ] ...

---

## 総合判定

**NG** - Critical/High の問題が検出されました

または

**OK** - 重大な問題は検出されませんでした
```

## 完了時の出力

チェック完了後、以下のメッセージを表示:

```
チェックが完了しました。
個別結果: results/nextjs-check-*.md（10ファイル）
サマリー: results/nextjs-site-check-result.md
```
