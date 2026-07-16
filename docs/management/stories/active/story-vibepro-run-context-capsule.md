---
story_id: story-vibepro-run-context-capsule
title: 会話履歴に依存しないRun Context Capsule
status: active
view: dev
period: 2026-07
category: platform
parent_design: story-vibepro-run-context-capsule
source:
  type: operator_feedback
  title: "長時間Runで会話履歴と巨大artifactを再投入せず、現在状態だけから判断を再開したい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-evidence-summary-reuse
  - story-vibepro-summary-drilldown-log
  - story-vibepro-evidence-cost-budget
reason: "alternatives considered: keep relying on provider transcript compaction, persist a free-form running summary, or add a bounded typed context capsule that references authoritative artifacts; selected the typed capsule. compatibility impact: existing Run state, task handoff, and evidence artifacts remain authoritative and the capsule is an additive projection. rollback plan: stop generating the capsule and reconstruct state from existing artifacts. boundary and scope: the capsule stores decision-ready state and references only; it does not become a new Story, Spec, Gate, or evidence authority and does not persist hidden chain-of-thought or raw provider transcripts. accepted followups: next-best-action selection consumes this capsule in a separate Story."
created_at: 2026-07-16
updated_at: 2026-07-16
---

# 会話履歴に依存しないRun Context Capsule

## User Story

**As a** 長時間または再開可能なGuarded Runを使う利用者
**I want** 現在の目的、HEAD、ボトルネック、有効証跡、予算、未解決判断を小さな状態から復元したい
**So that** transcript compactionや巨大artifactの再読込を繰り返さず、判断品質を保ったままRunを継続できる

## Scope

- `.vibepro/executions/<story-id>/runs/<run-id>/context-capsule.json`をRun stateから導出する。
- objective、invariants、current HEAD、Run status、bottleneck、evidence freshness、unresolved decisions、budget、last material progress、artifact referencesを型付きで保持する。
- raw log、full diff、full artifact、provider transcriptを埋め込まず、path、digest、bounded summaryで参照する。
- Run開始、HEAD mutation、verification、review result、failure、human decision、handoff、terminal transitionでのみ再生成する。
- capsuleが古い、欠落、上限超過の場合は明示し、正本artifactから安全に再構築する。

## Acceptance Criteria

- [ ] RCC-S-1: capsuleは`story_id`、`run_id`、`head_sha`、`objective`、`invariants`、`bottleneck`、`evidence_refs`、`open_decisions`、`budget_state`、`last_progress`を持つ。
- [ ] RCC-S-2: capsuleは既定32KiB以下で、上限超過時はraw内容を切り捨てずreferenceへ退避し、`truncated_sections`を記録する。
- [ ] RCC-S-3: tool output、full JSON、diff、test log、provider transcriptの本文を永続化せず、digestとsource referenceから到達できる。
- [ ] RCC-S-4: 同じ意味イベントがない間はcapsuleを再生成せず、生成理由とsource fingerprintsを記録する。
- [ ] RCC-S-5: HEAD、Run、Storyのbindingが不一致なcapsuleはfreshとして利用されず、再構築または型付き停止になる。
- [ ] RCC-S-6: process restartまたはhandoff後、フルトランスクリプトなしで現在のblocking gateと次の判断材料を再構成できる。
- [ ] RCC-S-7: size budgetと縮約記録、stale HEAD、missing/new source、malformed JSON、atomic/mirror failure、event-driven refresh、ambiguous Run、restart recoveryのcontract testがある。

## Scenarios

- S-001: authorityへRun・verification・reviewの意味イベントが永続化された後、新しいprocessまたはmanaged-worktree handoff先が、transcript入力なしで同一HEADに束縛されたcapsuleからblocking gate、open decisions、evidence refs、budget、last progressを復元する。

## 依存関係・完了順

ロードマップの2番目。`story-vibepro-guarded-run-session-contract`のRun正本を入力とし、後続のAction OrchestratorとMeta Controllerへbounded contextを渡す。

## Tasks

- [x] boundedな型付きcapsule projectionと、binding検証を伴うrecoveryを実装する。
- [x] Guarded Run、verification、reviewの意味イベントをauthority永続化後のrefreshへ接続する。
- [x] size budget、stale binding、event idempotence、managed mirror、process restartをcontract testで固定する。

## Non Goals

- Story、Spec、Architecture、Gate evidenceの正本を置き換えること。
- hidden chain-of-thoughtやprovider transcriptを保存すること。
- capsule単独でAction実行、Gate pass、waiver、merge判断を行うこと。
