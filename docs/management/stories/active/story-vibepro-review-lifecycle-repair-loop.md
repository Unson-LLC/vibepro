---
story_id: story-vibepro-review-lifecycle-repair-loop
title: "incomplete review evidenceを自動で再レビュー候補化するreview repairループを作る"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-12-REVIEW-REPAIR
  title: "timed_out/stale/provenance欠損のreview artifactが30件残り、review systemのcredibilityを下げている"
related_stories:
  - story-vibepro-usage-report-traceability-gaps
  - story-vibepro-agent-review-lifecycle-control
architecture_docs:
  - ../../../architecture/vibepro-review-lifecycle-repair-loop.md
spec_docs:
  - ../../../specs/vibepro-review-lifecycle-repair-loop.md
status: active
created_at: 2026-06-12
updated_at: 2026-06-12
---

# incomplete review evidenceを自動で再レビュー候補化するreview repairループを作る

## User Story

**As a** VibePro の review credibility を維持する開発者
**I want to** missing / stale / timed_out / provenance 欠損の review role を一覧化し、修復に必要な正確なコマンド列を自動生成してほしい
**So that** 壊れた review lifecycle が「気づいた人が手で直す」ではなく、システムが提示する修復ループで回収される

## 背景

2026-06-12 監査時点で `traceability_incomplete_review_evidence` が 30 件。
review framework 自身の story（agent-review-lifecycle-control）でも gate_evidence missing /
release_risk missing / pr_split_scope stale が残っており、説得力を落としている。
usage report は欠損を検出できるが、next_command は `review status` 止まりで、
そこから修復（prepare → dispatch → record）への導線が無い。

## Scope

- 新コマンド `vibepro review repair` で review-summary.json を横断スキャンし、修復候補を列挙する
- 各候補に reason / action / 実行すべきコマンド列を付ける
- 修復計画を `.vibepro/reviews/<story-id>/<stage>/repair-plan.json` に書く
- usage report の `traceability_incomplete_review_evidence` の next_command を repair へ接続する

## 受け入れ基準

- [ ] `vibepro review repair .` は `.vibepro/reviews/*/*/review-summary.json` を走査し、required role の effective_status が missing / stale / timed_out / unverified_agent のもの、pass だが provenance_status が verified_agent でないもの、agent lifecycle が closed でないものを修復候補として列挙する
- [ ] 各候補は `{story_id, stage, role, reason, action, next_commands[]}` を持ち、next_commands には該当 stage/role の `review prepare` から `review record`（provenance + --agent-closed 付き）までの正確なコマンドが入る
- [ ] action は missing→run_review、stale→rerun_stale_review、timed_out→replace_timed_out_review、unverified_agent / provenance 欠損→rerecord_with_provenance、lifecycle 未 close→close_and_rerecord に分類される
- [ ] effective_status が pass で provenance verified_agent / closed の role は候補にならない
- [ ] `--story-id <id>` で対象 story を絞れる
- [ ] 修復計画は story/stage ごとに `.vibepro/reviews/<story-id>/<stage>/repair-plan.json` へ書かれ、`--dry-run` では書かれない
- [ ] `review repair` は review 結果そのもの（review-result / review-summary の status）を一切書き換えない
- [ ] `usage report` の `traceability_incomplete_review_evidence` gap の next_command が `vibepro review repair . --story-id <story_id>` になる
- [ ] テストは「missing role 候補化」「stale role 候補化」「pass+verified+closed の非候補化」「dry-run 非書込」「story-id フィルタ」「usage report next_command 接続」「review 結果の不変性」を含む

## 非目標

- review 結果の自動生成・自動 pass 化（修復はあくまで再レビューの dispatch 計画まで）
- repair plan からの subagent 自動起動（dispatch は coordinator runtime の責務）
- review-summary.json スキーマ自体の変更
