---
story_id: story-vibepro-trusted-delivery-efficiency-guardrail
parent_design:
  - vibepro-autonomy-roadmap-rebaseline
  - vibepro-trusted-delivery-efficiency-guardrail
vibepro_story_id: story-vibepro-autonomy-roadmap-rebaseline
title: Trusted PR-readyまでの総コストを制御するDelivery Efficiency Guardrail
status: active
view: dev
period: 2026-07
category: quality
architecture_docs:
  - docs/architecture/story-vibepro-trusted-delivery-efficiency-guardrail.md
spec_docs:
  - docs/specs/story-vibepro-trusted-delivery-efficiency-guardrail.vibepro.json
source:
  type: operator_feedback
  title: "個別Gateの安全性だけでなく、Story全体の時間・subagent・token・再レビューを最適化したい"
related_stories:
  - story-vibepro-agent-review-lifecycle-control
  - story-vibepro-review-dispatch-preflight-dag
  - story-vibepro-risk-adaptive-validation-sequencing
  - story-vibepro-review-finding-repair-loop
  - story-vibepro-story-run-portfolio-controller
  - story-vibepro-guarded-autonomy-hardening
reason: "alternatives considered: rely on coordinator discipline, optimize each Gate independently, wait until final Guarded Autonomy Hardening, or establish an early shared efficiency control contract; selected the shared guardrail because current PR readiness can be correct while obsolete or timed-out review work remains. compatibility impact: required tests, independent review, current-HEAD binding, critical gates, and fail-closed behavior remain unchanged; the guardrail changes dispatch timing, batching, budget stops, and efficiency reporting. rollback plan: disable efficiency enforcement and retain measurement-only output while existing Gate semantics continue unchanged. boundary and scope: optimize Trusted PR-ready delivery cost without using changed lines as a cost proxy or converting missing measurements into zero. accepted followups: provider-specific cancellation and portfolio parallel scheduling remain in their owning Stories."
created_at: 2026-07-21
updated_at: 2026-07-21
---

# Trusted PR-readyまでの総コストを制御するDelivery Efficiency Guardrail

## Context

VibeProはHEAD freshness、独立Review、Gate証跡、bounded repairを強化している。しかし各仕組みが局所的に正しくても、中間HEADへの反復Review、互換findingの逐次修正、obsolete lifecycleの放置、Full Suiteの再取得が積み重なると、Story全体では低速かつ高コストになる。

PR readinessが正しいことと、そこへ効率よく到達したことは別である。本Storyは後段のGuarded Autonomy Hardeningを待たず、Review、repair、validation、portfolioが共有する最小の効率制御契約を導入する。

## User Story

**As a** VibeProで変更をTrusted PR-readyまで運ぶ開発責任者
**I want** risk closureを維持したまま、Story単位の実作業時間、待機、subagent dispatch、token/cost、再検証を予算内に制御したい
**So that** 個々のGateを通すことではなく、プロダクト価値へ安全かつ速く到達することを最適化できる

## 全体目的

最適化対象はchanged linesやartifact数ではなく、次の成果と総コストの対比とする。

- 成果: current HEADでのTrusted PR-ready、accepted defectの修正、具体的なrisk reduction。
- コスト: `observed_work_ms`、`active_wait_ms`、`tool_wait_ms`、subagent wall-clock、並行agent consumption、review dispatch数、Full Suite回数、fresh input token、total token、利用可能な場合のcost。
- 不明値: `unknown`のまま保持し、0や無料へ変換しない。
- 制約: required Gate、critical Gate、独立Review、current-HEAD freshnessを効率化理由で弱めない。

## Scope

- Story/Run policyへ、最大時間、token/cost、subagent数、role別review dispatch数、repair batch数、expensive verification回数のbudgetを追加する。
- 実装、Spec、対象test、review surfaceがfreezeするまでfinal Reviewをdispatchしないfinalization barrierを追加する。
- 同一Story、stage、role、surface digest、HEADに対する重複Reviewをidempotentに抑止する。
- 同じ変更surfaceで両立するrepairable findingを一つのmutation batchへまとめ、batch単位でtargeted verificationと独立再Reviewを行う。
- HEAD mutationで陳腐化したrunning lifecycleをobsoleteとしてcancel/close/replacementへ誘導し、放置されたworkを効率負債として可視化する。
- budget超過、no-progress、unknown attribution、cancel未確認は型付き停止にし、successやGate passへ変換しない。
- `pr prepare`、Run status、portfolio summaryにreadinessとefficiency debtを分離表示する。
- 実行後の監査だけでなく、次のdispatch前に現在予算と期待される判断価値を評価する。

## Acceptance Criteria

