---
story_id: story-vibepro-guarded-autonomy-hardening
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: PR-ready自律走行を安全に運用するGuarded Autonomy Hardening
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "自律ループを無限実行や自己Reviewにせず、費用・時間・停止理由まで運用可能にしたい"
related_stories:
  - story-vibepro-guarded-run-session-contract
  - story-vibepro-safe-action-orchestrator
  - story-vibepro-human-decision-checkpoint
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-review-finding-repair-loop
  - story-vibepro-run-context-capsule
  - story-vibepro-next-best-action-controller
  - story-vibepro-risk-adaptive-validation-sequencing
  - story-vibepro-story-run-portfolio-controller
  - story-vibepro-agent-review-independence-provenance
  - story-vibepro-content-scoped-evidence-freshness
  - story-vibepro-pr-body-published-evidence-integrity
  - story-vibepro-human-review-override
reason: "alternatives considered: ship the loop with fixed hidden limits, rely on provider defaults, or expose auditable guarded-autonomy policy and outcome metrics; selected explicit policy and metrics. compatibility impact: manual workflows and lower autonomy modes remain available; guarded mode adds stricter reviewer independence and bounded execution without changing critical-gate semantics. rollback plan: disable guarded auto-advance and fall back to resumable manual Run operation. boundary and scope: default completion is pr_ready, never merge; critical gates cannot be auto-waived; budgets constrain execution but never convert incomplete work into success. this Story closes the roadmap only when the full end-to-end acceptance matrix passes. accepted followups: provider-specific optimizations may be separate but are not required for roadmap completion."
created_at: 2026-07-15
updated_at: 2026-07-15
---

# PR-ready自律走行を安全に運用するGuarded Autonomy Hardening

## User Story

**As a** VibeProの自律Runを日常運用する責任者
**I want** 費用、時間、反復、Reviewer独立性、停止理由をpolicyとして制御・監査したい
**So that** 自律性を高めても、暴走、自己承認、証跡劣化、予算超過を起こさず運用できる

## Scope

- max duration、cost/token budget、max attempts、retry/backoff、provider fallback、no-progressをRun policyへ追加する。
- guarded modeではrequired Reviewのseparate-session identityをGate条件にする。
- Run outcome、停止理由、再開回数、agent時間、human wait時間、修正収束率、PR-ready到達率を集計する。
- Trusted PR-ready到達時間、active/wait比率、token/cost、human interruption、Full Suite再実行、evidence reuse/失効、accepted findingあたりのcostを主要効率指標として集計する。
- crash/restart、runtime quota、CI pending、review timeout、base/head driftの回復経路をE2Eで固定する。
- 最終UXを`execute run --until pr-ready --autonomy guarded`へ統合し、mergeは明示操作のまま残す。

## Acceptance Criteria

- [ ] GAH-S-1: budget、deadline、max attempts到達時は型付き停止となり、成功やGate passへ変換されない。
- [ ] GAH-S-2: retry対象と非対象がpolicyで分離され、backoff中断・再開が監査できる。
- [ ] GAH-S-3: guarded modeではsame-session/unknown Reviewがrequired Gateを満たさない。
- [ ] GAH-S-4: critical gate、waiver、external side effect、mergeは自動承認されない。
- [ ] GAH-S-5: Storyから`pr_ready`または型付き停止理由までを1コマンドで進め、process restart後も同じRunを再開できる。
- [ ] GAH-S-6: mutationごとにcurrent HEADへ証跡を再バインドし、最終`pr prepare`が`ready_for_pr_create=true`を確認する。
- [ ] GAH-S-7: success、human decision、repair convergence、no-progress、quota、timeout、CI pending、critical gate、cancelのE2E matrixがある。
- [ ] GAH-S-8: operator向けstatus/cockpitに自動化されたstep、人間判断、費用、経過時間、停止理由、次の安全な操作を表示する。
- [ ] GAH-S-9: status/cockpitは次Actionの選択理由、active timeとwait time、token/costのunknown、Full Suite回数、evidence reuse/失効、human interruptionをStory別に表示する。
- [ ] GAH-S-10: 効率評価はtoken最小やartifact数ではなく、Trusted PR-ready到達、accepted defect修正、risk reductionを総コストと対比し、未収集値を0へ変換しない。

## 依存関係・ロードマップ完了条件

ロードマップの10番目かつ完了Story。先行9 Storyが完了し、GAH-S-5からGAH-S-10のE2E、運用可視化、Trusted Delivery Efficiency計測が成立した時点で、推奨ロードマップを完了とする。

## Non Goals

- PRの自動merge、production deploy、critical gateの自動waive。
- 予算切れやtimeoutを「対象なし」「成功」として扱うこと。
- Brainbaseの上流意図・文脈・知識管理をVibeProへ移すこと。
- 既存のbudget、cost accounting、review provenance、content freshness、published evidence contractを再実装すること。
