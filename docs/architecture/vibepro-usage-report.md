---
story_id: story-vibepro-usage-report
title: VibePro Usage Report Architecture
---

# アーキテクチャ

## 判断

`vibepro usage report` は `.vibepro` 配下の既存artifactを正本として集計する。外部ログは補助シグナルとして扱い、採用率や効果を断定しない。

## 入力

- `.vibepro/pr/*/pr-prepare.json`
- `.vibepro/pr/*/pr-create.json`
- `.vibepro/pr/*/gate-dag.json`
- `.vibepro/reviews/*/*/review-summary.json`
- `.vibepro/executions/*/state.json`
- 任意の `--log` / `--codex-log` / `--claude-log`

## 出力

ReportはStory別、Gate別、Agent Review別、Value Signals別、ログ補助シグナルに分ける。Value Signalsは `.vibepro` artifact から観測できた `waiver_required`、`stale_evidence`、`story_source_mismatch` の story count/rate を返す。Human-readable出力はVibeProの言語設定に従い、JSONは同じ構造を安定して返す。

## 境界

Usage reportは監査・改善用の観測機能であり、Gate判定やPR作成可否を変更しない。ログ上の raw `gh pr create` は疑いとして表示し、実際のbypass断定はしない。
