---
name: diagnose-nextjs-site
description: Next.jsアプリの一括診断。セキュリティチェック・デプロイ計画・リスク台帳・見積もり作成を順番に実行し、総合評価と商用化判定を行う。
---

# Next.js アプリ一括診断

指定したディレクトリの Next.js アプリに対して、セキュリティチェック・デプロイ計画・リスク台帳・見積もり作成を一括で実行する。

## 概要

以下の5つの診断を順番に実行し、結果をまとめる：

1. **Next.js サイトチェック** → `results/nextjs-site-check-result.md`
2. **Cloudflare Pages デプロイ計画** → `results/deploy-plan.md`
3. **リスク台帳作成** → `results/risk-register.md`
4. **見積もり作成** → `results/estimate.md`
5. **診断サマリー** → `results/summary.md`

## 対象範囲

- Next.js（App Router）アプリケーション
- 想定技術スタック: Next.js / React / TypeScript / Supabase / better-auth
- Server Components / API Routes を含むフルスタックアプリ

## 実行手順

### Step 1: Next.js サイトチェック

[../nextjs-site-check/SKILL.md](../nextjs-site-check/SKILL.md) の内容を実行：

1. `target/` ディレクトリの構成確認
2. セキュリティチェック（10カテゴリ）
   - 環境変数管理（Critical）
   - Server Components秘密漏洩（Critical）
   - Supabase RLS設定（Critical）
   - SQLインジェクション（Critical）
   - API Routes認証（High）
   - better-auth実装（High）
   - XSS対策（High）
   - npm脆弱性（Medium〜Critical）
   - TypeScript設定（Medium）
   - next.config設定（Medium）
3. スコアを算出（100点満点）
4. 結果を `results/nextjs-site-check-result.md` に出力

### Step 2: Vercel デプロイ計画

[../vercel-deploy/SKILL.md](../vercel-deploy/SKILL.md) の内容を実行：

1. フレームワーク検出（Next.js確認）
2. ビルド設定・API Routes・Server Components 確認
3. デプロイ手順の作成
4. 結果を `results/deploy-plan.md` に出力

### Step 3: リスク台帳作成

[../risk-register/SKILL.md](../risk-register/SKILL.md) の内容を実行：

1. Step 1, 2 の結果からリスクを抽出
2. 深刻度を判定（Critical/High/Medium/Low）
3. お客様向け表現に変換
4. 結果を `results/risk-register.md` に出力

### Step 4: 見積もり作成

[../estimate/SKILL.md](../estimate/SKILL.md) の内容を実行：

1. リスク台帳からリスク件数・深刻度を取得
2. 規模を判定（ライト/スタンダード/エンタープライズ）
3. 価格マトリクスに基づいて費用を算出
4. 結果を `results/estimate.md` に出力

### Step 5: 診断サマリー作成

[references/summary-template.md](references/summary-template.md) の形式で `results/summary.md` を出力：

- 総合スコア（XX/100）と判定（A/B/C/D）
- セキュリティスコア・設定品質スコア
- 検出リスク件数
- 見積もり概要
- 各診断結果へのリンク
- 推奨アクション

## チェック項目一覧

### セキュリティ（7カテゴリ）

| チェック項目 | 深刻度 | 配点 | 検出パターン |
|--------------|--------|------|--------------|
| 環境変数管理 | Critical | 20点 | `NEXT_PUBLIC_` に秘密情報、`.env` のハードコード |
| Server Components秘密漏洩 | Critical | 15点 | クライアントへのシリアライズ、`"use client"` の不適切使用 |
| Supabase RLS | Critical | 20点 | RLS未設定、`service_role` キーの露出 |
| SQLインジェクション | Critical | 15点 | 文字列連結によるクエリ構築 |
| API Routes認証 | High | 15点 | 認証チェックなしの API ルート |
| better-auth実装 | High | 10点 | セッション検証の欠如、不適切なリダイレクト |
| XSS対策 | High | 5点 | `dangerouslySetInnerHTML`、未サニタイズ入力 |

### 設定品質（3カテゴリ）

| チェック項目 | 深刻度 | 配点 | 検出パターン |
|--------------|--------|------|--------------|
| npm脆弱性 | Medium〜Critical | 40点 | `npm audit` / `pnpm audit` の結果 |
| TypeScript設定 | Medium | 30点 | `strict: false`、`any` の多用 |
| next.config設定 | Medium | 30点 | 不適切なセキュリティヘッダー設定 |

## 出力ファイル

| ファイル | 内容 |
|----------|------|
| `results/nextjs-site-check-result.md` | セキュリティチェック結果（スコア付き） |
| `results/deploy-plan.md` | Cloudflare Pages デプロイ手順 |
| `results/risk-register.md` | お客様提出用リスク台帳 |
| `results/estimate.md` | お客様提出用見積書 |
| `results/summary.md` | 診断サマリー |

## 完了時の出力

```
一括診断が完了しました。

## 総合評価: XX/100（A/B/C/D）

### 評価内訳
- セキュリティ: XX/100（A/B/C/D）
- 設定品質: XX/100（A/B/C/D）

### 商用化判定: [商用リリース可能 / 軽微な修正で商用化可能 / 重要な修正が必要 / 根本的な見直しが必要]

## 検出リスク
- Critical: X件
- High: X件
- Medium: X件
- Low: X件

## 見積もり概要
- 判定規模: [ライト / スタンダード / エンタープライズ]
- 診断費用（実施済み）: ¥XXX,XXX
- 商用化費用: ¥XXX,XXX
- 運用保守（月額）: ¥XXX,XXX

## 生成されたファイル
- results/nextjs-site-check-result.md（セキュリティチェック）
- results/deploy-plan.md（デプロイ計画）
- results/risk-register.md（リスク台帳）
- results/estimate.md（見積書）
- results/summary.md（診断サマリー）

## 次のステップ
1. 見積書（estimate.md）の内容を確認
2. リスク台帳（risk-register.md）の内容を確認
3. 対応優先度に従って問題を修正
4. デプロイ計画（deploy-plan.md）に従ってデプロイ
```
