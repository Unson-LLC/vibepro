---
story_id: story-vibepro-autonomous-action-dag
parent_design: vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-autonomous-implementation-closure-roadmap
title: Guarded Runを完全な型付き自律Action DAGへ拡張する
status: active
view: dev
period: 2026-07
category: architecture
related_stories:
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-next-best-action-controller
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-recipe-preflight-autopilot
  - story-vibepro-pr-evidence-autopilot
  - story-vibepro-managed-worktree-execution-dag
  - story-vibepro-review-finding-repair-loop
reason: "selected a closed typed DAG instead of executing generated command strings. compatibility: existing pr_prepare and pr_autopilot_safe nodes remain supported. rollback: disable the expanded DAG and use the legacy two-node plan. boundary: orchestration and transitions only; provider execution belongs to later Stories."
created_at: 2026-07-21
updated_at: 2026-07-21
---

# Guarded Runを完全な型付き自律Action DAGへ拡張する

## User Story

**As a** Guarded Run利用者
**I want** 準備からPR-readyまでの実行段階を型付きDAGとして再開可能にしたい
**So that** 任意shellや手動handoffなしで安全に次工程へ進める

## Acceptance Criteria

- [ ] AAD-S-1: `diagnose`、`prepare_artifacts`、`implement`、`verify`、`review`、`repair`、`final_prepare`が閉じたAction registryにあり、各Actionは既存owner APIを呼ぶ薄いcompositionである。
- [ ] AAD-S-2: dependency未完了、policy禁止、未知Actionは実行されない。
- [ ] AAD-S-3: Run/node/HEAD単位のidempotencyとprocess restart resumeが成立する。
- [ ] AAD-S-4: Action結果は次node、型付き停止、または`pr_ready`だけへ遷移する。
- [ ] AAD-S-5: legacy二段planとの互換・feature disable経路がある。
- [ ] AAD-S-6: 全transitionと禁止組合せのcontract testがある。
- [ ] AAD-S-7: artifact不足は既存diagnose/preflight、実装はmanaged worktree/runtime adapter、検証は`pr autopilot`、修正はappend-only Repair Loopを唯一の正本として利用する。

## Non Goals

- provider固有processの起動。
- Gate判定、Review verdict、verification結果の捏造。
- 既存のartifact validator、verification executor、worktree manager、finding modelの再実装。
