---
decision_id: 2026-07-29-runner-direct-evidence-stop-at-round-12
story_id: story-vibepro-runner-direct-evidence
type: delivery_stop
status: accepted
approver: sato_keigo
approved_at: 2026-07-29
follows: 2026-07-28-runner-direct-evidence-final-budget-approval-round-11
---

# Delivery stop: story-vibepro-runner-direct-evidence, round 12

## What fired

The round-11 approval was final: 22 subagent dispatches, 11,400,000 ms, no further raise, and
"if round 11 does not reach `pr create` within these limits, the branch is handed back with a
delivery-stop record." The guard measures 21 of 22 dispatches consumed. Closing the last open
finding requires editing the Story and Spec, which stales both required reviews (the Spec is
in both roles' recorded inspection surfaces) and therefore needs two dispatches. One remains.
This record is that hand-back.

## State at the stop

- Branch `claude/priceless-wilbur-a6999b`, 24 commits over `origin/main`, stopped at the
  reviewed and adjudicated head `77969764`. Nothing pushed, no PR created.
- Verification: unit 160/160, integration 3/3, e2e 6/6, typecheck — all runner-direct,
  all bound to `77969764`.
- Agent Review: both required roles (`gate_evidence`, `release_risk`) **pass** at this head —
  the first gate_evidence pass in six rounds — after the reviewer personally executed the
  class-closure oracles (full-BMP line-start sweep: zero survivors; key partition: exact).
- Adjudication (first time either gate has ever run on this Story): **AC-1..AC-5
  demonstrated, 11 of 13 judgment items sound.** The independent judge reproduced two
  recorded runs to the exact counts.

## The two verdicts that block, and what they mean

1. **AC-6 `not_demonstrated` / `axis:public_contract` `judged_unsound` (implementation).**
   The code is not the defect; the Story's claim about itself is. AC-6 and the Story's
   互換性 section state that `verify record` input handling is unchanged, but the branch
   deliberately narrowed it: 26 provenance keys are now rejected on `--observed` (this is
   the round-9/10 class closure working as designed). Spec line 23 documents the rejection;
   Spec line 36 and the Story deny it; the denial is what `pr prepare` publishes into the PR
   body and release note. The fix is a small documentation correction — state the narrowed
   contract truthfully — plus one two-role re-review and a fresh-head adjudication.
2. **`axis:scope_reviewability` `judged_unsound` (classifier premise).** The judgment request
   listed 19 changed files; the diff has 24. Correctable via `vibepro adjudicate correct`
   with a different fresh judge; no implementation change.

## What the twelve rounds bought

Every mechanism finding from six independent review rounds was closed and the closures were
verified by execution, not assertion. The final blocking defect is exactly the failure class
this Story was written to eliminate: **a self-description that says something the execution
record contradicts.** The gates caught it on the Story's own text. That is the system working.

## Handover: what remains to reach pr create

1. Correct AC-6, the 互換性 section, and Spec line 36 to state the narrowed `--observed`
   contract (one docs commit; no code change).
2. Re-record the four verifications at the new head (`verify run`, no subagent cost).
3. One combined two-role re-review, one fresh adjudication pass, and the
   `scope_reviewability` premise correction — approximately 2–3 dispatches, which requires
   a new owner-approved budget decision record, as this one authorizes none.
4. `vibepro pr prepare` → `vibepro pr create`.

## Evidence for the sibling Stories

Rounds 5, 6, 8, 9, 10 each reopened the same class at a new location before rounds 11–12
closed it. The full history is in
`.vibepro/reviews/story-vibepro-runner-direct-evidence/gate/history/` (20+ result files)
and `.vibepro/adjudication/story-vibepro-runner-direct-evidence/`. This is primary evidence
for `story-vibepro-finding-class-recurrence-breaker` (stop on Nth same-class recurrence in
code, not in agent prose) and `story-vibepro-derived-mutation-checklist` (the checks that
converged were the ones whose search space was machine-derived).
