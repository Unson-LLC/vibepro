---
story_id: story-vibepro-owner-gated-budget-override
title: Owner-Gated Delivery Efficiency Budget Override Architecture
parent_design: vibepro-owner-gated-budget-override
---

# Architecture

## Decision

A Story-local delivery-efficiency budget override
(`budgets.delivery_efficiency_by_story.<story-id>`) is consumed at exactly one
point, `resolveEfficiencyPolicyDecision` in `src/delivery-efficiency-guardrail.js`,
and takes effect only when an accepted decision record grants it. The grant is
bound by `override_digest` (computed by `src/budget-override-authority.js` from
the override content), so approving a budget approves specific numbers; editing
a granted override changes its digest and drops it to `unauthorized`.

## Fallback semantics

An override without an effective grant is inert: the base policy applies **as
written, regardless of direction**. No floor or direction is enforced — a
tightening override also reverts to the (looser) base until its grant is
recorded. The refusal reason travels as `override` on the decision so
`review authorize` dispatch stops and `pr prepare` efficiency debt
(`budget_override_unauthorized`) can show the human why the override did not
land.

## Governed surfaces

- `src/budget-override-authority.js` — digest computation and grant resolution
- `src/delivery-efficiency-guardrail.js` — the single consumption point
- `src/decision-records.js` — budget grant fields on decision records
- `src/agent-review.js` — budget override dispatch stops
- `src/pr-manager.js` — `budget_override_unauthorized` efficiency debt
- `src/cli.js` — decision record budget flags

## Compatibility and rollback

Overrides that predate the gate inside this repository are grandfathered by
content digest and keep working exactly as merged. Rollback is a single revert
of `src/budget-override-authority.js` plus the override branch in
`resolveEfficiencyPolicyDecision`; `budget_approval` fields left on decision
records are unread by other gates.
