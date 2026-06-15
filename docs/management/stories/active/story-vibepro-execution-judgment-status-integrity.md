---
story_id: story-vibepro-execution-judgment-status-integrity
title: Execution stateとjudgment axisのstatusを過大表示しない
status: active
architecture_reason: 既存のexecution/review/judgment artifactの再計算条件とstatus判定を揃える変更であり、新しい境界・外部依存・永続化モデルは導入しない
source:
  type: value_audit_followup
  id: execution-judgment-status-integrity
architecture_docs:
  - docs/architecture/vibepro-execution-judgment-status-integrity.md
spec_docs:
  - docs/specs/vibepro-execution-judgment-status-integrity.md
---

# Story

VibeProの監査で、merged済みのStoryでも `.vibepro/executions/<story-id>/state.json` の
`execution_dag` に `agent_review_recorded=pending` や `pr_created=pending` が残り、
review summaryのlifecycleも `agent_provenance` と食い違うケースが見つかった。

同時に、Senior first scanの `judgment_axes[]` は `missing_evidence` を持ちながら
`active_passed` になれるため、「何が足りないと止まるか」を過小表示していた。

VibeProは、artifactを読む人間や次のagentに対して、statusを楽観表示してはいけない。
execution/review/judgment の各surfaceで、同じ事実から同じ状態が再構成できる必要がある。

## Acceptance Criteria

- `vibepro execute status/next/reconcile` が merge 済み artifact を読むと、
  `execution_dag` の `agent_review_recorded` と `pr_created` は `pending` のまま残らない。
- execution state は `review-summary.json` と `pr-create.json` / `pr-merge.json` を読んで、
  merge 後の phase/completion/node status を一貫して再計算する。
- `review record --agent-closed` 時、明示 lifecycle entry が無くても
  `review-summary.json` に agent_provenance と整合する closed lifecycle を反映できる。
- `review-summary.json` の lifecycle は、result artifact 側の `agent_provenance.lifecycle`
  と矛盾しない。
- `judgment_axes[]` は `missing_evidence` が1件でも残る限り `active_passed` にならない。
- `judgment_axes[]` の `active_accepted_followup` は、accepted decision/waiver 等により
  「現時点で安全に defer できる」根拠がある場合だけに限定される。
- judgment axis gate / PR body / Gate DAG summary でも、上記の厳格化後 status が同じ意味で表示される。

## Non Goals

- human-review を必須 gate にすること。
- Graphify を必須依存にすること。
- すべての judgment axis を今回 `active_blocked` まで厳格化すること。
