---
title: VibePro Residual Risk Closure Spec
status: active
parent_design: vibepro-residual-risk-closure
---

# VibePro Residual Risk Closure Spec

## Invariants

- RRC-INV-001: active_accepted_followup remains non-passed while required evidence is missing.
- RRC-INV-002: scope.status=reviewable supplies split_plan evidence because the split decision has been evaluated.
- RRC-INV-003: graph_impact_scope is an explicit evidence kind and may be matched from current verification text.
- RRC-INV-004: cost_context never treats unavailable token accounting as zero.
- RRC-INV-005: cost_telemetry_unavailable is not a Senior Gap residual risk when artifact policy explicitly declares bounded PR-body exposure.
- RRC-INV-006: Generated `pr-body.md` alone is not evidence that PR-body token exposure is bounded.
- RRC-INV-007: Story source discovery must prefer exact `story_id` authority before `vibepro_story_id` child binding or other fallback identifiers.

## Acceptance Mapping

- Public contract closure maps to RRC-INV-001.
- Scope reviewability closure maps to RRC-INV-002 and RRC-INV-003.
- Cost telemetry closure maps to RRC-INV-004, RRC-INV-005, and RRC-INV-006.
- Parent execution Story binding maps to RRC-INV-007.
