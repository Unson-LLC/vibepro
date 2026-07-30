---
decision_id: 2026-07-30-vacuous-e2e-test-elimination-budget-approval
story_id: story-vibepro-vacuous-e2e-test-elimination
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-30
---

# Budget override approval: story-vibepro-vacuous-e2e-test-elimination

## Why this record exists

This Story removes tests that passed regardless of what the product did. A budget raise
recorded only as the implementing agent's prose would be the same defect one level up:
a claim produced and accepted by the same party. This file records the human exchange the
override rests on, so the approval is checkable against something other than the
implementing agent's account.

## Stopping rule that fired

`vibepro review authorize` returned `review dispatch stop: budget_exceeded` for every role
at head `dcf8eb7a`. Measured against `budgets.delivery_efficiency`
(`max_subagent_count: 6`, `max_agent_consumption_ms: 1800000`):

- subagent dispatches consumed: 6 of 6, remaining 0
- subagent wall clock consumed: 1636634 ms (about 27 minutes) of 1800000
- remaining work at the time: 1 role re-review (`release_risk`, stale against the current
  head), plus 2 independent adjudication judges (`gate:evidence_adjudication`,
  `gate:judgment_dag_adjudication`)

Stopping was a live option rather than a formality. Across seven review rounds the three
roles returned `needs_changes` six times, and every one of those rounds named a defect that
was real and was fixed — including one in this Story's own evidence, where the typecheck
record listed `scripts/lint-e2e-product-execution.mjs` as a target while `npm run typecheck`
globbed only `bin/vibepro.js src/*.js` and never read it.

`vibepro adjudicate prepare` is not gated by this budget and did succeed. The agent did not
dispatch a seventh subagent through that unenforced path, because the same policy had just
refused the review dispatch. That refusal is the stopping rule; routing around it would have
made the budget advisory.

## Question put to the owner

> The subagent budget for this Story is exhausted (6 of 6; 27 of 30 minutes of agent wall
> clock). Reaching PR-ready needs about 3 more: one `release_risk` re-review plus two
> independent adjudication judges. Raising a budget is owner-only by design — how should I
> proceed?

Options offered:

1. **Raise the budget, finish the flow** — run the frontmatter fix that closes
   `gate:design_ssot_reconciliation`, re-record evidence at the new head, re-run the stale
   review roles, run both adjudication gates, then `pr prepare` → `pr create` → CI → merge.
2. **Stop here, hand over the branch** — all commits, fixes and evidence stay on the
   branch, gates remain unresolved, nothing pushed, no PR created.
3. **Spend nothing further and waive the adjudication gates** — rejected on its face: the
   gates are fail-closed by design and a self-recorded waiver is what this Story exists to
   eliminate.

## Owner's answer

Option 1: raise the budget and complete the final pass. Given in this session
(`70ea817c-ee56-48c0-ab7c-612da8629872`) through the AskUserQuestion prompt on 2026-07-30,
as a blanket approval for the closing round.

## What is changed under this approval

Scoped to this Story in `.vibepro/config.json` under
`budgets.delivery_efficiency_by_story`, leaving the repository default untouched:

| Dimension | Default | This Story |
|---|---|---|
| `max_subagent_count` | 6 | 14 |
| `max_agent_consumption_ms` | 1800000 | 5400000 |

14 covers the 6 already consumed, up to 3 stale role re-reviews, 2 independent adjudication
judges, and 3 slots of headroom for one further round should a re-review return
`needs_changes` again. The frontmatter corrections and the validation-sequencing records
themselves cost no dispatch.

## What this approval does not authorize

Any gate waiver, and any further raise. The approval covers the closing round only:
finalize the surface, re-record evidence, re-run the stale roles, adjudicate, sequence,
create the PR, and merge on green CI. If the flow does not reach `execute merge` within
these limits, the branch is handed back and the next decision belongs to the owner.
