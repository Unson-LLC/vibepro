# Planning review #7 — architecture_boundary

- agent: codex/grs_planning7_arch
- status: needs_changes
- inspected: current Story, Architecture, Spec, test plan, readiness, existing `startExecution` and managed-worktree persistence boundaries

## Findings

1. The proposed failed-bootstrap execution id was not implementable because existing legacy execution state does not persist or return `execution_id`; the contract must define an additive persisted identity or a stable exact identity tuple.
2. The formal Spec lacked the public `linked_copy_not_configured` nonmutation contract.
3. The Architecture and Spec threat-model diagram still showed managed metadata as an unconditional authority selector and omitted the narrowly validated `source_fallback` exception.

The reviewer confirmed that the authority-kind separation, existing-unavailable fail-closed behavior, managed-authority loss, allowed control roots, mirror recovery, strict IDs, Gate authority, and legacy status compatibility were otherwise consistent.
