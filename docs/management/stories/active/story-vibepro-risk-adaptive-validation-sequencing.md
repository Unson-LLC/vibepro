---
story_id: story-vibepro-risk-adaptive-validation-sequencing
parent_design: vibepro-autonomy-roadmap-rebaseline
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: 高シグナル確認を先行するRisk-adaptive Validation Sequencing
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "高コストFull Suite後に境界欠陥が見つかり、修正で証跡を全て取り直す順序を改善したい"
related_stories:
  - story-vibepro-next-best-action-controller
  - story-vibepro-risk-adaptive-gate-dag
  - story-vibepro-scoped-evidence-invalidation
  - story-vibepro-evidence-summary-reuse
  - story-vibepro-agent-runtime-adapters
  - story-vibepro-agent-review-independence-provenance
reason: "alternatives considered: keep all review after full verification, make early review replace the final head-bound review, or add a non-binding preflight followed by code freeze, one reusable expensive verification, and final current-head review; selected the two-stage sequence. compatibility impact: existing verification and Agent Review gates remain mandatory and authoritative; sequencing metadata is additive. rollback plan: revert the feature merge or release commit and retain current manual ordering; no runtime disable switch exists. boundary and scope: preflight reduces late defect discovery but never satisfies the final Agent Review Gate; scoped invalidation decides what must rerun after mutation, and CI remains authoritative after PR import. accepted followups: portfolio sequencing and autonomy hardening use the resulting phase state."
created_at: 2026-07-16
updated_at: 2026-07-16
---

# 高シグナル確認を先行するRisk-adaptive Validation Sequencing

## User Story

**As a** 高コストな回帰テストと独立Reviewを必要とするVibePro利用者
**I want** 境界・仕様欠陥を安い確認で先に見つけ、コード凍結後のHEADへ高コスト検証を集約したい
**So that** 品質Gateを弱めず、Full SuiteとHEAD拘束証跡の無駄な再取得を減らせる

## Scope

- 検証phaseを`targeted_validation`、`preflight_review`、`code_frozen`、`expensive_verification`、`final_review`へ分ける。
- risk surfaceに応じた境界・仕様・security preflightを、targeted test後かつ高コスト検証前に実行する。
- preflightはnon-binding findingとして記録し、最終Agent Review Gateの代替にしない。
- code freeze後の同一HEAD/fingerprintではFull Suiteまたは同等のexpensive verificationを再利用する。
- mutation時はScoped Evidence Invalidationの判定に従って必要phaseだけを戻し、未知surfaceはfail closedにする。
- PR作成後はCI evidenceをimportし、明示的なinvalidating changeがない限りローカルFull Suiteを自動再実行しない。

## Acceptance Criteria

- [ ] RVS-S-1: high-riskまたはboundary-sensitive Storyはexpensive verification前に必要なpreflight roleと対象surfaceを計画する。
- [ ] RVS-S-2: preflight findingは`advisory_preflight`として保存され、required final Reviewのpassへ変換されない。
- [ ] RVS-S-3: targeted validationとpreflightがpassまたはdisposition済みになるまで`code_frozen`へ進まない。
- [ ] RVS-S-4: 同一code-frozen HEAD、test fingerprint、verification commandではexpensive verificationを1回だけ実行・再利用する。
- [ ] RVS-S-5: mutation後はchanged surfaceに対応するtargeted validation、preflight、expensive verification、final reviewだけを失効し、理由を記録する。
- [ ] RVS-S-6: source、test、repo-control、unknown surfaceの変更は安全側へ倒し、必要な高コスト証跡を省略しない。
- [ ] RVS-S-7: final Reviewと`pr prepare`はcurrent HEADへ拘束され、preflightや古いHEADだけでは`ready_for_pr_create=true`にならない。
- [ ] RVS-S-8: CI import後にcurrent HEADとcommand coverageが満たされる場合、ローカルFull Suite再実行ではなくimport済み証跡を使う。
- [ ] RVS-S-9: early boundary finding、repair後freeze、exact reuse、scoped invalidation、unknown fallback、CI importのE2E matrixがある。

## 依存関係・完了順

ロードマップの7番目。Meta Controller、Agent Runtime Adapter、既存Risk-adaptive Gate DAG、Scoped Evidence Invalidationを組み合わせ、Repair Loop前に高コスト検証の順序を固定する。

## Non Goals

- required test、final Agent Review、current-head bindingを省略すること。
- preflight reviewerへ実装・Gate承認・merge権限を与えること。
- 全Storyへ同じFull SuiteやReview roleを強制すること。
