---
name: vibepro-gate-evidence
description: Use when recording VibePro verification or review evidence, writing Architecture/Spec artifacts, or resolving blocked gates when pr prepare reports needs_verification, needs_review, or unresolved gate ids.
---

# VibePro Gate Evidence Playbook

## Purpose

Distilled operating knowledge for closing VibePro gates efficiently. `pr prepare` tells you *which* gates block; this Skill tells you *how* to produce evidence that actually resolves them, in the right order, without stale-evidence rework.

## When to Use

Use this Skill when recording `vibepro verify record` / `vibepro review record` evidence, writing Architecture or Spec artifacts through the CLI, or when `pr prepare` / `gate check` reports `needs_verification`, `needs_review`, or specific unresolved gate ids. Also use it before deciding the commit/evidence/review order for any VibePro-managed change.

## Required Workflow

1. Finalize the entire tree (see Commit Ordering Rule below).
2. Record verification evidence with structured observations and strong artifacts.
3. Run the Agent Review lifecycle once, in order, with honest inspection inputs.
4. Run the adjudication gates (evidence + judgment DAG) with an independent fresh-context subagent.
5. `pr prepare --summary-json`, resolve remaining gate ids using the troubleshooting patterns, then `pr create`.

## Commit Ordering Rule (most important)

Verification and review records are content-surface-bound by default. A later commit only makes them stale when it changes a recorded target or inspected file. Configured high-risk review roles remain strict-HEAD-bound; a CLI override requires both `--strict-head-binding` and `--strict-head-reason`.

1. Finalize the intended verification and review surfaces first: implementation, tests, relevant Story/Spec/Architecture docs, frontmatter, lineage, config registration.
2. Then record verification evidence.
3. Then run Agent Review last, in one pass.
4. Only then `pr prepare` → `pr create`.

Touching any file listed in a review's inspected surface (even a Story doc) after the review invalidates that review. An unrelated main advance does not invalidate a content-scoped review. Strict roles still invalidate on every HEAD change.

## Verification Evidence

- `vibepro verify record` overwrites per `--kind`. A throwaway `--command "echo test"` destroys the real record for that kind.
- Prefer structured observations: `--target <path>`, `--scenario <text>`, `--observed key=value`. Evidence classification matches the **observation text**, not the summary. Put markers like `scenario_clause_e2e: spec clause S-001 ...` directly in `--scenario`, using the registered Spec's clause id scheme.
- Evidence strength: a matching kind alone is `supporting` and does not satisfy judgment-spine gates. Attach a real status artifact generated from the actual exit code (`{"status":"pass","exit_code":0}`) via `--artifact` to reach `quality=verified` / `strength=strong`.
- Once a PR exists, `vibepro verify import-ci <repo> --id <id> --pr <n>` converts successful CI checks into head-bound verification evidence instead of rerunning full suites locally. Head SHA mismatch throws; failures are reported, not recorded.
- If a full local suite is unavoidable and the host is memory-constrained, run `node --test --test-concurrency=2` and never mutate the tree while a suite is running.

## Agent Review Lifecycle

Order per role: `review prepare` → `review start` (with the **real** subagent id) → dispatch the subagent → `review close --close-reason completed` → `review record --agent-closed`.

