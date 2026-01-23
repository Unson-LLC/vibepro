# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

VibePro は Vibe Coding で作成されたコードの商用化を支援するサービス。診断コマンド群を提供し、コードの製品レベル判定とリスク分析を行う。

## 診断コマンド

`target/` にコードを配置して実行：

| コマンド | 出力 |
|----------|------|
| `/diagnose` | **一括診断（推奨）** → 下記3つを順番に実行 |
| `/static-site-check` | 静的サイト診断 → `results/static-site-check-result.md` |
| `/cloudflare-pages-deploy` | デプロイ計画 → `results/deploy-plan.md` |
| `/risk-register` | リスク台帳 → `results/risk-register.md` |

## ディレクトリ構成

- `.claude/skills/` - 診断スキル定義
- `.claude/commands/` - 追加コマンド定義
- `target/` - 診断対象コードの配置先
- `results/` - 診断結果の出力先
- `results_sample/` - 診断結果履歴、skill実行時は参照しない
- `docs/` - サービス設計ドキュメント

## サービス規模定義

診断結果は以下の3規模に分類される：

- **ライト**: 100ユーザー未満、社内ツール/MVP
- **スタンダード**: 100〜10,000ユーザー、B2B SaaS
- **エンタープライズ**: 10,000ユーザー以上、基幹系システム

詳細は `docs/02_service_design.md`、`docs/03_tactics.md` を参照。
