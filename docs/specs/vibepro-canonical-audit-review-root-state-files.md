---
spec_id: vibepro-canonical-audit-review-root-state-files
story_id: story-vibepro-canonical-audit-review-root-state-files
title: Canonical audit review-root state file tolerance contract
status: final
parent_design:
  - vibepro-canonical-audit-review-root-state-files
created_at: 2026-07-22
updated_at: 2026-07-22
---

# Canonical audit review-root state file tolerance contract

Human-readable mirror of the registered Spec
`.vibepro/spec/story-vibepro-canonical-audit-review-root-state-files/spec.json` (4 clauses).

## Contract surface

The public CLI contract (`docs/reference/cli.md`) is unchanged by this Story. The
contract fixed here is the internal promotion contract between the review
authorize flow (`src/agent-review.js`) and canonical audit promotion
(`src/canonical-audit.js` `safeReaddirDirectories`), which `vibepro execute merge`
depends on.

## Clauses

- **S-001** (scenario): Given `.vibepro/reviews/<story-id>/` containing
  `dispatch-authorizations.json` next to stage directories, canonical audit
  promotion succeeds and stage artifacts (review requests/results/lifecycle)
  are still collected.
- **S-002** (scenario): Any story-level state file matching
  `[A-Za-z0-9_-]+\.json` directly under the review root is tolerated.
- **S-003** (scenario): Dot entries (stale `.dispatch.lock` lock directory,
  `.DS_Store`) are skipped — never listed as review stages, never an error.
- **INV-001** (invariant): A non-directory entry matching none of the tolerated
  patterns — for example an extensionless file named like a stage (`gate`) —
  still fails promotion loudly with an `ENOTDIR` error. The tolerance must not
  mask a corrupted review tree.

## Compatibility

- Trees that promoted successfully before this change (stage directories plus
  `*-final.md` compatibility markdown only) promote byte-identically.
- No collection pattern under stage directories (`REVIEW_AUDIT_FILES`,
  `REVIEW_HANDOFF_FILES`) changes.
- Rollback: revert the tolerance branches in `safeReaddirDirectories` to
  restore the previous fail-closed behavior.

## Verification

- `test/canonical-audit-self-contained.test.js` cases `CARS-S-1`, `CARS-S-2`,
  `CARS-S-3`, and the pre-existing ENOTDIR regression case cover the clauses.
- A merge-flow replay against a fixture mirroring the 2026-07-22
  `story-vibepro-target-architecture-conformance` failure is recorded as e2e
  verification evidence.