- Started with a placeholder id? Repair: `close --close-reason replaced` → `start` with the real id → `close completed` → `record`.
- Always pass `--inspection-input <ref>` listing the real source, test, Story, Spec, contract, or config files inspected. A review-request path or generated `.vibepro` artifact alone is not a content surface. Keep the list honest and minimal — every listed file that later changes makes the review stale.
- Do not append `--strict-head-binding` to every review. Configured strict roles apply automatically; a deliberate override must include `--strict-head-reason <text>`.
- `vibepro review repair <repo> --story-id <id>` generates the prepare→start→close→record command sequence for incomplete review evidence.
- Subagent dispatch prompt must state explicitly: work autonomously without spawning further agents, do not run the full test suite yourself (read the coordinator's run logs instead), and the final message of this run must be the verdict JSON only. Omitting these produces subagents that return no verdict.
- After a rebase, a differential re-review (one subagent covering multiple roles over the delta scope) is a valid fast path.

## Adjudication Gates (`gate:evidence_adjudication` / `gate:judgment_dag_adjudication`)

Token matching and record existence are no longer the final word: two required gates re-judge the *meaning* of the evidence, and both must be closed by an **independent fresh-context subagent — never the implementing agent**.

- **Evidence adjudication** judges whether the recorded evidence actually demonstrates each acceptance-criteria clause. Flow: `vibepro adjudicate prepare . --id <story-id>` generates `.vibepro/adjudication/<story-id>/adjudication-request.md`; dispatch it to the independent subagent; record each clause with `vibepro adjudicate record . --id <story-id> --clause <clause-id> --verdict <v> --reason <text> --agent-system codex|claude_code --agent-id <id>`.
- Evidence verdicts: `demonstrated` (the observation reaches the outcome with no inferential leap), `not_demonstrated` (string/field-existence checks, unrelated passing tests, or ungrounded observations — the gate **fails** until better evidence exists), `not_verifiable_by_automation` (needs human observation; choosing it honestly is the correct outcome, not a penalty).
- **Judgment DAG adjudication** re-judges spine/axes/failure-mode items that were mechanically consumed by token matching or decision records. Same flow with `--judgment`: `vibepro adjudicate prepare . --id <story-id> --judgment`, then `vibepro adjudicate record . --id <story-id> --judgment --item <item-id> --verdict <v> [--unsound-cause implementation_unsound|classifier_premise_unsound] --reason <text> ...`. Verdicts: `judged_sound`, `judged_unsound` (tokens present but the judgment does not hold — gate fails), `needs_human_judgment`.
- Every new `judged_unsound` verdict requires an explicit cause. `implementation_unsound` remains failed until implementation/evidence changes and a new HEAD is adjudicated. Cause-less legacy verdicts normalize to `implementation_unsound`.
- Only `classifier_premise_unsound` may be corrected: `vibepro adjudicate correct . --id <story-id> --judgment --item <item-id> --original-verdict-id <event-id> --incorrect-premise <text> --corrected-premise <text> --reason <text> --replacement-evidence <workspace-relative-file> --agent-system <system> --agent-id <id>`. The evidence path must be a readable regular file and is stored with SHA-256. Then dispatch a **different** fresh-context judge and record its linked verdict with `--correction-id <correction-event-id>`. The original verdict, correction, and re-adjudication are append-only; a correction is never a generic waiver.
- Human closure: `not_verifiable_by_automation` clauses and `needs_human_judgment` items close only with an accepted decision record carrying **both** reason and artifact: `vibepro decision record . --id <story-id> --type needs_review --source gate:evidence_adjudication:<clause-id> --status accepted --reason <human-observation> --artifact <evidence-path>` (judgment side: `--source gate:judgment_dag_adjudication:<item-id>`).
- Verdicts are head-bound and **fail closed**: a verdict without a recorded `head_commit`, or evaluated when the current HEAD is unknown, never counts as fresh. Any commit after recording invalidates all verdicts — adjudicate after the tree is final, in the same pass as (after) Agent Review.
- Stories with no AC clauses / routes with no active judgment items resolve as explicit `not_applicable`, which is not a pass.

## Scanner Conclusiveness (`inconclusive` vs `not_applicable`)

Scanners that examine zero targets no longer report `pass`. `inconclusive` means the scanner applied to the story but discovered no scan targets — absence of coverage is not evidence of a pass; give the scanner real targets or fix discovery before treating the gate as closed. `not_applicable` means the scanner is out of scope for the story. Never present an `inconclusive` result as a passing gate.

## Architecture / Spec Write

- `vibepro spec write` validates that `code_refs`/`test_refs` files exist and anchor strings are present — register the Spec **after or together with** implementation. Input JSON needs `schema_version` and `story_id`; clause types are invariant/scenario/contract/sla.
- `spec write --final` requires fresh Pre-Spec Readiness; rerun `vibepro spec readiness --base <ref>` if stale. State diagrams require `entities`. Errors return as `ok:false` JSON — read the whole output, not the tail.
- Gates that need specific diagrams (e.g. threat_model) read only the final Spec artifact's `diagrams[]`, not a "## Diagrams" section in the Spec doc, and not draft Specs.
- Architecture gate without a separate ADR: declare in Story frontmatter under a `reason:` key covering alternatives, compatibility, rollback, and boundary.
- Register hand-written Stories by appending an entry to `.vibepro/config.json` `brainbase.stories[]`; `story derive` catalogs are clustered separately and will not pick them up.

## Gate Troubleshooting Patterns

- `story diagnose` reads Graphify output per run: pass `--run-graphify` on the diagnose command itself; a prior standalone import does not resolve it.
- Requirement-anchoring records whose tokens are all generic words (e.g. `unit_regression`) only match when the record text includes a contract clause id from the Spec.
- `failure_mode_coverage` candidates are derived from Story/Spec keywords and also fire on negated phrasing ("network-free" still yields a provider_failure candidate). Decisions do not clear this gate; state the verified truth (dependency absent and its absence verified) with the token in a `--scenario`.
- `release_ops` axis resolves when the record observation includes explicit release_note / rollout_plan / rollback_instruction / observability_evidence tokens grounded in real artifacts.
- Judgment-axis followup decisions count as accepted only with **both** `--reason` and `--artifact`.
- REQ-GAP (existing branch in a diff file not covered): add an English inherited-behavior sentence with the condition token ("<condition> is unchanged/existing") to a requirement source such as the Story doc.
- When extending the Gate DAG itself, every new node needs an **incoming** edge on an existing path from story; outgoing-only nodes make `gate:dag_connectivity` unreachable and pin overall status at needs_verification.

## Fast Lane

`gate:agent_review` becomes typed N/A when the route is docs_only, or when the profile is light **and** source file count is zero, with no disqualifying signals (risk surfaces, secret surface, new network calls, high-risk routes). Source changes always keep review, even on light profiles.

## Context Economy

Start from `vibepro pr prepare --summary-json` or `--view <readiness|blocking-gates|gate-evidence|traceability|design-ssot|senior-gap>`; drill into full artifacts only for flagged gate ids. Full JSON artifacts are the persisted source of truth, not the first read.

## Common Rationalizations

- "I'll record the evidence now and commit the docs after." The commit invalidates every record; finalize the tree first.
- "The tests passed, so the gate should accept the record." Kind match without a real status artifact stays `supporting`; judgment-spine gates need `strength=strong`.
- "A quick manual review note will satisfy the review gate." Required Agent Review needs the full lifecycle with subagent provenance, `--agent-closed`, and inspection inputs.
- "Rewording the summary should clear the gate." Gates match observation text and artifacts; add verifiable facts, not phrasing.
- "I'll write the Spec first so the gates are ready." `spec write` validates that code_refs/test_refs exist; register it after or with implementation.
- "The judgment-axis tokens matched, so the item is closed." Token matching only feeds the mechanical layer; `gate:judgment_dag_adjudication` can still rule the item `judged_unsound` against the actual diff.
- "The scanner found nothing, so the gate passes." Zero scanned targets is `inconclusive`, not a pass.

## Red Flags

- Evidence or review records taken before the tree was final.
- A review record without `--inspection-input` or `--agent-closed`.
- A `pass` verify record with no artifact on a judgment-spine-gated story.
- Editing files while a test suite is running.
- Resolving a blocked gate by rewording summaries instead of adding verifiable observations or artifacts.
- Adjudication verdicts recorded by the implementing agent itself, or verdicts whose `head_commit` no longer matches the current head.
- An `inconclusive` scanner status reported as a pass.

## Verification

Before treating a gate as resolved, rerun `vibepro pr prepare <repo> --story-id <id> --summary-json` (or `vibepro gate check`) and confirm the specific gate id left the blocking list. Before calling the work PR-ready, confirm `gate_status.ready_for_pr_create=true` and `overall_status=ready_for_review` in the current-head output, and name the exact record or artifact that closed each previously blocked gate.
