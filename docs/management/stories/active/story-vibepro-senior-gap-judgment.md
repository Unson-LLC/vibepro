---
story_id: story-vibepro-senior-gap-judgment
title: Senior Gap Judgment Artifact
status: active
parent_design: vibepro-senior-gap-judgment
architecture_docs:
  - docs/architecture/vibepro-senior-gap-judgment.md
spec_docs:
  - docs/specs/vibepro-senior-gap-judgment.md
---

# Story: Senior Gap Judgment Artifact

## Problem

VibePro already has Engineering Judgment axes, Design SSOT reconciliation, Responsibility Authority, Requirement, traceability, review, and verification gates. Those pieces ask strong senior-engineer questions, but the final PR evidence still does not explicitly say what the ideal state was, what current evidence showed, which gaps remain, why the decision is safe, and what cost telemetry is missing.

As a result, a PR can be test-green and gate-green while a later engineer still has to reconstruct the actual senior judgment from scattered artifacts.

## User Story

As a VibePro operator,
I want `pr prepare` to write a Senior Gap Judgment artifact,
so that another engineer or agent can see the ideal/current/gap/decision/residual-risk/cost judgment without replaying every raw artifact first.

## Acceptance Criteria

- [ ] `SGJ-AC-001`: `pr prepare` writes `.vibepro/pr/<story-id>/senior-gap-judgment.json`.
- [ ] `SGJ-AC-002`: The artifact contains `ideal_state`, `current_state`, `gaps[]`, `decision`, `residual_risks[]`, `followups[]`, and `cost_context`.
- [ ] `SGJ-AC-003`: The Gate DAG includes `gate:senior_gap_judgment` as a required gate.
- [ ] `SGJ-AC-004`: Non-deferrable unresolved gates or unmapped clauses become blocking or needs-review senior gaps.
- [ ] `SGJ-AC-005`: Missing token/time telemetry is kept explicit as unavailable residual risk and is never converted to observed zero cost.
- [ ] `SGJ-AC-006`: Canonical audit replay and usage report collection can reconstruct whether a senior gap judgment existed after merge.

## Architecture Decision

Add a compact `senior-gap-judgment.json` PR artifact instead of another large review report. The artifact should reuse existing PR context and avoid becoming an LLM-only opinion store.

## Runtime Evidence

- current_reality: The change is inside PR evidence generation, canonical audit promotion, and usage-report artifact collection. It does not change product runtime behavior, external sends, database state, or deployment paths.
- failure_modes: The artifact must not hide missing telemetry, weak traceability, stale evidence, or unresolved gates by translating them to pass-only prose.
- done_evidence: Unit tests cover the pure Senior Gap Judgment model, `pr prepare` artifact/gate emission, canonical audit replay inclusion, and usage-report collection.
