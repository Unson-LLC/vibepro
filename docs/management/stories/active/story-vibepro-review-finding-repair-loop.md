---
story_id: story-vibepro-review-finding-repair-loop
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: Review findingを実装修正へ戻すBounded Repair Loop
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "needs_changesを停止報告で終わらせず、修正・再検証・再Reviewへ閉ループ化したい"
related_stories:
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-review-lifecycle-repair-loop
  - story-vibepro-content-scoped-evidence-freshness
  - story-vibepro-risk-adaptive-validation-sequencing
reason: "alternatives considered: extend lifecycle repair to rewrite verdicts, let agents interpret free-form findings without a task boundary, or create a bounded finding-to-repair-task loop; selected the bounded task loop. compatibility impact: lifecycle repair remains limited to missing, stale, timed-out, or provenance-broken reviews; real needs_changes and block verdicts remain immutable evidence and produce new repair attempts. rollback plan: stop at the verdict and expose the generated repair plan for manual execution. boundary and scope: only repairable findings are dispatched; architecture, security, scope-split, and irreducible block findings route to human checkpoints. every mutation invalidates affected evidence and requires current-head verification and independent re-review. accepted followups: configurable budgets and no-progress policy are hardened in the final roadmap Story."
created_at: 2026-07-15
updated_at: 2026-07-15
---

# Review findingを実装修正へ戻すBounded Repair Loop

## User Story

**As a** Agent Reviewで修正指摘を受けたVibePro利用者
**I want** actionable findingが修正タスクへ変換され、実装・検証・再Reviewまで戻ってほしい
**So that** `needs_changes`のたびに手動で文脈を組み直さず、品質を落とさずPR-readyへ収束できる

## Scope

- `needs_changes`と`block`のfindingを`repairable`、`human_decision`、`split_required`、`non_actionable`へ分類する。
- repairable findingを元review、対象path、Spec clause、必要testへ結び付けたTaskとして作成する。
- Agent Runtime Adapterへ修正を委譲し、変更後に影響証跡を失効・再取得する。
- 同じReview roleをfreshな独立sessionで再実行し、attempt履歴を保持する。
- 同一finding fingerprintの反復または安全上限到達で停止する。

## Acceptance Criteria

- [ ] RFR-S-1: Review verdictそのものを書き換えず、attemptごとのfindingとdispositionを履歴化する。
- [ ] RFR-S-2: repairable findingは具体的なacceptance clause、code scope、test scopeを持つTaskへ変換される。
- [ ] RFR-S-3: `block`を無条件に実装修正へ送らず、境界判断が必要ならHuman Checkpointで停止する。
- [ ] RFR-S-4: 修正後のverificationと`pr prepare`はcurrent HEADに対して再実行される。
- [ ] RFR-S-5: 再Reviewはimplementation sessionと分離され、古いreview resultをpassとして再利用しない。
- [ ] RFR-S-6: 同一findingの無進展反復または最大attemptで`no_progress`として停止する。
- [ ] RFR-S-7: one-fix convergence、multi-attempt、unrepairable block、no-progress、stale evidenceのテストがある。

## 依存関係・完了順

ロードマップの8番目。Agent Runtime AdapterとValidation Sequencingを使って実装と独立再Reviewを閉ループ化する。

## Non Goals

- Review verdictやfindingの自動削除・pass化。
- architecture/security/scope判断の自動決定。
- 無制限の再試行。
- missing、open、timeout、staleなreview lifecycleを回復する既存`review repair`の置換。
