---
story_id: story-vibepro-evidence-cost-budget
title: "証跡の生成・読込・保存コストを予算化する"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-23-EVIDENCE-COST-BUDGET
  title: "監査証跡が本体修正より大きくなり、token/timeを継続的に消費している"
related_stories:
  - story-vibepro-canonical-audit-artifacts
  - story-vibepro-canonical-audit-bundle-self-contained
  - story-vibepro-fake-value-hardening
  - story-vibepro-engineering-judgment-activation-precision
architecture_docs:
  - docs/architecture/vibepro-evidence-cost-budget.md
spec_docs:
  - docs/specs/vibepro-evidence-cost-budget.md
created_at: 2026-06-23
updated_at: 2026-06-23
---

# Story

VibeProの価値は、テスト通過だけでなく、別engineer/agentが「なぜ安全にmergeできたか」を再構成できることである。

しかし価値監査では、近い期間の変更で `docs/management/audit-artifacts/` が本体修正より大きくなり、証跡の生成・読込・保存が継続的に主作業化している兆候が見えた。単にcanonicalへの保存をやめても、同じ巨大証跡を毎回生成し、LLMに読ませていればtoken/timeは減らない。

VibeProは、監査の厳しさを保ったまま、証跡を「最初から必要な深さだけ作る」必要がある。通常は短い判断要約と機械可読なindexを生成し、リスク・欠落・矛盾がある時だけfull evidenceへ深掘りするべきである。

## User Story

**As a** VibeProでPR readinessやmerge可否を判断するengineer  
**I want to** 証跡生成・LLM読込・canonical保存に明示的なコスト予算と深掘り条件を持たせる  
**So that** senior engineering judgmentを弱めずに、証跡作成そのものがプロダクト改善を上回る状態を防げる

## Scope

- evidence depthを `summary` / `standard` / `full` に分ける
- 低リスク・通常リスクでは、まずsummary/indexだけを生成し、full artifactは作らない
- high risk、missing evidence、unresolved reference、blocking finding、waiver、traceability gapではfullまたはtargeted evidenceへ昇格する
- `pr prepare`、`review prepare`、`execute merge`、`usage report` が同じ巨大証跡を再生成・再読込しない
- value audit reportに、code/test/story-spec-arch/audit artifactのchanged lines、token推定、対応時間推定、比率を出す
- canonical mainには、判断再構成に必要なsummary/index/hash/referenceを基本正本として残す

## Acceptance Criteria

- [ ] VibeProはStory/PRのrisk profileから、default evidence depthを `summary` / `standard` / `full` のいずれかに決める。
- [ ] `summary` depthでは、巨大なGate DAG、review lifecycle、HTML、raw transcript、provider logを生成しない。
- [ ] `standard` depthでは、gate status、review conclusion、verification result、traceability counts、artifact digestを機械可読indexとして生成する。
- [ ] `full` depthへ昇格する条件は、high-risk surface、missing evidence、accepted waiver、unresolved reference、blocking/needs_changes finding、story-to-code/test traceability gapのいずれかとして記録される。
- [ ] full evidenceを生成した場合、VibeProは `why_full_evidence_required`、`expected_consumer`、`token_time_budget_reason` をartifactに残す。
- [ ] 同じPR内で複数gate/reviewが同じ証跡を必要とする場合、既存summary/indexを再利用し、LLMへ巨大artifactを繰り返し投入しない。
- [ ] `execute merge` はcanonical audit artifactのdiff量とartifact/code比を測り、budget超過時はfull copyではなくsummary/index/hash/referenceへ縮約する。
- [ ] `usage report` と価値監査は、まずsummary/indexを読み、赤信号があるStoryだけfull artifactを読む。
- [ ] artifactが存在しない、古い、または参照不能な場合は `pass` ではなく `missing_evidence` / `unverified` / `handoff_blocked` として扱う。
- [ ] 監査レポートは、changed lines、tokens、対応時間を `src`、`test`、story/spec/architecture docs、audit artifactsに分けて表示する。

## Non Goals

- Engineering Judgment gateを緩めること。
- テスト通過だけでPR/merge可に戻すこと。
- 証跡を完全に捨て、必要時に元資料へ到達できなくすること。
- human reviewを必須化してAI agent loopを止めること。
