---
story_id: story-vibepro-runtime-cost-gap-closure
title: Runtime Cost Gap Closure Spec
parent_design: vibepro-runtime-cost-gap-closure
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        Env["Env session/memory defaults"] --> Collector["session-cost collector"]
        JSONL["Codex JSONL"] --> Collector
        Ambiguous["Ambiguous candidates"] --> Unknown["unavailable provenance, no zero fabrication"]
        Collector --> Merge["execute merge cost accounting"]
        Merge --> Audit["canonical automation_value_audit"]
---

# Spec

## Invariants

- `RCGC-INV-001`: Cost telemetry is evidence for daily value judgment, not the
  value judgment itself.
- `RCGC-INV-002`: Unknown token/time cost must remain unknown.
- `RCGC-INV-003`: Multiple child stories may share this execution story only
  when their contracts are reviewed as one runtime-cost surface.

## Contracts

- `RCGC-CONTRACT-001`: Automation defaults, inference, and cost controls must be
  visible through public CLI/canonical artifact surfaces.
- `RCGC-CONTRACT-002`: `session_selection` provenance must be persisted when
  inference is used.
- `RCGC-CONTRACT-003`: `automation_value_audit.cost_controls` must include
  stable recommendation ids.

## Scenarios

- `RCGC-SCENARIO-001`: Daily automation runs merge cost collection with env
  defaults and receives measured session cost.
- `RCGC-SCENARIO-002`: Daily automation requests inference and receives a
  high-confidence session selection.
- `RCGC-SCENARIO-003`: Heavy audit evidence produces an action-required cost
  control without blocking merge by itself.

## Anti-Patterns

- `RCGC-AP-001`: Do not infer a session from filename alone.
- `RCGC-AP-002`: Do not hide audit bloat behind a generic `partial` status.
- `RCGC-AP-003`: Do not make `execute merge` decide whether the product value
  justified the cost.

## Verification

- `RCGC-VERIFY-001`: Session efficiency tests cover defaults and inference.
- `RCGC-VERIFY-002`: CLI tests cover merge-time propagation.
- `RCGC-VERIFY-003`: Canonical audit tests cover cost controls.
