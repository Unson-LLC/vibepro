---
decision_id: 2026-07-29-runner-direct-evidence-resume-budget-round-13
story_id: story-vibepro-runner-direct-evidence
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-29
supersedes: 2026-07-29-runner-direct-evidence-stop-at-round-12
---

# Resume approval (round 13): story-vibepro-runner-direct-evidence

## What this supersedes

The round-12 delivery stop handed the branch back one dispatch short of closure. The owner,
shown that stop record's Handover section — the remaining work is a documentation
correction, one two-role re-review, and a fresh-head adjudication — resumed with the
instruction **再開して**. The stop record stays in place unedited.

## What blocked at round 12, restated

Not a code defect. AC-6 (RDE-6), the Story's 互換性 section, and one Spec sentence claimed
`verify record` input handling was unchanged, while the branch deliberately narrowed it
(26 provenance keys rejected — the Story's own forgery closure). The false compatibility
sentence is what `pr prepare` publishes into the PR body and release note. The adjudicator
marked AC-6 `not_demonstrated` and `axis:public_contract` `judged_unsound`; a second item,
`axis:scope_reviewability`, was `judged_unsound` on a corrected-premise basis (the judgment
request listed 19 files against a 24-file diff).

## What is changed under this approval

Scoped to this Story in `.vibepro/config.json`:

| Dimension | Round 11 | Round 13 |
|---|---|---|
| `max_subagent_count` | 22 | 25 |
| `max_agent_consumption_ms` | 11400000 | 13200000 |

25 covers the 21 consumed plus one two-role re-review (2) and one fresh-context adjudicator
covering both gates at the corrected head (1), with one slot of headroom. The documentation
corrections themselves cost no dispatch. Re-adjudicating everything at the new head subsumes
the `scope_reviewability` premise correction: head-bound verdicts do not carry over, and the
new judgment request is generated against the real diff.

## What this approval does not authorize

Merge, any gate waiver, and any further raise remain outside it. If the corrected head does
not reach `pr create` within these limits, the branch is handed back again and the next
decision belongs to the owner.
