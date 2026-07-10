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
4. `pr prepare --summary-json`, resolve remaining gate ids using the troubleshooting patterns, then `pr create`.

## Commit Ordering Rule (most important)

Every verification record and review record is bound to the current git head. Committing after recording makes all of it stale.

1. Finalize the **entire tree first**: implementation, tests, Story/Spec/Architecture docs, frontmatter, lineage, config registration.
2. Then record verification evidence.
3. Then run Agent Review last, in one pass.
4. Only then `pr prepare` → `pr create`.

Touching any file listed in a review's inspected surface (even a Story doc) after the review invalidates it. If main advances underneath you, expect a PR-freshness rebase; after `ready_for_pr_create=true`, push and create the PR immediately to close the window.

## Verification Evidence

- `vibepro verify record` overwrites per `--kind`. A throwaway `--command "echo test"` destroys the real record for that kind.
- Prefer structured observations: `--target <path>`, `--scenario <text>`, `--observed key=value`. Evidence classification matches the **observation text**, not the summary. Put markers like `scenario_clause_e2e: spec clause S-001 ...` directly in `--scenario`, using the registered Spec's clause id scheme.
- Evidence strength: a matching kind alone is `supporting` and does not satisfy judgment-spine gates. Attach a real status artifact generated from the actual exit code (`{"status":"pass","exit_code":0}`) via `--artifact` to reach `quality=verified` / `strength=strong`.
- Once a PR exists, `vibepro verify import-ci <repo> --id <id> --pr <n>` converts successful CI checks into head-bound verification evidence instead of rerunning full suites locally. Head SHA mismatch throws; failures are reported, not recorded.
- If a full local suite is unavoidable and the host is memory-constrained, run `node --test --test-concurrency=2` and never mutate the tree while a suite is running.

## Agent Review Lifecycle

Order per role: `review prepare` → `review start` (with the **real** subagent id) → dispatch the subagent → `review close --close-reason completed` → `review record --agent-closed`.

- Started with a placeholder id? Repair: `close --close-reason replaced` → `start` with the real id → `close completed` → `record`.
- Always pass `--inspection-input <ref>` listing the real files inspected. Without it the record cannot be reused across head moves. Keep the list honest and minimal — every listed file that later changes makes the review stale.
- `vibepro review repair <repo> --story-id <id>` generates the prepare→start→close→record command sequence for incomplete review evidence.
- Subagent dispatch prompt must state explicitly: work autonomously without spawning further agents, do not run the full test suite yourself (read the coordinator's run logs instead), and the final message of this run must be the verdict JSON only. Omitting these produces subagents that return no verdict.
- After a rebase, a differential re-review (one subagent covering multiple roles over the delta scope) is a valid fast path.

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

## Red Flags

- Evidence or review records taken before the tree was final.
- A review record without `--inspection-input` or `--agent-closed`.
- A `pass` verify record with no artifact on a judgment-spine-gated story.
- Editing files while a test suite is running.
- Resolving a blocked gate by rewording summaries instead of adding verifiable observations or artifacts.

## Verification

Before treating a gate as resolved, rerun `vibepro pr prepare <repo> --story-id <id> --summary-json` (or `vibepro gate check`) and confirm the specific gate id left the blocking list. Before calling the work PR-ready, confirm `gate_status.ready_for_pr_create=true` and `overall_status=ready_for_review` in the current-head output, and name the exact record or artifact that closed each previously blocked gate.
