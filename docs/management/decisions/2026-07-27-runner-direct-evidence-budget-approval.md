---
decision_id: 2026-07-27-runner-direct-evidence-budget-approval
story_id: story-vibepro-runner-direct-evidence
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-27
---

# Budget override approval: story-vibepro-runner-direct-evidence

## Why this record exists

The Story it belongs to argues that a claim produced and recorded by the same agent is
self-reported regardless of how it is worded. A budget raise recorded only as agent prose
would be exactly that. This file records the human exchange the override rests on, so the
approval is checkable against something other than the implementing agent's account.

## Stopping rule that fired

`vibepro review authorize` returned `review dispatch stop: budget_exceeded` for
`story-vibepro-runner-direct-evidence`. Measured against
`budgets.delivery_efficiency` (`max_subagent_count: 6`, `max_agent_consumption_ms: 1800000`):

- subagent dispatches consumed: 5, across three independent review rounds
- subagent wall clock consumed: 2215370 ms (about 37 minutes)
- remaining work estimated at the time: 2 role re-reviews + 2 independent adjudication judges

Every one of the three completed review rounds returned `needs_changes` with defects that
were real and were fixed, so stopping was a live option rather than a formality.

## Question put to the owner

> VibePro's subagent budget for this Story is exhausted (6 max, 5 used across 3 review
> rounds). Reaching PR-ready needs ~4 more (2 re-reviews + 2 independent adjudication
> judges). Raising a budget is owner-only by design — how should I proceed?

Options offered:

1. **Raise the budget, finish the flow** — owner raises `max_subagent_count`, the agent runs
   the round-4 reviews and both adjudication gates, then `pr prepare` → `pr create`.
   Stated cost: ~30-60 min more and possibly a round 5, since each round had found real defects.
2. **Stop here, hand over the branch** — all commits, fixes and evidence stay on the branch,
   gates remain unresolved, nothing pushed, no PR created.
3. **Spend the last slot on one combined re-review** — closes at most one of the two roles;
   the gate stays blocked either way.

## Owner's answer

Option 1: **"Raise the budget, finish the flow."**

## What was changed under this approval

Scoped to this Story in `.vibepro/config.json`
`budgets.delivery_efficiency_by_story["story-vibepro-runner-direct-evidence"]`:

| Dimension | Default | This Story |
|---|---|---|
| `max_subagent_count` | 6 | 14 |
| `max_agent_consumption_ms` | 1800000 | 5400000 |

The repository-wide `budgets.delivery_efficiency` defaults are unchanged.

## Correction recorded rather than hidden

The first attempt at this raise edited the repo-wide `budgets.delivery_efficiency` block
instead of the Story-scoped override. That would have loosened the stopping rule for every
future Story and, through the base/override merge in
`src/delivery-efficiency-guardrail.js`, tripled the consumption cap for six existing
per-Story overrides that pinned only `max_subagent_count` — and it routed around the
`amendment_reason` that the Story-scoped surface is code-enforced to require. Both review
roles independently caught it. The raise now lives in the Story-scoped override with the
required `amendment_reason`, and the defaults are restored.

A second correction: the first record named `max_subagent_count` as the binding dimension.
It was not — cumulative subagent wall clock (`max_agent_consumption_ms`) was what actually
fired. Both dimensions are raised here, and both are named.
