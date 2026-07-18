---
story_id: story-vibepro-safe-action-orchestrator
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: 既存VibePro操作を安全に進めるRun Orchestrator
status: active
view: dev
period: 2026-07
category: product
source:
  type: operator_feedback
  title: "execute nextの提案を人が順番に実行する状態から、安全操作だけ自律実行したい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-run-context-capsule
  - story-vibepro-next-best-action-controller
  - story-vibepro-pr-evidence-autopilot
  - story-vibepro-managed-worktree-execution-dag
reason: "alternatives considered: shell out to the next_commands text, duplicate each existing workflow in a new engine, or orchestrate existing in-process VibePro operations through a typed action registry; selected the typed registry. compatibility impact: existing commands remain public and authoritative, and the orchestrator consumes their contracts without changing manual behavior. rollback plan: disable the orchestrator and continue with execute next plus manual commands. boundary and scope: only allowlisted repo-local or read-only actions may run automatically; arbitrary shell, external side effects, agent dispatch, waiver, and merge remain outside this Story. accepted followups: human decision checkpoints and runtime adapters will consume the same Run state."
created_at: 2026-07-15
updated_at: 2026-07-15
---

# 既存VibePro操作を安全に進めるRun Orchestrator

## User Story

**As a** Guarded Runを開始したVibePro利用者
**I want** 安全と判定された既存操作が自動実行され、判断点かPR-readyまで進むこと
**So that** `next`が返すコマンド列を手で転記せず、同じGate semanticsのまま進行できる

## Scope

- Actionを`read_only`、`repo_local_safe`、`approval_required`、`forbidden`へ分類するregistryを持つ。
- `execute start/reconcile`、`pr prepare`、`pr autopilot`など既存APIをRun nodeとして再利用する。
- action journalに入力、結果、HEAD、artifact、idempotency keyを保存する。
- repository mutation後はcurrent HEADへ再バインドし、`pr prepare`を再実行する。
- 失敗、Gate、人間判断、runtime要求で停止し、次に必要な契約をstateへ記録する。

## Acceptance Criteria

- [ ] SAO-S-1: `execute run --until pr-ready`はallowlist済み操作を依存順に実行する。
- [ ] SAO-S-2: 任意の`next_commands`文字列をshell実行せず、型付きActionだけを実行する。
- [ ] SAO-S-3: `pr autopilot`の証跡再利用、検証失敗停止、人間判断停止をそのまま利用する。
- [ ] SAO-S-4: 同じRun/node/HEADの再実行は冪等で、完了済み副作用を重複実行しない。
- [ ] SAO-S-5: action失敗は`action_failed`として記録され、passや次nodeへ暗黙昇格しない。
- [ ] SAO-S-6: HEAD変更後の古い証跡を再利用せず、Gate評価をcurrent HEADで更新する。
- [ ] SAO-S-7: dry-run、冪等再開、検証fail、critical gate、禁止Actionのテストがある。

## 依存関係・完了順

ロードマップの3番目。`story-vibepro-guarded-run-session-contract`と`story-vibepro-run-context-capsule`完了後に実装し、後続Meta Controllerへ安全な候補Actionを渡す。

## Non Goals

- Coding/Review runtimeの起動。
- 人間の代わりに仕様、split、waiverを判断すること。
- 自動PR mergeまたは外部環境へのデプロイ。
