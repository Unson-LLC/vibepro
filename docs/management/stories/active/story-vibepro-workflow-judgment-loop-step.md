---
story_id: story-vibepro-workflow-judgment-loop-step
title: 同梱vibepro-workflowにDevelopment Judgmentループの手順を追加する
status: active
view: dev
period: 2026-09
artifact_profile: feature_packet
feature_slug: workflow-judgment-loop-step
---

# 同梱vibepro-workflowにDevelopment Judgmentループの手順を追加する

## 背景

`docs/architecture/vibepro-development-judgment-operating-loop.md`の受入条件 `ac:DJO-010` は、同梱`vibepro-workflow`が診断後・Story plan前に適用判断から評価までを実行し、plan後にdisposition、merge後または観測後にOutcomeを閉じる手順を持つことを求める。しかしJudgment proof ledgerのVPJ-GAP-001は、`skills/vibepro-workflow/SKILL.md`にDevelopment Judgmentの手順が一切存在しないことを指摘していた。この状態では、エージェントが正しく標準Skillへ従ってもJudgmentループは一度も発火しない。

## Story

VibeProを使う開発責任者として、同梱`vibepro-workflow` SkillがStory診断後・`vibepro story plan`前にJudgmentの適用要否記録・入力採択・評価を実行し、plan後にdisposition、merge後または観測後にOutcomeを記録する手順を明示してほしい。

それにより、DJO-010の受入条件を満たし、VPJ-GAP-001のギャップを解消する。ただしJudgmentは常にadvisoryであり、PR readiness・merge・release authorityを一切変更しない。

## Acceptance Criteria

- `skills/vibepro-workflow/SKILL.md`は、Story診断後・`vibepro story plan`前にJudgment適用要否記録(`judgment applicability record`)・準備(`judgment prepare`)・採択(`judgment input adopt`)・評価(`judgment evaluate`)を実行する手順を持つ。 <!-- ac:WJLS-001 -->
- 同Skillは`vibepro story plan`実行後にdisposition記録(`judgment disposition record`)を行う手順を持つ。 <!-- ac:WJLS-002 -->
- 同Skillはmerge後または観測後にOutcome記録(`judgment outcome record`)を行う手順を持つ。 <!-- ac:WJLS-003 -->
- 同Skillは、Judgmentループが常にadvisoryであり、PR readiness・merge・release authorityを変更しないことを明文で述べる。 <!-- ac:WJLS-004 -->
- `test/vibepro-workflow-convergence.test.js`が、新しいJudgment手順の存在と`vibepro story plan`より前に位置することを固定する。 <!-- ac:WJLS-005 -->

## Non-goals

- Judgmentの自動実行やPR readinessへの組み込み
- `judgment prepare` / `judgment evaluate`自体の実装変更
- 旧汎用Gate DAG、予算統制、review lifecycle会計の復活

## References

- Architecture: `docs/architecture/vibepro-development-judgment-operating-loop.md` (`ac:DJO-010`)
- Ledger gap: VPJ-GAP-001（`skills/vibepro-workflow/SKILL.md`にDevelopment Judgment手順が欠落）
