---
story_id: story-vibepro-traceability-autobind-backfill
title: Traceability Autobind & Backfill Architecture
---

# アーキテクチャ

## 判断

traceability gap の最大カテゴリ（missing_pr_artifact）は「不明」の集合であり、監査価値を毀損しているのは欠損そのものより未分類であることだ。そこで欠損を埋める（=fake-value）のではなく、宣言と分類を first-class artifact にする。`traceability.json` は PR 証跡ではなく lifecycle declaration であり、usage report はこれを PR artifact として数えない。これにより skeleton 量産による metric gaming を構造的に防ぐ。

## 入力

- `.vibepro/config.json` の `brainbase.stories[]`（story add 時の autobind 起点）
- `docs/management/stories/**/*.md`（backfill 対象の列挙と status 参照）
- `.vibepro/pr/<story-id>/*`（実証跡の有無判定）
- `git worktree list --porcelain` と他 worktree の `.vibepro/pr/<story-id>/*`（evidence_in_other_worktree の証拠）
- `git log`（story-id を含む commit の検索。merged_without_vibepro_evidence の証拠）

## 出力

- `.vibepro/pr/<story-id>/traceability.json`
  - `schema_version`, `story_id`, `story_doc_path`, `source` (story_add | pr_prepare | trace_backfill | manual_declaration), `lifecycle` (declared_not_started | in_progress | evidence_in_other_worktree | merged_without_vibepro_evidence | unknown), `evidence[]` ({type, ref, summary}), `created_at`, `updated_at`
- `usage report` の `value_signals` に `declared_unstarted_story_count` / `merged_without_vibepro_evidence_story_count` / `evidence_in_other_worktree_story_count` を追加。story 別に対応フラグを追加
- `vibepro trace backfill` の分類結果（human-readable / `--json`）

## 境界

- traceability.json は lifecycle 宣言のみを持ち、Gate 判定・PR 作成可否を変更しない
- backfill は git に観測できる事実（worktree 内の実 artifact、commit 存在）と story doc の明示宣言だけを使い、推測で merged / 未着手判定をしない。判断が必要な残余は `trace declare` による操作者宣言（provenance 付き）に委ねる
- `unknown` を gap として残すのは仕様。分類できないものを消さない
- review evidence / merge artifact の修復は別 story（review_lifecycle_repair_loop）の責務
