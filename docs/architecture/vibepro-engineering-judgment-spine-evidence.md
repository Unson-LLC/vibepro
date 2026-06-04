---
title: Engineering Judgment Spine Evidence Architecture
summary: "Turns the common Engineering Judgment spine into evidence-backed sub-checks without overblocking light changes."
---

# Engineering Judgment Spine Evidence Architecture

## Context

`gate:common_judgment_spine` existed as a structural node, but it always passed. That made the DAG explain the shape of senior engineering thinking without proving whether the shared questions had evidence.

## Design

The common spine remains before route-specific gates. It now emits six sub-checks:

- `intent`
- `current_reality`
- `invariants`
- `boundaries`
- `failure_modes`
- `done_evidence`

Each sub-check reads existing PR context rather than introducing a new evidence store. Story source, changed-file classification, Spec/Architecture docs, inferred Spec clauses, verification evidence, decision records, and Agent Review summaries are the inputs.

## Risk Adaptation

Light and docs-only changes should not become blocked by a universal heavy checklist. High-risk and workflow-heavy changes require stronger evidence for invariants, boundaries, failure modes, and done evidence. Missing high-risk evidence makes the spine `needs_evidence` and therefore blocks PR creation.

## PR Body Surface

The PR body evidence digest includes missing common-spine sub-checks so reviewers can see which senior-engineering question lacks proof.
