# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

VibePro は Vibe Coding で作成されたコードの商用化を支援するサービス。診断コマンド群を提供し、コードの製品レベル判定とリスク分析を行う。

## 診断コマンド

`target/` にコードを配置して実行：

| コマンド | 出力 |
|----------|------|
| `/diagnose` | 全診断実行 → `results/summary.md` |
| `/diagnose-security` | セキュリティ → `results/security.md` |
| `/diagnose-code-quality` | コード品質 → `results/code-quality.md` |
| `/diagnose-architecture` | アーキテクチャ → `results/architecture.md` |
| `/diagnose-operations` | 運用準備度 → `results/operations.md` |
| `/diagnose-scale` | 規模判定 → `results/scale.md` |

## ディレクトリ構成

- `.claude/commands/` - 診断コマンド定義（Skill）
- `target/` - 診断対象コードの配置先
- `results/` - 診断結果の出力先
- `docs/` - サービス設計ドキュメント

## サービス規模定義

診断結果は以下の3規模に分類される：

- **ライト**: 100ユーザー未満、社内ツール/MVP
- **スタンダード**: 100〜10,000ユーザー、B2B SaaS
- **エンタープライズ**: 10,000ユーザー以上、基幹系システム

詳細は `docs/02_service_design.md` を参照。
