---
title: VibePro Downstream Diagram Preflight Architecture
status: active
created_at: 2026-07-02
updated_at: 2026-07-02
related_stories:
  - story-vibepro-downstream-diagram-preflight
---

# VibePro Downstream Diagram Preflight Architecture

## Decision

Extend the existing design-diagram gate path rather than adding a separate
preflight gate. `resolveRequiredDiagrams` remains the deterministic trigger
source, `buildDesignDiagramsGate` enriches missing requirements with operator
guidance, and PR readiness serialization preserves that guidance in unresolved
and execution-gate summaries.

## Flow

```text
changed files
  -> resolveRequiredDiagrams
  -> evaluateDesignDiagramsGate
  -> build downstream_diagram_requirements
  -> gate_status critical/blocking gates
  -> next_required_actions
```

## Trigger Model

Responsibility-authority JSON artifacts always represent authority boundaries,
so they explicitly require `threat_model`. Contract JSON artifacts require
`threat_model` when path or content indicates authority, permission, policy,
credential, token, session, identity, password, access-control, PII, or personal
data concerns.

## Output Model

Each downstream requirement carries:

- `kind`: the missing diagram kind, such as `threat_model`.
- `trigger_path`: the changed file path that caused the requirement when it can
  be parsed from the resolver signal.
- `trigger_signal`: the original deterministic resolver reason.
- `insertion_target`: `.vibepro/spec/<story-id>/spec.json diagrams[]`.
- `tracked_spec_guidance`: the tracked Spec document section for the Story.
- `minimal_diagram`: a valid Mermaid starter shape for the required kind.

## Failure Modes

- If a resolver reason lacks a parseable path, the original signal remains in
  `trigger_signal` and action text uses it as the fallback trigger.
- If a Story id is unavailable, the insertion target uses `<story-id>` so the
  action is still structurally useful.
- Existing non-authority diagram triggers continue through the same gate path.