- [ ] TDEG-S-1: Story/Run policyは時間、token/cost、subagent、role別Review、repair batch、expensive verificationのbudgetをmachine-readableに持ち、未指定値と未計測値を0へ変換しない。
- [ ] TDEG-S-2: dispatch前のdecisionは、閉じるrisk、期待するjudgment delta、再利用可能なevidence、残予算を記録し、単なる「roleが存在する」だけで追加Reviewを起動しない。
- [ ] TDEG-S-3: source、Spec、test、review surfaceがfreezeされていない状態ではfinal Reviewを開始せず、preflightとfinal Reviewを区別する。
- [ ] TDEG-S-4: 同一Story、stage、role、surface digest、HEADのdispatchはidempotentで、running、completed pass、未回収resultの重複起動を防ぐ。
- [ ] TDEG-S-5: 同一surfaceで両立し、同じreview roleで再確認できるrepairable findingは一つのbatchへ集約され、互いに競合するfinding、security/architecture判断、human checkpointは分離される。
- [ ] TDEG-S-6: HEAD mutationで不要になったrunning lifecycleはobsoleteとしてterminalizeまたはcancel確認され、確認不能なagentは`orphaned_agent`としてfail closedになる。
- [ ] TDEG-S-7: budget超過、no-progress、attribution unknown、orphaned agentは型付き停止となり、追加spawn、成功、waiver、Gate passへ暗黙変換されない。
- [ ] TDEG-S-8: `pr prepare`はcorrectness readinessとefficiency debtを分離し、required Gateが満たされてもtimed-out、obsolete、orphan、重複dispatch、予算超過を見えなくしない。
- [ ] TDEG-S-9: Story単位でTrusted PR-ready elapsed、observed work、wait、subagent wall-clock、agent consumption、dispatch数、accepted finding数、Full Suite回数、evidence reuse/失効、fresh/total token、cost/unknownを自動集計する。
- [ ] TDEG-S-10: before/after比較は同等risk classとGate要求を持つdogfood Storyで行い、changed-line比を時間・token配賦や価値判定に使わない。比較可能なpre-change値がない初回は`before=unknown`を保持してbaseline確立とし、数値改善を主張しない。次の同等risk Storyから比較を開始する。
- [ ] TDEG-S-11: repeated same-role Review、互換finding batch、HEAD mutation中のrunning reviewer、timeout/orphan、budget stop、parallel review、unknown metricを含むE2E matrixがある。
- [ ] TDEG-S-12: required test、independent final Review、critical Gate、current-HEAD binding、fail-closed semanticsの既存contract testが全て維持される。

## Performance Evidence Contract

実装開始前にdurationを持つ先頭3指標を`vibepro performance define`で登録し、同等risk classのdogfood Storyについてbefore/afterを記録する。後続3指標はRun/usage集計のcounterまたはratioとして保持し、durationへ偽装しない。

本Storyには同等risk・同一Gate構成のpre-change実測が存在しないため、`before=unknown`、`after=needs_review`を正直に保持する。この組は改善率の算出には使わず、現行実装で最初の比較baselineを確立した証跡として扱う。次のworkflow-heavy dogfood Storyで同一指標・同一境界を再測定して初めてbefore/after判断を行う。

- `trusted_pr_ready_elapsed_ms`: Run開始からcurrent-HEADのTrusted PR-readyまでのwall-clock。
- `observed_work_ms`: session eventから観測できる関連active burstとtool waitの合計。
- `review_dispatch_count`: Story内で実際に開始したReview lifecycle数。
- `review_wait_ms`: Review lifecycleのunion wall-clock。並行agent consumptionとは分離する。
- `expensive_verification_count`: Full Suiteまたは同等の高コスト検証回数。
- `tokens_per_accepted_finding`: accepted/resolved findingに対するfresh inputとtotal token。findingが0件の場合は0除算せずN/Aにする。

## 依存関係・ロードマップ位置

本StoryはGuarded Autonomy HardeningのGAH-S-1、GAH-S-8、GAH-S-9、GAH-S-10から、後続機構が共通利用する最小制御を前倒しする。Risk-adaptive Validation Sequencing、Review Finding Repair Loop、Story Run Portfolio Controllerの前提契約とし、各Story固有の責務は移動しない。

推奨順序は次とする。

1. Agent Runtime Adapter
2. Trusted Delivery Efficiency Guardrail
3. Risk-adaptive Validation Sequencing
4. Review Finding Repair Loop
5. Story Run Portfolio Controller
6. Guarded Autonomy HardeningのE2E統合

## Non Goals

- required Gate、test、独立Reviewを省略するfast laneを一律導入すること。
- changed lines、artifact数、単純なsession spanを生産性の主指標にすること。
- VibePro CLI自身がCodex / Claude Code subagent runnerになること。
- provider固有のcancel API、portfolioの一般的な優先順位付け、PR mergeを本Storyで実装すること。
- 小さな変更へ一律の「10分以内」SLAを課し、riskや外部waitを無視すること。
