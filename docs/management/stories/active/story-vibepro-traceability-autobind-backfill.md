---
story_id: story-vibepro-traceability-autobind-backfill
title: "Story作成時のtraceability autobindとgap backfill分類で欠損を構造的に減らす"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-12-TRACEABILITY-BACKFILL
  title: "traceability gap 69件 (rate 0.8625) が監査可能性の最大毀損"
related_stories:
  - story-vibepro-usage-report-traceability-gaps
architecture_docs:
  - ../../../architecture/vibepro-traceability-autobind-backfill.md
spec_docs:
  - ../../../specs/vibepro-traceability-autobind-backfill.md
status: active
created_at: 2026-06-12
updated_at: 2026-06-12
---

# Story作成時のtraceability autobindとgap backfill分類で欠損を構造的に減らす

## User Story

**As a** VibeProの価値監査をする開発者
**I want to** Storyが生まれた瞬間からtraceability bindingを持ち、既存のgap storyは証拠つきで分類されてほしい
**So that** `usage report` のtraceability gapが「未調査の不明」ではなく「分類済みの事実」になり、本当に修復が必要なStoryだけが残る

## 背景

2026-06-12時点の `vibepro usage report` は 80 story 中 69 gap (rate 0.8625)。内訳は
`traceability_missing_pr_artifact` 50件、`traceability_incomplete_review_evidence` 30件、
`traceability_stale_merge_artifact` 1件。最大カテゴリの missing_pr_artifact は
「Story docはあるが `.vibepro/pr/<story-id>` が存在しない」状態で、その実態は
(a) VibePro flow外でmergeされた、(b) 未着手のbacklog、(c) 本当に証跡が欠けた、の3種が混在している。
現状はこれらを区別できず、全部が同じ重さの gap として表示される。

重要な制約: 先行story（usage-report-traceability-gaps）の非目標どおり、
**欠損artifactを自動生成して監査上の穴を「埋めたことにする」のは禁止**。
このstoryは穴を埋めるのではなく、(1) 新規Storyに binding を強制して将来のgap発生を構造的に防ぎ、
(2) 既存のgapを git 証拠つきで分類して「不明」を減らす。

## Scope

- `.vibepro/pr/<story-id>/traceability.json` を新しい lifecycle declaration artifact として定義する
- `vibepro story add` 時に traceability.json を autobind 生成する
- `vibepro pr prepare` 時に traceability.json の lifecycle を更新する
- 新コマンド `vibepro trace backfill` で、missing_pr_artifact 状態のStoryを git 証拠から分類する
- `vibepro usage report` の gap 判定を、宣言済み lifecycle を考慮する形に拡張する

## 受け入れ基準

- [ ] `vibepro story add` 実行時に `.vibepro/pr/<story-id>/traceability.json` が `lifecycle: declared_not_started`, `source: story_add` で生成される
- [ ] `vibepro pr prepare` 実行時に traceability.json が `lifecycle: in_progress`, `source: pr_prepare` へ更新される（既存fieldは保持）
- [ ] `vibepro trace backfill .` は story doc があり PR artifact がない Story を列挙し、他の git worktree に実 PR artifact があれば `lifecycle: evidence_in_other_worktree` + worktree 証拠を traceability.json に記録する
- [ ] worktree 証拠がなく git log に story-id を含む commit があれば `lifecycle: merged_without_vibepro_evidence` + commit 証拠を記録する
- [ ] 証拠がない Story は、story doc status が明示的 unstarted（backlog/draft/planned 等）の場合のみ `lifecycle: declared_not_started`、それ以外（active/null/merged 主張含む）は `lifecycle: unknown` に分類される（自動推測で「未着手」を主張しない）
- [ ] `vibepro trace declare` で操作者が `declared_not_started` / `unknown` を provenance（source: manual_declaration、reason）付きで明示宣言できる
- [ ] `trace backfill --dry-run` は分類結果を表示するが artifact を書かない
- [ ] `usage report` は traceability.json 単体を「PR artifactあり」とみなさない（skeletonだけではgapは消えない）
- [ ] `usage report` は `lifecycle: declared_not_started` の Story を `traceability_missing_pr_artifact` gap から除外し、`value_signals.declared_unstarted_story_count` で別カウントする
- [ ] `usage report` は `lifecycle: merged_without_vibepro_evidence` / `lifecycle: evidence_in_other_worktree` の Story を gap から除外する代わりに `value_signals.merged_without_vibepro_evidence_story_count` / `value_signals.evidence_in_other_worktree_story_count` と story 別フラグで signal として表示する
- [ ] `lifecycle: unknown` または traceability.json が無い Story は従来どおり gap として残る
- [ ] テストは「story add autobind」「pr prepare lifecycle更新」「backfill worktree証拠分類」「backfill git証拠分類」「active状態はunknownに留まる」「backfill dry-run」「trace declare」「skeleton単体でgapが消えない」「分類後のusage report出力」を含む

## 非目標

- pr-prepare.json / pr-merge.json / review-summary.json など実証跡 artifact の自動生成
- `traceability_incomplete_review_evidence` の自動修復（review_lifecycle_repair_loop は別story）
- GitHub API による過去PRの完全復元
- gap rate を0にすること自体を目的化すること（unknown が残るのは正しい状態）
