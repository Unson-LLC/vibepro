---
story_id: story-vibepro-semantic-sufficiency
title: Semantic sufficiency architecture
artifact_profile: feature_packet
feature_slug: semantic-sufficiency
---

# Architecture

## Decision

Keep semantic meaning in a small model-declared contract and keep deterministic
shape, enum, consistency, and evidence-reference checks in VibePro. The
semantic report is additive to Spec validity and is projected into
traceability.

| Responsibility | Owner | Boundary |
|---|---|---|
| Meaning, hypothesis, counterexample, and operational definitions | model/user | declaration only |
| Seven tri-state checks and resolved consistency | `src/semantic-contract.js` | deterministic validation |
| Test/code reference existence | `src/spec-validator.js` | existing Spec validation |
| Verification and outcome coverage projection | `src/traceability.js` | evidence remains separate |

`internal_output`, `downstream_outcome`, and `canonical_readback` are separate
outcome kinds. Downstream and readback are unknown until their own evidence is
observed; a present result is not, by itself, supporting evidence.

No gate DAG, budget, lifecycle, keyword heuristic, external model call, or
runtime automatic continuation is added. An unresolved answer may be recorded
and remains available for human review. A counterexample suppresses the
non-blocking warning only after its concrete test file and case resolve; a case
label alone is not evidence.
