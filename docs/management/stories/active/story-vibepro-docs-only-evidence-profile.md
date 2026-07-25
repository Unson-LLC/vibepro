---
story_id: story-vibepro-docs-only-evidence-profile
title: docs-only Storyの証跡depthを軽量プロファイルに落とし偽のbudget超過を除去する
status: active
view: dev
period: 2026-07
category: quality
source:
  type: operator_feedback
  title: "budget exceeded 19/71の大半が製品変更0行のdocs/roadmap Storyで、bundleが3,700〜5,000行に膨らみ、計測上もdiff base喪失でratioが壊れている"
related_stories:
  - story-vibepro-evidence-depth-planner
  - story-vibepro-evidence-cost-budget
  - story-vibepro-audit-bundle-budget
  - story-vibepro-canonical-audit-diff-stats
reason: "alternatives considered: exempt docs-only stories from canonical audit entirely (loses the audit trail), raise the global budget so docs stories stop exceeding (hides real regressions), or add a docs-only detection input to the existing evidence depth planner with a dedicated lightweight profile and docs-scoped budget; selected the planner input plus dedicated profile. compatibility impact: evidence depth vocabulary (summary/standard/full) and the depth planner contract are unchanged; docs-only detection is a new input, and stories may still explicitly escalate depth. rollback plan: revert the docs-only detection, the profile default, and the budget split in one commit; existing bundles remain valid. boundary and scope: depth selection, budget definition, and diff-stats base preservation only; gate semantics and review requirements for docs changes are not weakened beyond depth."
architecture_docs:
  - docs/architecture/story-vibepro-docs-only-evidence-profile.md
spec_docs:
  - docs/specs/story-vibepro-docs-only-evidence-profile.vibepro.json
created_at: 2026-07-25
updated_at: 2026-07-25
---

# docs-only Storyの証跡depthを軽量プロファイルに落とし偽のbudget超過を除去する

## Background

2026-07-01以降のcanonical audit bundle 71件のうちbudget exceededは19件で、
その大半は製品コード変更0行のdocs/roadmap Story（例: 4,996行・3,814行・3,773行のbundle）に
集中している。docs-only変更に実装Storyと同じ証跡depthを適用することが、
証跡作成トークンの最大の無駄の集中点になっている。
さらにpost-merge persist経路ではdiff baseが失われ `product_changed_lines=0` と
誤記録されるため、`artifact_code_ratio` と budget判定自体がノイズ化している。

## Measured baseline (2026-07-25)

2026-07-01以降のcanonical audit bundle 89件のうち27件が `budget_status: exceeded`。
内訳は2種類に分かれる。

1. **diff base喪失**: 超過上位5件(4,996 / 3,773 / 3,606 / 2,158 / 1,502行)は
   すべて `src=0 test=0 docs=0 other=0` かつ `merge_commit_sha == base_sha` で、
   merge後に `origin/<base>` がheadを含むため差分が空になった実装Storyだった。
   docs-only Storyではない。
2. **docs向けratioの無意味化**: 文書・roadmap Storyは製品コードが無いため、
   docs行だけを分母にした `artifact_code_ratio` で判定されていた。

両者が同じ `budget_exceeded` カウンタに混ざっており、
重い実装Storyを指すはずのシグナルが読めなくなっていた。

## Inherited behavior

When a change touches product code, evidence depth resolution, budget profile selection,
and diff-base collection before the merge lands are unchanged and existing.
When a canonical bundle carries no `budget_scope`, its place in the implementation budget
signal is unchanged and existing.
The evidence depth vocabulary (summary / standard / full) and the evidence depth planner
contract are unchanged and existing.

## User Story

**As a** roadmapやStory文書を頻繁に切るVibePro運用者
**I want** docs-only変更が自動検出されて軽量な証跡プロファイルが既定になり、diff statsのbaseが失われず記録されてほしい
**So that** 文書Storyのたびに数千行のbundleを生成せず、budget超過シグナルが本物の重い実装Storyだけを指すようになる

## Acceptance Criteria

- [ ] DOE-S-1: evidence depth解決が「製品コード（src/test）にdiffが無い変更」をdocs-onlyとして決定的に検出し、軽量depth（summary系）を既定にする。明示的なdepth昇格は引き続き可能。
- [ ] DOE-S-2: docs-only Story向けのbudget定義が実装Storyと分離され、docs-only起因の `budget_exceeded` が実装Storyのシグナルに混ざらない。
- [ ] DOE-S-3: post-merge persist経路でもdiff statsのbase/headが保存され、`product_changed_lines=0` の誤記録が新規に発生しない（docs-onlyの0行は明示的に `docs_only` として区別される）。
- [ ] DOE-S-4: 既存の `evidence-depth-planner` 契約を再実装せず、docs-only判定をその入力として追加する。

## Non Goals

- docs-only Storyのcanonical audit自体の廃止（監査痕跡は残す）。
- グローバルbudget閾値の引き上げ。
- docs変更に対するreview要件の緩和（depth以外のGate要件は変更しない）。
