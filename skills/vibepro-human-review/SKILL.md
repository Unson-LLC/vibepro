---
name: vibepro-human-review
description: Use when reviewing VibePro PR preparation artifacts, deciding whether to proceed, split, add evidence, waive with reason, or block.
---

# VibePro Human Review

## Purpose

Use this Skill when a human or AI reviewer needs to interpret VibePro PR artifacts. `pr-prepare.json` is the readiness source of truth; the review cockpit is the human control plane.

## When to Use

Use this Skill when deciding whether a VibePro-prepared change should proceed, split, add evidence, waive with reason, or block. It applies to PR readiness reviews, merge readiness checks, waiver decisions, and cases where the user asks whether VibePro evidence is enough.

## Review Order

1. Read `.vibepro/pr/<story-id>/pr-prepare.json` `gate_status`.
2. Confirm `gate_status.overall_status`, `ready_for_pr_create`, unresolved Gates, and critical unresolved Gates.
3. If `gate_status.agent_review_instruction` is present, block human approval until the coordinator has authorization to use subagents and then has:
   - run the listed `vibepro review prepare` commands,
   - dispatched the generated `parallel-dispatch.md` requests to parallel subagents,
   - closed/shutdown each review subagent after receiving its result,
   - recorded each result with `vibepro review record` including Codex/Claude Code subagent provenance and `--agent-closed`,
   - rerun `vibepro pr prepare` and cleared `gate:agent_review`.
   If the coordinator runtime cannot spawn subagents, treat that as a blocker or require a human waiver decision. Do not accept manual review records as a substitute for required Codex/Claude Code subagent provenance.
4. Open `.vibepro/pr/<story-id>/review-cockpit.html`.
5. Read the recommended decision and reason.
6. Check split lanes and Graphify investigation scope.
7. For UI modernization PRs, read `.vibepro/design-modernize/<story-id>/derived-design-system.json`, `design-modernize.json`, and `ds-gate.json`. Confirm that current routes, information architecture, CTA priority, state behavior, and data dependencies are preserved unless the Story/Spec explicitly changes them.
8. For performance-sensitive PRs, read the `Performance Evidence` section in `pr-body.md` and the JSON runs under `.vibepro/pr/<story-id>/performance-runs/`.
9. Review next commands and confirm they use `vibepro pr create`.
10. Copy `human-review.json`, fill the review record, and keep it as the human decision artifact.

## Decision Rules

- `proceed`: Use only when `gate_status.ready_for_pr_create=true`, `gate_status.overall_status=ready_for_review`, and the split-plan does not require separation.
- `split_pr`: Use when scope is broad, repo-control files are mixed in, or split-plan recommends lanes.
- `add_evidence`: Use when required Gates need test, typecheck, integration, E2E, or requirement evidence.
- `waive_with_reason`: Use only with a specific reason for non-critical unresolved Gates. Critical unresolved Gates cannot be approved by reason alone.
- `block`: Use when Story, Architecture, Spec, security, or Gate evidence is contradictory or insufficient.

## Required Record

Fill these fields in `human-review.json`:

- `review_record.selected_decision`
- `review_record.reviewer`
- `review_record.reason`
- `review_record.reviewed_at`
- `review_record.comments` when needed

## Guardrails

- Do not treat `review-cockpit.html` as machine-readable truth; use the JSON sidecar.
- Do not treat `scope.status=reviewable` as completion approval. It is PR size/scope guidance only.
- Do not approve a PR only from the PR body. The cockpit and Gate DAG are the review control plane.
- Do not use raw `gh pr create`; it bypasses VibePro Gate enforcement and waiver recording.
- Do not approve with unresolved Agent Review Gate. Missing, stale, or blocking required roles mean the parallel subagent review workflow has not completed for the current git state.
- Do not approve a `pass` review result that lacks Codex/Claude Code parallel subagent provenance and closed lifecycle evidence (`--agent-closed`) when `gate:agent_review` is required. It is a coordinator note, not verified subagent review evidence.
- If a waiver is chosen, include the exact waiver reason in `vibepro pr create --allow-needs-verification --verification-waiver <reason>`.
- Do not approve a performance claim when the comparison says `改善率不明` / `not_comparable`.
- Do not accept server-side readiness as evidence for user-perceived readiness. User-perceived metrics need `browser_e2e`, `client_marker`, or `manual_observation`.
- Check that snapshot visible, DOM visible, API completed, server ready, and interactive ready are not mixed into one completion condition.
- Do not approve UI modernization when `ds-gate.json` is missing, has implicit fallback, or omits DS drift / component role / composition / anti-pattern checks.
- Do not approve a generated visual direction just because it looks better. Require evidence that it preserves the existing product workflow and that the implementation follows VibePro-derived DS constraints.

## Common Rationalizations

- "The PR scope is reviewable, so it can proceed." Scope reviewability is not completion approval.
- "The PR body summarizes the gates, so the JSON is unnecessary." `pr-prepare.json` and Gate DAG are the machine-readable truth.
- "A human looked at it, so Agent Review is satisfied." Required Agent Review needs the required subagent provenance and lifecycle closure unless waived outside the gate.
- "Only non-critical gates remain, so no reason is needed." Waivers must name the exact reason and cannot cover critical gates.
- "The UI looks better, so modernization is acceptable." Preservation of workflow, DS constraints, and regression evidence still matter.

## Red Flags

- `ready_for_pr_create` is false, missing, or contradicted by unresolved gates.
- Critical unresolved gates are being waived by explanation alone.
- Agent Review records are stale, manual-only, missing provenance, or missing `--agent-closed`.
- Performance evidence says `not_comparable` or `改善率不明` while the PR claims improvement.
- UI modernization lacks DS gate or current workflow preservation evidence.
- The reviewer only opened HTML and did not inspect JSON sidecars.

## Verification

Record the final decision from current `pr-prepare.json`, `gate-dag`, `review-cockpit.html`, and `human-review.json`. If the decision is proceed, confirm `gate_status.ready_for_pr_create=true`, `overall_status=ready_for_review`, no critical unresolved gates, and no split requirement. If the decision is waive, record the exact waiver reason and affected gates.

## Performance Evidence Review

For a PR that claims speed improvement, require:

- Metric definition exists in the Story `performanceMetrics[]`.
- Runs exist under `.vibepro/pr/<story-id>/performance-runs/*.json`.
- before and after use the same `metricId` and `completionCondition`.
- p50, p90, max, sample count, and incomplete rate are visible.
- `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, or `unknown` runs are retained instead of silently dropped.
- DB/server metrics and user-perceived metrics are separate when both matter.
