# P4 freeze handoff — story-vibepro-vacuous-e2e-test-elimination

- date: 2026-08-01
- head at freeze: `2f200bf2` (branch `claude/vacuous-e2e-deletions`, worktree `.worktrees/p4-vacuous-e2e`)
- state at freeze: **not pushed, no PR, nothing merged.** Working tree clean.
- frozen by: owner sato_keigo, 2026-08-01, declining budget for one confirming review
  (understood at the time that without it a PR cannot be created, i.e. this is a freeze)

> This document is written to be actionable by someone with no memory of the session.
> Sections 1-7 below describe the state **as of the freeze at `2f200bf2`** and are preserved
> unedited as the record of that state. Section 8 records the unfreeze and what changed after it.
> Where the two disagree, section 8 is current.

## 0. Status: unfrozen, resumed 2026-08-01

The freeze was lifted by the same owner on 2026-08-01 (see §8). The head has moved past
`2f200bf2`, so the head-bound adjudication and reviews described in §2 were necessarily
re-run rather than reused. Read §8 before acting on §5.

---

## 1. What the change does

Deletes 17 self-contained "vacuous" test files under `test/e2e` (files that asserted string
literals against regexes without importing or executing any product code), rewrites two of
them into real behaviour tests, and adds `scripts/lint-e2e-product-execution.mjs` plus a CI
step and a widened typecheck glob so the pattern cannot return.

