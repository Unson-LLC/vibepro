---
story_id: story-vibepro-guarded-run-session-contract
title: Guarded Execute Runの再開可能なセッション契約
status: active
view: dev
period: 2026-07
category: product
source:
  type: operator_feedback
  title: "StoryからPR-readyまでを一つの自律セッションとして追跡・再開したい"
related_stories:
  - story-vibepro-execution-state-control
  - story-vibepro-managed-worktree-execution-dag
  - story-vibepro-pr-evidence-autopilot
parent_design:
  - vibepro-guarded-run-session-contract
reason: "alternatives considered: keep execute next as command guidance only, overload the existing execution state without a versioned run contract, or add an additive guarded run session contract; selected the additive contract. compatibility impact: execute start/status/next/reconcile and current state artifacts remain supported, while new run fields and subcommands are additive. rollback plan: remove the new run schema and CLI surfaces while retaining the existing execution state path. boundary and scope: this Story defines lifecycle, persistence, stop reasons, and command contracts only; it does not dispatch coding agents, waive gates, create merge decisions, or replace Brainbase as the upstream source of intent. accepted followups: safe action orchestration, human decision checkpoints, runtime adapters, review repair, and hardening are separate Stories."
created_at: 2026-07-15
updated_at: 2026-07-15
---

# Guarded Execute Runの再開可能なセッション契約

## User Story

**As a** VibeProでStoryを実装可能な状態からPR-readyまで進めたい利用者
**I want** 1回の`execute run`を終了・再起動後も追跡し、停止理由を理解して再開できること
**So that** 会話文脈や次コマンドの暗記に依存せず、安全な自律実行の状態を復元できる

## Scope

- `vibepro execute run|status|watch|resume|cancel`の公開契約を追加する。
- `.vibepro/executions/<story-id>/runs/<run-id>/state.json`をRunの正本とする。
- `run_id`はVibeProだけが生成するopaque IDとし、外部入力はpathを組み立てる前に厳格検証する。
- targetは`pr_ready`だけを受け付け、既定autonomyは`guarded`とし、mergeは対象外にする。
- `running`、`waiting_for_human`、`waiting_for_runtime`、`blocked`、`failed`、`cancelled`、`pr_ready`を型付き状態として扱う。
- Run stateをStory、Managed Worktree、current HEAD、Gate DAGへ結び付ける。

## Acceptance Criteria

- [ ] GRS-S-1: `execute run`は`run_id`、`story_id`、`target`、`autonomy_mode`を持つRunを作成し、managed-worktree disabled時はsource repositoryを正本とする`repository` Runになる。
- [ ] GRS-S-2: stateには`status`、`stop_reason`、`attempt`、`iteration`、`budget`、`deadline`、`last_progress_at`、`current_head_sha`、`pending_decision`が保存される。recoverable状態への遷移は新しい型付き`stop_reason`を必須とし、nullable fieldの不正shapeは永続化前とcanonical/predecessor読込時の両方で非変更の`invalid_state`になる。
- [ ] GRS-S-3: プロセス終了後も`status`と`resume`から同じRunを復元でき、preferred bootstrapのsource fallback Runも、既存legacy stateに追加fieldを要求せず、固定fieldのcanonical fingerprintが一致する失敗bindingより自身の記録済みauthorityを優先して復元できる。
- [ ] GRS-S-4: `watch`はstate transitionを表示し、`cancel`は新しい副作用を開始せず終了状態を記録し、canonical schema `0.1.0`へのmigration完了後の再cancelはartifactをbyte-for-byte変更せず、許可/禁止transitionの全組合せが閉じたstate machineとして定義される。
- [ ] GRS-S-5: 不明な状態遷移、古いHEAD、別worktreeからの再開を拒否し、型付き停止理由を返す。
- [ ] GRS-S-6: 既存の`execute start/status/next/reconcile`と既存state artifactは互換維持される。
- [ ] GRS-S-7: schema migration、restart/resume、cancel、stale HEAD、legacy互換のテストがある。
- [ ] GRS-S-8: source/managed worktree間のartifact authority、許可されたcontrol root、authoritative execution context、全候補妥当時だけの最新Run決定順、human/JSON error contractが一意であり、棄却候補を黙殺せず明示Run選択を要求する。既存managed bindingがunavailableならsource fallback・再bootstrap・Run作成なしで`worktree_unavailable`になる。ただし同じbootstrapで作成済みの`source_fallback` Runは固定fieldのcanonical fingerprintが一致する失敗bindingより自身のauthorityを優先し、未知のauthority kindや欠落fingerprintは非変更でfail closedになる。
- [ ] GRS-S-9: path traversal、破損JSON、未知の将来schema、権限昇格、Gate回避をfail closedで拒否する。
- [ ] GRS-S-10: Run作成後のmirror同期失敗は生成済み`run_id`を返して明示repairへ誘導し、既存Run mutationのretryだけがtransition exactly-onceを保証する。Git common directoryそのものをrepository固有namespaceとして、legacy authorityの有無を問わず全linked worktree共通かつ別repositoryとは分離されたStory-scoped creation lockを導出する。`startExecution`がsource legacy stateだけcommitしてlinked-copyで失敗した場合は、そのstateをfallback authorityへ昇格せず`legacy_bootstrap_partial`でRun作成を停止し、creation lockを解放する。

## 依存関係・完了順

ロードマップの1番目。既存Execution stateとManaged Worktreeを利用し、後続Storyが共有するRun契約を先に固定する。

## Non Goals

- 実装・Reviewエージェントの起動。
- 任意shellコマンドの自動実行。
- critical gateのwaive、PR merge、Brainbaseの意図・知識管理の代替。
