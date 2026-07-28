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

Order per role: `review prepare` → `review authorize` (model, risk closure, freeze, Story-wide budget) → dispatch only when authorized → `review start --dispatch-authorization <id>` (with the **real** subagent id) → `review close --close-reason completed` → `review record --agent-closed`.

- Never spawn first and authorize later. An authorization stop means no subagent is started. Active reservations count against the Story budget, preventing parallel coordinators from overbooking it.

- Started with a placeholder id? Repair: `close --close-reason replaced` → obtain a fresh authorization → `start` with the real id and authorization → `close completed` → `record`.
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

## Enumeration Coverage (`gate:enumeration_coverage`)

A review finding names an instance; the work item is its class. This is enforced, not advised: the gate blocks.

**When it applies.** The gate collects string literals your change introduces into `src/`, `bin/`, `lib/`, `scripts/` that are absent from the base tree **and** reach two or more product source *files* at head, **or** appear twice or more in a single one. Pre-existing vocabulary and genuinely single-site constants are skipped with a recorded reason; a change with no such identifier — including every docs-only change — resolves as `not_applicable`.

**What it wants.** One scenario per introduced identifier. Use this form:

```
--scenario "enumeration: count <identifier> across src, test, docs"
--scenario "enumeration: count <identifier> across src, test, docs; unchanged because <reason>"
```

**Do not write a number.** You declare the identifier and the range; the gate measures everything else. It counts the sites, and splits them into the ones this change wrote and the ones it left alone by mapping each site onto the base diff's added lines. Those values land on the artifact as `claims[].found` / `updated` / `unchanged` with `count_source: "computed"`, having never passed through your input.

Append `; unchanged because <reason>` only when the gate says the split leaves sites untouched — its rejection tells you the exact numbers, so you never count to find out. The reason is the one thing measurement cannot supply: why leaving those sites is correct. Note the trade: the reason is validated once, when the untouched remainder first appears, and is not re-checked as that remainder grows with later commits. Removing the recount round trip removes its re-reading prompt too, so on review the reason clause is the field to read rather than trust.

One narrowing came with the form: a scenario beginning `enumeration:` that contains `count <token> across` but does not match the grammar is now `enumeration_scenario_malformed`, which fails the whole `verify record` invocation. Prose like "enumeration: we count ghost_state across src and test as one class" used to record; reword it or drop the prefix.

**Why prose does not work.** The grammar rejects count-free narration — "swept src, docs and bin" is not a claim — and a declared range still has to reach every product source file the identifier lives in. Reproduce what the gate sees with `grep -rIn --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.vibepro -w -- <identifier> <paths> | wc -l`.

**Legacy counted form.** `enumeration: grepped <id> across <paths>; N sites found, M updated, K unchanged because <reason>` still parses, still recounts, and existing records stay valid — but it is recorded as `count_source: "agent_declared"` and it goes stale on every commit that touches a declared path, whether or not the identifier's meaning changed. Across the gate's own eight review rounds the same six claims were hand-recounted and rewritten eight times, and three of the rewrites were triggered by commits that touched neither identifier. Prefer `count`. `report.count_provenance` shows how many of each form a story is carrying.

A scenario that begins with `enumeration:` but is not recognised as a claim is reported in the gate's `required_actions` rather than dropped, so an unseen claim is never mistaken for a rejected one.

Because the count is recounted, the scenario cannot be satisfied by writing the token — only by having actually swept the range it names. Record it after the tree is final: editing a declared path changes the count and the claim stops matching. `inconclusive` (base ref or diff unresolvable) is not a pass, and a claim on stale-bound evidence does not count.

Three further rejections exist because a claimant otherwise controls the range:

- `enumeration_range_too_narrow` — the range must actually reach **every product source file the identifier lives in**; the gate names the ones it never reached. Declared paths are normalised, deduplicated and de-nested first, so repeating or nesting a path cannot inflate coverage.
- `enumeration_range_unscannable` — a file in the range could not be read, so the recount and the published grep would disagree invisibly. The gate names the file; make it readable or narrow the range. There is no size cap: files are streamed line by line, and binary detection reads a **measured 32,768-byte leading probe** — the point at which `grep -I` on this host switches between calling a file binary and counting it in full — so files excluded that way are listed in the report's `binary_paths` rather than dropped silently. A single line over 4,000,000 characters is reported as unscannable, which is a fail-closed status rather than a memory bound: readline has already assembled the line by then.
- An identifier appearing twice inside a *single* file still requires a claim. A gate id written as a node type plus a collector allowlist entry lives in one file, and that is precisely the registration class that gets half closed.

`inconclusive` records which of three causes applies, and **none of them has a gate-specific escape**. One existed for `product_source_unreadable` and was reviewed twice; both rounds found it releasing more than it advertised, because that cause is returned before the recount runs, so no consumer-side guard could see a rejection the producer had not computed yet. It is deleted rather than patched again. An unreadable product source file leaves the class genuinely unsized, so fix the file, narrow what is checked in under the product source prefixes, or route the judgment through the generic auditable waiver: `vibepro pr create ... --allow-needs-verification --verification-waiver <reason>`. For the other two causes, fix the base ref or the diff.

Classes worth enumerating whenever a new field, state, or predicate appears:

| Class | Enumerate |
|---|---|
| producer | every site that writes the field — never infer the field name from a consumer |
| consumer | every site that reads it, including renderers and per-group rollups, not just the primary aggregate |
| value | the full value space (`0`, `null`, negative, absent, alias spellings); check the write side and read side agree |
| emitter | every generated command template and every doc showing a copy-pasteable example |
| sibling predicate | any predicate resolving the same input — `isCriticalUnresolvedGate` exists in both `pr-manager.js` and `execution-state.js` |

Do not report convergence from "the last round passed" — that only means the reviewers did not look there. Convergence is claimable only after an enumeration that finds nothing new.

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
- "I fixed the line the reviewer pointed at." A finding names an instance; `gate:enumeration_coverage` asks for the class and recounts the range you claim to have swept.

## Red Flags

- Evidence or review records taken before the tree was final.
- A review record without `--inspection-input` or `--agent-closed`.
- A `pass` verify record with no artifact on a judgment-spine-gated story.
- Editing files while a test suite is running.
- Resolving a blocked gate by rewording summaries instead of adding verifiable observations or artifacts.
- Adjudication verdicts recorded by the implementing agent itself, or verdicts whose `head_commit` no longer matches the current head.
- An `inconclusive` scanner status reported as a pass.
- Fixing a review finding at the reported line without grepping for the rest of its class.
- Reporting convergence because the last review round passed, with no enumeration behind the claim.
- An enumeration scenario that contains a number at all. Use `enumeration: count <id> across <paths>`; the gate measures it. A hand-written count is either already stale or about to be.

## Verification

Before treating a gate as resolved, rerun `vibepro pr prepare <repo> --story-id <id> --summary-json` (or `vibepro gate check`) and confirm the specific gate id left the blocking list. Before calling the work PR-ready, confirm `gate_status.ready_for_pr_create=true` and `overall_status=ready_for_review` in the current-head output, and name the exact record or artifact that closed each previously blocked gate.
