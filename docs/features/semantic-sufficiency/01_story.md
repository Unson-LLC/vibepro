---
story_id: story-vibepro-semantic-sufficiency
title: Semantic sufficiency without false success
status: implemented
---

# Story

When a result exists but does not answer the requested claim, a reviewer needs
to see that distinction without turning an unresolved answer into a failed
Spec or a guessed success.

## Acceptance criteria

- A semantic contract records the six ownership and failure-boundary fields and
  operational definitions for the seven tri-state checks.
- Each semantic clause declares its outcome kind and case kind, and may record
  the question digest, answer, explanations, confidence, conflict/freshness
  checks, seven tri-state checks, and supporting record IDs.
- `resolved` requires a known outcome, all seven checks to be `true`, complete
  supporting fields and evidence, and a positive case; `no_answer` and other
  unresolved cases remain valid Specs.
- A counterexample label is not verified until its concrete test file and case
  resolve.
- Legacy Specs retain `validation.ok` and report semantic assessment as
  unavailable with a `semantic_contract_missing` warning.
- Traceability keeps internal output, downstream outcome, and canonical
  readback distinct, preserving unknown verification status.
