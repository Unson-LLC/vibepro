---
decision_id: 2026-07-29-runner-direct-evidence-round-15-preflight-fix
story_id: story-vibepro-runner-direct-evidence
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-29
follows: 2026-07-29-runner-direct-evidence-round-14-final-gate
---

# Preflight-fix approval (round 15): story-vibepro-runner-direct-evidence

## What the preflight found

The `architecture_boundary` review that the validation-sequencing gate required — the first
review of this Story through that lens — found a real medium defect: the 26 runner
provenance keys land in `observation.values`, which pr-manager flattens into the gate
evidence classification corpus, and the `runtime_path_evidence` regex's `story-` alternative
matches inside the runner's own `run_artifact` path. Every runner_direct record was being
classified as runtime-path evidence regardless of what it verified — evidence inflation,
in the Story whose thesis is that evidence must not claim more than it demonstrates.
Reproduced on this repo's own four records with a confirmed counterfactual. Two lows:
recipe-preflight replays recorded values without the forbidden-key predicate, and the
Story's boundary text is narrower than the shipped diff.

## Owner's answer

Shown fix-and-finish (+4 dispatches, full re-verification cycle), defer-and-waive, or stop,
the owner chose **修正して完走 (+4枠)**. Fixing in place is the choice consistent with the
Story's own thesis; a waiver here would have shipped the defect the preflight was added to
catch.

## What is changed under this approval

Story-scoped in `.vibepro/config.json`: `max_subagent_count` 27 → 31,
`max_agent_consumption_ms` 14400000 → 16200000. Budgeted as: two gate-role re-reviews,
one architecture_boundary re-review, and one slot of headroom; re-adjudication and the
sequence chain consume no dispatches. The fix commit that follows this one is planned as
the branch's final HEAD movement.

## What this approval does not authorize

Merge, gate waivers, and any further raise remain outside it.

## Correction under the same approval (same day)

The consumption dimension measures lifecycle open-to-close intervals, not reviewer runtime.
The round-11 review lifecycles were left open for roughly 75 minutes before their delayed
close, inflating the measured spend to 20,097,814 ms against the 16,200,000 cap while the
reviewers themselves each ran six to eight minutes. The cap is corrected to 24,000,000 ms —
the measured spend plus the three approved re-reviews at real runtime with headroom — so the
enforced limit stays equal to the recorded one. The dispatch count (31) is unchanged, and no
additional review beyond the three already approved is authorized by this correction.
