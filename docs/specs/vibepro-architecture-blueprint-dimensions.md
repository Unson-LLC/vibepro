---
story_id: story-vibepro-architecture-blueprint-dimensions
title: Architecture Blueprint Dimensions Gate Spec
---

# Architecture Blueprint Dimensions Gate Spec

## Invariants

- `INV-ABP-1`: Required blueprint dimensions MUST be a data map keyed by story shape (`ARCHITECTURE_BLUEPRINT_DIMENSIONS`); adding a shape or dimension MUST be a data change, not control flow.
- `INV-ABP-2`: The shape detector MUST be conservative (high precision); a story whose shape is not detected MUST NOT receive `gate:architecture_blueprint`.
- `INV-ABP-3`: `gate:architecture_blueprint` (`type: architecture_blueprint_gate`) MUST be `needs_evidence` (blocking `ready_for_pr_create`) until every required dimension is addressed by the architecture evidence (architecture docs + story text) or a waiver decision is recorded against the gate source.
- `INV-ABP-4`: The gate MUST be independent of the Architecture Gate; architecture evidence MAY be `satisfied` while this gate is `needs_evidence`.
- `INV-ABP-5`: The gate MUST be non-critical (waiver-resolvable), wired `architecture -> gate:architecture_blueprint -> code`, and MUST keep `gate:dag_connectivity` `passed`.
- `INV-ABP-6`: Coverage analysis MUST read repository files only and MUST NOT execute or contact external systems.

## Scenarios

- `S-ABP-1`: A `workflow_scheduler` story with no architecture coverage yields `gate:architecture_blueprint` = `needs_evidence` listing `scheduling_owner` and `job_infrastructure` as missing, with the Architecture Gate still `satisfied`.
- `S-ABP-2`: An architecture doc that addresses scheduling owner and job infrastructure resolves the gate to `passed` without a waiver.
- `S-ABP-3`: A waiver decision recorded against `gate:architecture_blueprint` resolves the gate to `passed`.
- `S-ABP-4`: A non-scheduler story does not receive the gate.

## Anti-Patterns

- `AP-ABP-1`: Do not make blueprint dimensions a universal checklist for every story; gate only on detected shapes.
- `AP-ABP-2`: Do not hardcode the dimension list in control flow; keep it in the data map.
- `AP-ABP-3`: Do not couple this gate to the Architecture Gate's status; they are independent.
- `AP-ABP-4`: Do not make the gate a hard wall; it is waiver-resolvable with an audit trail.

## Verification

- `V-ABP-1`: A test asserts a scheduler story missing the dimensions is `needs_evidence` (Architecture Gate satisfied), blocks PR creation, lists both missing dimensions, and is resolved by a waiver.
- `V-ABP-2`: A test asserts an architecture doc covering the dimensions resolves the gate without a waiver, and a non-scheduler story does not receive the gate.
- `V-ABP-3`: `node --check src/pr-manager.js` passes.
