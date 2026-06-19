---
story_id: story-vibepro-merged-artifact-reconcile-backfill
title: 既存merged artifactをreconcileして楽観statusを消す
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-19-MERGED-RECONCILE
related_stories:
  - story-vibepro-execution-judgment-status-integrity
  - story-vibepro-execution-state-control
architecture_docs:
  - docs/architecture/vibepro-merged-artifact-reconcile-backfill.md
spec_docs:
  - docs/specs/vibepro-merged-artifact-reconcile-backfill.md
---

# Story

`story-vibepro-execution-judgment-status-integrity` は、merged済みstoryで
`agent_review_recorded=pending` や `pr_created=pending` が残る問題を扱っている。

ただし2026-06-19の価値監査では、main worktree上の最新 `.vibepro` には
その修正story自体のPR/review artifactが見当たらず、旧merged storyの状態が実際に
再計算済みかどうかを監査できなかった。

VibeProは新しいstatus計算を追加するだけでなく、既存merged artifactsをreconcileし、
過去の監査surfaceでも楽観表示やpending残りが消えたことを確認できる必要がある。

## Acceptance Criteria

- `vibepro execute reconcile . --all-merged` または同等の操作で、既存merged storyの
  execution stateを再計算できる。
- `completion_status=merged` のstoryでは、`pr_created`、`agent_review_recorded`、
  `merged_or_closed` のstatusがartifact factsから一貫して再評価される。
- `review-summary.json` と `review-result-*.json` のlifecycle/provenance不整合を検出し、
  修復できるものはsynthesized lifecycleとして明示する。
- reconcile後のdiffまたはreportに、更新対象story、変更前status、変更後status、
  根拠artifactを出す。
- reconcile不能なstoryは、推測でpassにせず `needs_evidence` と根拠不足を出す。
- 代表的な旧merged artifact fixtureで、pending残りが消えるケースと、証跡不足で
  fail-closedするケースをテストする。

## Non Goals

- GitHub上の全過去PRを自動復元すること。
- 証跡が存在しないreviewをpass扱いで合成すること。
- `.vibepro` の全履歴をtrackedにすること。
