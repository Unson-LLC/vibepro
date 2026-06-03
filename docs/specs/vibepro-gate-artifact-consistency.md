---
title: Gate Artifact Consistency Spec
---

# Gate Artifact Consistency Spec

## Invariants

- `INV-GAC-1`: `gate:artifact_consistency` MUST be present in every PR Gate DAG.
- `INV-GAC-2`: Missing evidence MUST NOT be reclassified as artifact inconsistency; missing evidence remains owned by the evidence-specific gate.
- `INV-GAC-3`: Recorded verification and review artifacts MUST be treated as inconsistent when they are not bound to the current git state.
- `INV-GAC-4`: `stale_evidence` MUST be an unresolved and critical PR creation blocker.

## Acceptance Paths

- `AP-GAC-1`: With current verification evidence, the Artifact Consistency Gate passes.
- `AP-GAC-2`: If source changes after verification evidence is recorded, the gate reports `stale_evidence`.
- `AP-GAC-3`: The gate lists inconsistent artifacts and required actions for regenerating evidence and rerunning `vibepro pr prepare`.

## Verification

- `V-GAC-1`: `test/vibepro-cli.test.js` covers current verification evidence passing the gate.
- `V-GAC-2`: `test/vibepro-cli.test.js` covers stale verification evidence becoming a critical unresolved gate.
