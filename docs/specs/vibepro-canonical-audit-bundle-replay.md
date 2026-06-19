---
story_id: story-vibepro-canonical-audit-bundle-replay
title: Canonical Audit Bundle Replay Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Merge["execute merge succeeds"] --> Promote["promote audit core JSON"]
        Promote --> Canonical["docs/management/audit-artifacts/<story-id>"]
        Canonical --> Fresh["fresh main checkout"]
        Fresh --> Usage["usage report / audit replay"]
        Usage --> Decision["Story-to-PR-to-merge judgment reconstructed"]
    rationale: "The replay contract starts at a successful merge and ends with a fresh checkout reconstructing the same audit judgment from tracked JSON."
---

# Spec

## Contracts

- `CABR-001`: A successful `vibepro execute merge` MUST create `docs/management/audit-artifacts/<story-id>/audit-bundle.json`.
- `CABR-002`: The bundle MUST list every promoted artifact with source path, canonical path, artifact kind, and copy status.
- `CABR-003`: PR core JSON includes `pr-prepare.json`, `pr-create.json`, `gate-dag.json`, `verification-evidence.json`, `traceability.json`, and `pr-merge.json` when present.
- `CABR-004`: Review core JSON includes `review-summary.json`, `review-result-*.json`, and `lifecycle.json` when present.
- `CABR-005`: Fresh checkout replay MUST reconstruct PR URL, merge commit, verification status, and review summary without `.vibepro/pr/<story-id>`.
- `CABR-006`: Missing optional artifacts MUST be represented explicitly instead of synthesized.

## Invariants

- Canonical audit bundles are merge evidence, not implementation input.
- HTML reports, raw transcripts, dispatch scratch, and temporary execution state remain outside the bundle.
- Local `.vibepro` artifacts remain authoritative while work is in progress.

## Verification

- Unit coverage creates a successful merge fixture and asserts the bundle manifest plus copied JSON files.
- Usage report coverage runs with only canonical artifacts and asserts no missing PR artifact gap for the merged story.
- Negative coverage confirms dry-run, blocked, and failed merge paths do not create canonical bundles.
