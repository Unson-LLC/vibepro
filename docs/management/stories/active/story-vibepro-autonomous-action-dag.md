---
story_id: story-vibepro-autonomous-action-dag
parent_design: vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-one-command-pr-ready-closure
title: Guarded Runを完全な型付き自律Action DAGへ拡張する
status: completed
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
reason: "selected a closed typed DAG instead of executing generated command strings. compatibility: existing pr_prepare and pr_autopilot_safe nodes remain supported, and Portfolio coordination must tolerate a lock released between contention detection and owner inspection without weakening fail-closed handling for ambiguous locks. rollback: disable the expanded DAG and use the legacy two-node plan; the Portfolio retry is an independent code-only rollback with no state migration, restoring the prior typed stop for the released-lock race. boundary: orchestration and transitions only; provider execution belongs to later Stories."
created_at: 2026-07-21
updated_at: 2026-07-23
---

# Guarded Runを完全な型付き自律Action DAGへ拡張する

## User Story

**As a** Guarded Run利用者
**I want** 準備からPR-readyまでの実行段階を型付きDAGとして再開可能にしたい
**So that** 任意shellや手動handoffなしで安全に次工程へ進める

## Acceptance Criteria

- [x] AAD-S-1: `diagnose`、`prepare_artifacts`、`implement`、`verify`、`review`、`repair`、`final_prepare`が閉じたAction registryにあり、各Actionは既存owner APIを注入する薄いcomposition portである。
- [x] AAD-S-2: dependency未完了、policy禁止、未知Actionは実行されない。
- [x] AAD-S-3: Run/node/HEAD単位のidempotencyとprocess restart resumeが成立し、Action後にrepositoryから再取得した権威HEADだけがsuffixを再bindできる。runner申告HEADとの不一致はdependent Actionや`pr_ready`の前にfail closedする。Portfolio lockが競合検出後のowner確認前に正当に解放された場合だけ取得を一度再試行し、owner不明のlockは従来どおりfail closedする。
- [x] AAD-S-4: Action結果は次node、型付き停止、または`pr_ready`だけへ遷移する。
- [x] AAD-S-5: legacy二段planとの互換・feature disable経路があり、新規・既存Runのrequested/effective profileとfallback理由が永続化・表示される。
- [x] AAD-S-6: 全transitionと禁止組合せのcontract testがある。
- [x] AAD-S-7: composition portはowner結果のartifact参照だけをjournalへ保存し、owner未接続をsilent skipせず型付き停止する。production owner配線は後続の`story-vibepro-production-runtime-connectors`が所有する。

## Completion Evidence

- PR #372: `https://github.com/Unson-LLC/vibepro/pull/372`
- Merge commit: `df3c5dcd7cb95f99d06c299ee963fafeea2703fb`
- Production owner配線は後続のProduction Runtime Connectors（PR #377）へ分離し、本Storyでは二重実装していない。

## Non Goals

- provider固有processの起動。
- production owner adapterの配線（`story-vibepro-production-runtime-connectors`で実施）。
- Gate判定、Review verdict、verification結果の捏造。
- 既存のartifact validator、verification executor、worktree manager、finding modelの再実装。
