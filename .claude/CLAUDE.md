# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

VibePro は Vibe Coding で作成されたコードの商用化を支援するサービス。診断コマンド群を提供し、コードの製品レベル判定とリスク分析を行う。

## 診断コマンド

`target/` にコードを配置して実行：

| コマンド | 説明 | 出力 |
|----------|------|------|
| `/diagnose` | **一括診断（推奨）** | 下記すべてを順番に実行 |

### 事前分析（/diagnose で自動実行）

| コマンド | 説明 | 出力 |
|----------|------|------|
| `/count-lines-of-code` | コード行数カウント | `results/count-lines-of-code.md` |
| `/detect-framework` | フレームワーク検出 | `results/detect-framework.md` |
| `/scale-assessment` | 規模判定 | `results/scale-assessment.md` |

### 静的サイト診断（/diagnose で自動実行）

| コマンド | 説明 | 出力 |
|----------|------|------|
| `/static-site-check` | セキュリティ・構成チェック | `results/static-site-check-result.md` |
| `/cloudflare-pages-deploy` | デプロイ計画 | `results/deploy-plan.md` |
| `/risk-register` | リスク台帳 | `results/risk-register.md` |
| `/estimate` | 見積書 | `results/estimate.md` |
| `/diagnose-static-site` | 静的サイト一括診断 | 上記4つ + `results/summary.md` |

### Next.js アプリ診断

| コマンド | 説明 | 出力 |
|----------|------|------|
| `/nextjs-site-check` | Next.js セキュリティチェック | `results/nextjs-site-check-result.md` |

対象: Next.js（App Router）+ Supabase + better-auth 構成のアプリケーション

チェック項目（10カテゴリ）:
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

## ディレクトリ構成

- `.claude/skills/` - 診断スキル定義
- `.claude/commands/` - 追加コマンド定義
- `.claude/agents/` - エージェント定義
- `target/` - 診断対象コードの配置先
- `results/` - 診断結果の出力先
- `results_sample/` - 診断結果履歴、skill実行時は参照しない
- `docs/` - サービス設計ドキュメント

## エージェント

- **diagnose-runner** — `/diagnose` の全パイプラインを実行する統合エージェント
- **pre-analysis-runner** — 事前分析（コード行数カウント・フレームワーク検出・規模判定）を実行するエージェント。結果ファイルが既に3つとも存在する場合はスキップする

## サービス規模定義

診断結果は以下の3規模に分類される：

- **ライト**: 100ユーザー未満、社内ツール/MVP
- **スタンダード**: 100〜10,000ユーザー、B2B SaaS
- **エンタープライズ**: 10,000ユーザー以上、基幹系システム

詳細は `docs/02_service_design.md`、`docs/03_tactics.md` を参照。
