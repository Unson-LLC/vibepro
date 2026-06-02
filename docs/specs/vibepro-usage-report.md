---
story_id: story-vibepro-usage-report
title: VibePro Usage Report Spec
---

# 仕様

## 必須挙動

- `vibepro usage report [repo] [--since <date>] [--json]` を提供する。
- ReportはPR prepare/create、Gate DAG、review summary、execution stateを集計する。
- Story別に `prepared`, `blocked`, `ready_for_pr_create`, `pr_created`, `waiver_required`, `raw_pr_bypass_suspected` を返す。
- Gate別に `block_count`, `waiver_count`, `critical_unresolved_count` を返す。
- Agent Review別に `required_role_count`, `pass_count`, `block_count`, `timeout_count`, `replaced_count`, `stale_count` を返す。
- `--log`, `--codex-log`, `--claude-log` で指定されたファイルから raw `gh pr create` と `vibepro ...` command mentionを補助検出する。
- Human-readable reportは `config.json` または `--language` の言語設定に従う。

## 非目標

- 外部ログだけで採用率やbypassを断定しない。
- Usage reportはGate判定を変更しない。