**The branch changes no product code.** `git diff --name-only $(git merge-base origin/main HEAD)..HEAD -- src/ bin/`
returns EMPTY. Every `src/` change visible in the history range comes from upstream commit
`31d84833` (PR #405), and `git merge-base --is-ancestor 31d84833 origin/main` is TRUE.

## 2. Where it got to

**Adjudication — complete and green, persisted at `2f200bf2`.**
- 6/6 acceptance clauses `demonstrated`
- 14/14 judgment items `judged_sound`

Both were re-derived by direct execution at HEAD rather than read off the records
(lint over 66 files, 28 `.spec.ts` counted, typecheck exit 0, and the small suites carrying
AC-1/AC-3/AC-4/AC-5/AC-6 each run individually).

**Reviews — 2 of 3 pass.**

| role | verdict | note |
|---|---|---|
| `release_risk` | **pass** | 3 low findings, non-blocking |
| `pr_split_scope` | **pass** | 2 low findings, non-blocking |
| `gate_evidence` | **needs_changes** (round 3) | content fully verified clean; blocked only on a disclosure gap that has since been closed — **never re-confirmed** |

**Evidence** (unchanged, no suite re-run this round):

| lane | result | bound to |
|---|---|---|
| unit | 2294/2294 | `3be3ed55` |
| e2e | 91/91 | `3be3ed55` |
| integration | 561/561 | `06450d62` |
| typecheck | exit 0 | `06450d62` |

The head-binding gap is covered by owner waiver `decision-1785500262312-98410924`, whose
argument was independently verified by two reviewers and one adjudicator.

## 3. Gates closed

- `gate:review_surface_integrity` — 3/3 violations acknowledged
- `gate:common_judgment_spine`
- `gate:responsibility_authority`
- `gate:path_surface_matrix` — not-applicable; the flagged `persistence` row was a false
  positive raised by the **deletion** of a vacuous spec whose filename contains "migration"
- `gate:evidence_adjudication` — 6/6 demonstrated
- `gate:judgment_dag_adjudication` — 14/14 sound
- `gate:judgment_axis_rollback_sensitive`, `_data_state`, `_scope_reviewability`
- `gate:judgment_agent_workflow_evidence_lifecycle`
- `gate:judgment_axis_release_ops` — closed by owner waiver (see §6)

## 4. The one remaining blocker

Everything still unresolved chains to a **single missing confirmation**: `gate_evidence`'s
round-3 `needs_changes` was never re-reviewed.

```
gate:gate_evidence (needs_changes)
  └─ review:preflight:gate:gate_evidence  failed  (gate_evidence:recorded_blocker)
      └─ review:dispatch_batch:gate       failed
          └─ review:join:gate             needs_review
              └─ gate:agent_review        needs_review
                  ├─ gate:definition_of_done    needs_evidence
                  ├─ gate:artifact_consistency  stale_evidence (1 artifact = this review)
                  └─ gate:senior_gap_judgment   block (2 critical gaps)
```

Also open, independent of the above and unassessed this round:
- `gate:design_ssot_reconciliation` — 2 design lineage action items need review
- `gate:traceability_clause_coverage` — 5 weakly-mapped clauses (clause binding needs
  current-head-bound evidence; the AC targets sit on lanes bound to earlier heads)

**Round-3 `gate_evidence` blocked purely on disclosure, not content.** It verified all 26
kept observation claims as substantively true, both withdrawals as genuine, and both
head-binding claims as TRUE at command level. Its two medium findings were (a) the round-3
sweep had no durable disclosure record and (b) `updated_at` was not bumped. **(a) has since
been recorded** (`gate:observation_retraction`, round-3 disclosure). **(b) is disclosed, not
fixed**, deliberately — fixing it would be another hand edit of the evidence artifact.

## 5. Minimum path to resume

1. `vibepro review authorize . --id story-vibepro-vacuous-e2e-test-elimination --stage gate --role gate_evidence --review-kind final --closes-risk <text> --expected-judgment-delta <text> --freeze source --freeze spec --freeze test --freeze review_surface`
2. Dispatch **one** fresh-context `gate_evidence` subagent, read-only, forbidding full unit/e2e
   suite runs. Point it at the round-3 disclosure record and ask it to confirm the two medium
   findings are closed. **Do not hint at a conclusion in the prompt** (see §6).
3. `review start` (with the subagent's own id as `--agent-id` and `--agent-session-id`),
   then on return `review close --close-reason completed`, then `review record`.
   `--inspection-input` must include at least one repo file that is in the change surface.
4. `vibepro pr prepare . --story-id story-vibepro-vacuous-e2e-test-elimination --summary-json`
   and confirm `ready_for_pr_create`. Expect `design_ssot_reconciliation` and
   `traceability_clause_coverage` to still need attention.
5. `git push`, then `vibepro pr create . --story-id <id> --head claude/vacuous-e2e-deletions`
   — **never pass `--base`**; add `--allow-needs-verification --verification-waiver <reason>`
   if the head-binding waiver must be carried.
6. Wait for **CI green** (this is the only independent verification of the current head — do
   not skip it), then `vibepro verify import-ci`, re-check gates for regression, re-run
   `pr prepare`, then `vibepro execute merge . --story-id <id> --strategy merge`.
   Never use raw `gh pr merge`.

**Do not re-run the full unit or e2e suites to "refresh" evidence.** Each `verify run` writes
to `verification-runs/<kind>.json` and overwrites it; a partial run would destroy the
2294/2294 and 561/561 records.

## 6. Structural findings — the durable value of this round

These are tooling/process defects surfaced by the work, worth their own Stories. They are the
reason this Story took as many rounds as it did.

1. **Observation prose is not hash-covered, so edits to it are undetectable by construction.**
   `content_binding.surface_hash` covers `content_binding.surface_files` (source files) — all
   8 recompute and match. It has never covered `observation.targets` / `observation.scenarios`.
   Combined with `.vibepro/` being git-ignored and `updated_at` not being bumped on edit, a
   change to gate evidence leaves *no* detectable trace. **This is how four untrue observation
   claims survived multiple review rounds**; they were caught only because reviewers grepped
   the claims against the named files by hand.

2. **Gate detectors key on evidence-kind tokens, not on artefacts.** `gate:judgment_axis_release_ops`
   blocked for missing `release_note` / `rollback_instruction` / `observability_evidence` while
   all four artefacts existed at `CHANGELOG.md:62/67/75` and were pinned by a passing
   cross-file assertion (`LINT-9`). The detector (`src/pr-manager.js:9638-9660`) never inspects
   documentation. The only mechanical fixes are to hand-write the tokens into observation prose
   (the exact mechanism that produced the four untrue claims) or to re-record and thereby
   overwrite existing evidence. Both are dishonest, which is why this closed by waiver.
   **A gate that can only be satisfied by fabricating or destroying evidence is a gate defect.**

3. **The delivery-efficiency budget's `agent_consumption_ms` is wall-clock, not agent work.**
   It sums `closed_at - started_at` across review lifecycles, so lifecycles held open while
   long test suites run on a loaded host inflate it without any additional agent cost. It hit
   28,928,270 ms against a 14,400,000 ms ceiling and blocked dispatch while `subagent_count`
   was only 12/22. This will keep tripping on any Story whose reviews span long suite runs;
   it should not be fixed by per-Story amendments.

4. **A false observation can be entirely non-load-bearing and still ship.** After withdrawing
   all four untrue claims, `common_judgment_spine` and `responsibility_authority` both remained
   **closed** — the truthful tokens carried them alone. The false claims bought nothing and
   were pure downside.

5. **Process hazards observed** (worth guarding, not just remembering): the agent working
   directory can silently reset from the worktree to the main repo mid-session, sending writes
   to the wrong `.vibepro/`; and a review lifecycle left `running` blocks the next
   `review authorize` with `await_result: running`. Both were caught by the tooling refusing
   the next operation, which is the system behaving correctly.

6. **Dispatch prompts can steer verdicts.** One adjudicator explicitly disclosed that the
   prompt it received leaned toward a conclusion. Review and adjudication dispatch text should
   state facts and forbid conclusions, never signal the expected answer.

## 7. Honest limits of this state

- unit and e2e hold **no evidence bound to `2f200bf2`**. The waiver argues, and reviewers
  independently confirmed, that the intervening delta contains no branch-own product code —
  but PR #405 did add a spec file and ~185 test lines, so the recorded lane counts do not
  describe HEAD's test population. The adjudicator closed that gap by direct execution rather
  than by argument.
- `verification-evidence.json` `updated_at` reads `2026-07-31T11:07:47.702Z` against a file
  mtime of `2026-08-01T08:47:22Z`. Disclosed, not corrected.
- One narrowed `artifact_replay` string retains a mild attribution looseness, and the
  integration `content_binding.surface_files` still lists a withdrawn target. Both disclosed
  in the round-3 record; neither is untrue, and neither is a coverage claim.
- **CI has never run on this branch.** It is the only independent verification of the current
  head and it remains outstanding.

---

## 8. Unfreeze and resumption (2026-08-01)

**Grant.** Owner `sato_keigo` lifted the freeze on 2026-08-01 and approved landing this Story
using the sequence proven on PR #406. Recorded in `.vibepro/config.json` under
`budgets.delivery_efficiency_by_story.story-vibepro-vacuous-e2e-test-elimination`
(`max_subagent_count` 22 -> 30, each per-role cap +4, `max_agent_consumption_ms` -> 28800000)
and in `docs/management/decisions/2026-07-30-vacuous-e2e-test-elimination-budget-approval.md`.
The approval reached the implementing agent as a **relay through the orchestrating session**
(`70ea817c-ee56-48c0-ab7c-612da8629872`); the transcript
`~/.claude/projects/-Users-ksato-workspace-repos-vibepro/70ea817c-ee56-48c0-ab7c-612da8629872.jsonl`
is the inspectable primary record. The implementing agent did not observe the owner prompt
first-hand, so this names the approval channel rather than claiming direct observation.

**Delta merge.** `origin/main` had advanced 65 commits (`ea5e90fc` -> `5626ddb5`). Merged with
`git merge origin/main` (not rebase) at merge commit `1c6d37c5`. Two conflicts, both resolved
as keep-both unions:

- `CHANGELOG.md` — both sides appended to `## Unreleased`. This Story's block was kept **first**
  so that the `**Operator action**` / `**Observability**` / `**Rollback**` anchors stay at
  lines 62 / 67 / 75, the positions cited in this Story's gate evidence. `LINT-9` asserts on
  the section rather than on line numbers, so it is order-independent either way.
- `.vibepro/config.json` — four hunks, all ordering or additive. Resolved to the exact union:
  20 budget-override keys (19 upstream + this Story's), 49 registered Stories (45 + 4 upstream),
  `current_story_id` kept on this Story. Every override object was verified byte-equal to one
  of the two source blobs, so no `override_digest` and no grandfathered pin changed. The merge
  produced one duplicate `brainbase.stories[]` entry
  (`story-vibepro-process-record-worktree-durability`, byte-identical, present at different
  positions on the two sides); the second copy was removed.

**Re-verified after the merge, at `1c6d37c5`:**

| check | result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint:e2e-product-execution` | 70 files, all execute product behaviour (was 66; the delta added 4 real e2e files, none vacuous) |
| `cmp -s CLAUDE.md AGENTS.md` | identical |
| `git diff origin/main..HEAD -- src/ bin/` | **empty** — the branch still changes no product code |

**Re-swept the delta for new references to the 17 deleted files.** The only additions are 42
historical `gate_outcome` entries in `docs/management/roi-ledger/ledger.json` whose
`git.changed_files` list `test/e2e/story-vibepro-cli-status-honesty-main.{spec.ts,test.js}` as
files changed at head `220a8580` on 2026-07-10. Those are append-only records of what a past
commit touched, not live path references; deleting the files today does not falsify them. No
source, test, config, or CI path in the delta references any deleted file.

**Correction to §7.** The third bullet of §7 said unit and e2e held no evidence bound to
`2f200bf2`. That is superseded: the evidence chain was re-recorded against the merged head,
so the head-binding gap described there no longer applies in the form stated.
