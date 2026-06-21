---
story_id: story-vibepro-engineering-judgment-blocking-criteria
title: Engineering Judgment axisのblocking criteriaを実判定にする
view: dev
period: 2026-06
source:
  type: user_feedback
  id: VP-EJD-SENIORITY-2026-06-21-BLOCK
  title: "blocking criteriaが説明文に留まり、PRを止める判断として機能していない"
related_stories:
  - story-vibepro-senior-judgment-multi-axis-dag
  - story-vibepro-fake-value-hardening
  - story-vibepro-execution-judgment-status-integrity
architecture_docs:
  - docs/architecture/vibepro-engineering-judgment-blocking-criteria.md
spec_docs:
  - docs/specs/vibepro-engineering-judgment-blocking-criteria.md
status: active
created_at: 2026-06-21
updated_at: 2026-06-21
---

# Story

VibeProのEngineering Judgment axisは `blocking_criteria` を持っているが、
現状のstatus解決は `active_passed` / `active_accepted_followup` / `active_needs_evidence`
しか返さず、実際には `active_blocked` がほぼ発火しない。

そのため、senior engineerなら「この条件は今止める」と判断する変更でも、
VibePro上は「証拠が足りない」または「あとで追う」で流せてしまう。
これは判断の質ではなく、説明付きevidence checklistに近い。

VibeProは、missing evidence と active blocker を分ける必要がある。
単に証拠が薄いだけなのか、今の変更が安全に進められないのかを、axis単位で
機械的に分離できなければ senior judgment を再現できない。

## Acceptance Criteria

- [ ] active axisで `blocking_criteria` に該当する条件が成立した場合、
      `judgment_axes[].status` は `active_blocked` になる
- [ ] `gate:judgment_axis_*` は `axis_status=active_blocked` を `status=block` に写像し、
      `execution_gate.pr_create_allowed=false` になる
- [ ] `active_blocked` は generic test pass や broad verification が存在しても、
      blockerを打ち消す根拠が無い限り `active_passed` や `active_accepted_followup` に落ちない
- [ ] Gate DAG / PR body / review cockpit は、どの blocker が一致したか、
      どの evidence が不足または反証失敗だったかを再構成できる
- [ ] explicit waiver を許す場合でも、waiver source は blocker対象 gate に結びつき、
      follow-up と区別される
- [ ] 回帰テストは少なくとも `public_contract`, `security_boundary`, `release_ops`
      の代表ケースで `active_blocked` を検証する

## Non Goals

- すべての `active_needs_evidence` を `active_blocked` に昇格させること
- human review を必須化すること
- LLM自由文だけで blocker 一致判定を行うこと
