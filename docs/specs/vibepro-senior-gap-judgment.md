---
title: Senior Gap Judgment Spec
status: active
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-senior-gap-judgment
parent_design: vibepro-senior-gap-judgment
---

# Senior Gap Judgment Spec

## Invariants

- `SGJ-INV-001`: Senior Gap Judgment MUST be derived from existing PR context and evidence artifacts, not from unconstrained LLM prose.
- `SGJ-INV-002`: The artifact MUST contain `ideal_state`, `current_state`, `gaps[]`, `decision`, `residual_risks[]`, `followups[]`, and `cost_context`.
- `SGJ-INV-003`: Missing token/time telemetry MUST remain explicit as unavailable or not-collected cost context.
- `SGJ-INV-004`: Non-deferrable unresolved gates MUST remain blocking or needs-review gaps.
- `SGJ-INV-005`: Residual risks MUST remain visible even when the Senior Gap Judgment gate passes.

## Contracts

- `SGJ-CONTRACT-001`: `pr prepare` writes `.vibepro/pr/<story-id>/senior-gap-judgment.json`.
- `SGJ-CONTRACT-002`: `pr_context.senior_gap_judgment` mirrors the artifact payload.
- `SGJ-CONTRACT-003`: Gate DAG includes `gate:senior_gap_judgment` with `type=senior_gap_judgment_gate`.
- `SGJ-CONTRACT-004`: Canonical audit replay includes the senior gap judgment artifact when present.
- `SGJ-CONTRACT-005`: Usage report collection records senior gap judgment presence and gap counts per story.

## Scenarios

- `SGJ-S-001`: Given no non-deferrable gaps and only missing cost telemetry, when Senior Gap Judgment is built, then decision status is `passed_with_residual_risk` and the gate status is `passed`.
- `SGJ-S-002`: Given a required gate is unresolved, when Senior Gap Judgment is built, then the artifact contains an `unresolved_required_gate` gap.
- `SGJ-S-003`: Given an engineering judgment axis is explicitly accepted as follow-up, then Senior Gap Judgment keeps it as a safe-to-defer residual gap instead of hiding it.
- `SGJ-S-004`: Given `pr prepare` runs, then `.vibepro/pr/<story-id>/senior-gap-judgment.json` exists and the Gate DAG includes `gate:senior_gap_judgment`.
- `SGJ-S-005`: Given canonical audit promotion runs after merge, then the replay bundle can include `senior_gap_judgment`.
- `SGJ-S-006`: Given usage report reads PR artifacts, then the story row exposes senior gap judgment status and counts.

## Anti-patterns

- `SGJ-AP-001`: Treating missing token/time telemetry as zero.
- `SGJ-AP-002`: Replacing Design SSOT, Requirement, Responsibility Authority, or review gates with a prose summary.
- `SGJ-AP-003`: Blocking a PR with an LLM-only semantic claim that has no artifact-backed gap.
- `SGJ-AP-004`: Hiding accepted followups outside decision records or follow-up artifacts.

## Verification

- `SGJ-V-001`: Unit tests cover the pure Senior Gap Judgment model.
- `SGJ-V-002`: PR prepare tests cover artifact emission and Gate DAG placement.
- `SGJ-V-003`: Canonical audit tests cover replay inclusion.
- `SGJ-V-004`: Usage report tests cover senior gap judgment collection.
