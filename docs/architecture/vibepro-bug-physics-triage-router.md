---
title: VibePro Bug Physics Triage Router Architecture
status: active
story_id: story-vibepro-bug-physics-triage-router
stories:
  - story-vibepro-bug-physics-triage-router
---

# Bug Physics Triage Router Architecture

## Boundary

Bug physics triage belongs in `pr-manager.js` because PR readiness, Gate DAG construction, verification binding, Agent Review, and PR body generation already converge there.

It is separate from `change_classification`:

- `change_classification` answers how risky the diff surface is.
- `bug_physics_triage` answers what kind of proof can actually show this bug is fixed.

## Design

`buildBugPhysicsTriage` reads Story/Spec text and current verification evidence. It emits:

- `class[]`: `timing`, `state-invariant`, `deterministic-byte`, `observability`, `deployment`
- `probe_evidence`: entry-condition evidence that triage was measured before design
- `gate_profile`: required gates and typed N/A exits selected by the classes
- `contradiction_feedback`: whether selected harness failure indicates possible misclassification

The Gate DAG inserts `gate:bug_physics_triage` after the common Engineering Judgment spine and before PR route classification. Class-specific gate profile nodes are then attached before downstream verification and review gates.

## Gate Profile

- `timing`: require phase decomposition, violation-rate/SLO harness, settle-contract review; mark single-shot E2E as typed N/A.
- `state-invariant`: require illegal-state-unrepresentable design and invariant unit regression; mark SLO as proof-only typed N/A.
- `deterministic-byte`: require real-byte fixture and headless replay; mark violation-rate/SLO as typed N/A.
- `observability`: require authoritative signal source and monitoring; mark Spec/E2E code-gate lane as typed N/A.
- `deployment`: require version-stamp propagation evidence; mark code gates as typed N/A because the bug is outside code.

## Non-Goals

- Do not replace ordinary change risk classification.
- Do not make every PR pay bug-specific evidence cost.
- Do not turn typed N/A into a waiver. It is a selected profile outcome with an explicit reason.
