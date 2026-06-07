---
story_id: story-vibepro-usage-report
title: "VibePro usage reportで利用状況と価値発現を可視化する"
source:
  type: local-analysis
  id: VP-VALUE-005
  title: "ログgrepではVibeProの採用状況・Gate効果・bypassを継続観測しにくい"
architecture_docs:
  - docs/architecture/vibepro-usage-report.md
spec_docs:
  - docs/specs/vibepro-usage-report.md
status: active
created_at: 2026-06-02
updated_at: 2026-06-07
---

# Story: VibePro usage reportで利用状況と価値発現を可視化する

## ユーザーストーリー

- ユーザー: VibeProの導入効果を評価する開発者・プロダクトオーナー
- したいこと: VibeProがどのStory/PRで使われ、どこで止め、どこでbypassされたかをレポートで見たい
- 目的: VibeProが意図した価値を出しているか、摩擦がどこにあるかをログgrepではなく製品機能として判断できるようにする

## 背景

直近ログでは、VibeProがGate block、Agent Review、PR body生成、PR作成経路制御に使われていることは確認できた。一方で、Claude Code / Codex / `.vibepro` artifacts / raw `gh pr create` の痕跡を手で横断する必要があり、継続的な改善指標として扱いにくい。

## 受け入れ基準

- [x] `vibepro usage report <repo> [--since <date>] [--json]` を追加する
- [x] `.vibepro/pr/*/pr-prepare.json`, `pr-create.json`, `gate-dag.json`, `review-summary.json`, `executions/*/state.json` を集計する
- [x] Storyごとに `prepared`, `blocked`, `ready_for_pr_create`, `pr_created`, `waiver_required`, `raw_pr_bypass_suspected` を表示する
- [x] Gate別にblock回数、waiver回数、critical unresolved回数を表示する
- [x] Agent Review別にrequired role数、pass数、block数、timeout/replaced数、stale数を表示する
- [x] optionalでClaude Code / Codex local logsを指定した場合、raw `gh pr create` やVibePro command mentionを補助的に検出する
- [x] human-readable reportは言語設定に従う
- [x] Story別に `stale_evidence` と `story_source_mismatch` を表示する
- [x] `value_signals` として `waiver_required` / `stale_evidence` / `story_source_mismatch` の story count/rate を返す

## 実装メモ

- 対象候補: `src/cli.js`, `src/check-packs.js`, 新規 `src/usage-report.js`
- `.vibepro` artifactsを正本にし、外部ログは補助情報として扱う
- 指標は採用率を断定せず、観測できたartifactベースの値として表示する
