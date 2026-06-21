---
story_id: story-vibepro-engineering-judgment-activation-precision
title: Engineering Judgment Activation Precision Spec
---

# Spec

## Required Behavior

- `EJAP-001`: each `judgment_axes[]` item MUST include `activation_candidates[]`, `activation_signals[]`, and `activation_precision`.
- `EJAP-002`: `activation_precision` MUST include `status`, `reason`, `candidate_count`, and `non_text_signal_count`.
- `EJAP-003`: an axis with only `text:*` candidates MUST remain `inactive`.
- `EJAP-004`: `public_contract` MUST require at least one non-text activation signal from `pr_route`, `file_group`, `network_contract`, or `changed_path`.
- `EJAP-005`: `execution_topology`, `rollback_sensitive`, `release_ops`, `security_boundary`, `data_state`, `ux_surface`, and `performance_semantic` MUST require at least one non-text activation signal.
- `EJAP-006`: when an axis is suppressed by precision filtering, its `activation_candidates[]` MUST still be emitted for auditability.
- `EJAP-007`: human-readable PR reasoning MUST distinguish active signals from suppressed candidates.

## Scenarios

- `S-001`: Given a Story body mentions review/workflow words but the diff only changes prose docs, when `pr prepare` runs, then `execution_topology` stays `inactive` and `activation_precision.status=insufficient_signal`.
- `S-002`: Given a diff changes agent/workflow runtime files, when `pr prepare` runs, then `execution_topology` becomes active with at least one `changed_path:*` or `risk_surface:*` activation signal.
- `S-003`: Given a Story mentions CLI/output contract and the PR route is runtime change, when `pr prepare` runs, then `public_contract` becomes active because non-text corroboration exists.

## Non Goals

- Replacing the current axis list.
- Introducing probabilistic activation scoring from external services.
