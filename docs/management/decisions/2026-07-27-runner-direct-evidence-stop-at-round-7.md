---
decision_id: 2026-07-27-runner-direct-evidence-stop-at-round-7
story_id: story-vibepro-runner-direct-evidence
type: delivery_stop
status: accepted
approver: sato_keigo
approved_at: 2026-07-27
---

# Delivery stop: story-vibepro-runner-direct-evidence

## What fired

`vibepro review authorize` reported `budget_exceeded` for the second time. Measured against
the Story-scoped override (`max_subagent_count: 14`, `max_agent_consumption_ms: 5400000`):

- subagent dispatches consumed: 11 of 14
- subagent wall clock consumed: 5,642,943 ms of 5,400,000 ms — **exceeded**

Remaining to reach PR-ready: two role re-reviews of the round-7 fixes, and the two
adjudication gates (`gate:evidence_adjudication`, `gate:judgment_dag_adjudication`), which
no round has run.

## Owner's decision

Stop and hand over the branch. Nothing pushed, no PR created, gates left unresolved.

## State at the stop

- 15 commits on `claude/priceless-wilbur-a6999b`, base `origin/main`, HEAD `815622ce`.
- Four runner-direct verification records at that head: unit 136/136, integration 3/3,
  e2e 6/6, typecheck pass.
- Six independent review rounds recorded under
  `.vibepro/reviews/story-vibepro-runner-direct-evidence/gate/history/` (11 result files).
  Every round returned `needs_changes` except round 5 `release_risk`, which passed.

## What is verified and what is not

**Verified by an independent reviewer:** the central mechanism. Round 6 `gate_evidence`
re-ran the shadowing attack across 44 `--observed` keys against both a clean and a
mid-run-mutating tree and could not reproduce it or find a variant; it also confirmed the
worktree verdict is recomputable from the recorded component hashes. Round 5 `release_risk`
passed on rollout, rollback and operator surfaces.

**Not verified:** the round-7 commit (`815622ce`), which replaced a vacuous restore test
with one that genuinely fails against the pre-fix wiring, made the restore all-or-nothing,
encoded the round-5 attack as a regression test, and made the warning facts required. Those
changes are tested locally and recorded, but no independent reviewer has judged them.

**Never run:** both adjudication gates. Nothing has independently judged whether the
recorded evidence demonstrates each acceptance criterion, or whether the judgment-DAG items
hold against the diff.

## Why the rounds are worth reading

Each round found something real, and the record of what they found is the most useful
output of this branch:

| Round | Role | Found |
|---|---|---|
| 1 | gate_evidence | `pr autopilot` computes its own outcome but recorded `self_reported`; stdout hash and retained log covered different bytes; no signal for a green run that checked nothing |
| 2 | gate_evidence | The round-1 fixes added four computed keys outside the protected set, so the new integrity anchors were agent-writable |
| 3 | gate_evidence, release_risk | The pre-execution check granted an allowance the record path could never honor, so it clobbered the previous run's artifact; the published release note described the change as a Story doc update |
| 4 | gate_evidence, release_risk | The budget raise edited the repo-wide default instead of the Story-scoped override; strict-head evidence went stale when those commits moved HEAD |
| 5 | gate_evidence | Reproduced an agent value shadowing `tree_mutated_during_run`: instances were closed, the class was not |
| 6 | gate_evidence, release_risk | The restore test never reached the window it claimed and passed identically on pre-fix code |

Five of those six are defects the implementing agent introduced while fixing the previous
round's finding. That is the pattern this Story's parent predicts, and it is the reason the
branch is being handed over rather than self-certified.
