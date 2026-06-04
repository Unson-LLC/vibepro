---
title: Path Surface Matrix Gate Spec
---

# Path Surface Matrix Gate Spec

## Invariants

- `INV-PSM-1`: `gate:path_surface_matrix` MUST be present in the PR Gate DAG.
- `INV-PSM-2`: Workflow-heavy changes MUST NOT pass when changed UI/API/report/persistence surfaces lack current evidence.
- `INV-PSM-3`: `partial_surface` MUST be an unresolved critical PR gate.
- `INV-PSM-4`: Light changes MUST NOT be overblocked when a row is informational only.

## Acceptance Paths

- `AP-PSM-1`: Workflow-heavy UI/API changes without surface evidence produce `partial_surface`.
- `AP-PSM-2`: Missing surfaces are listed in `missing_surfaces`.
- `AP-PSM-3`: PR Gate required actions tell the user to record current path/surface evidence.

## Verification

- `V-PSM-1`: `test/risk-adaptive-gate.test.js` asserts UI/API workflow-heavy rows are missing without current evidence.
