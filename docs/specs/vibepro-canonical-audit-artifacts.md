---
story_id: story-vibepro-canonical-audit-artifacts
title: Canonical Audit Artifacts Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Merge["execute merge: merged"] --> Promote["promote audit-core JSON"]
        Workspace[".vibepro PR/review artifacts"] --> Promote
        Promote --> Bundle["docs/management/audit-artifacts/<story-id>/audit-bundle.json"]
        Bundle --> Usage["usage report on main-only checkout"]
        Usage --> Handoff["engineer/agent reconstructs Story-to-PR-to-merge evidence"]
    rationale: "Flow diagram for the merge-to-canonical-audit evidence lifecycle required by CAA-CONTRACT-001 through CAA-CONTRACT-007."
---

# Spec

## Contracts

- `CAA-CONTRACT-001`: Successful `vibepro execute merge` MUST promote audit-critical JSON artifacts into `docs/management/audit-artifacts/<story-id>/`.
- `CAA-CONTRACT-002`: Promotion MUST happen only when merge status is `merged`; blocked, failed, and dry-run merge executions MUST NOT create a canonical audit bundle.
- `CAA-CONTRACT-003`: The canonical audit bundle MUST include `schema_version`, `story_id`, `source`, `promoted_at`, `canonical_dir`, `source_workspace_dir`, `artifact_policy`, `merge`, `artifacts[]`, and `missing_artifacts[]`.
- `CAA-CONTRACT-004`: Promoted PR artifacts MUST be limited to JSON audit core files: `pr-prepare.json`, `pr-create.json`, `gate-dag.json`, `pr-merge.json`, `traceability.json`, and `verification-evidence.json`.
- `CAA-CONTRACT-005`: Promoted review artifacts MUST be limited to JSON handoff core files: `review-summary.json`, `review-result-*.json`, and `lifecycle.json`.
- `CAA-CONTRACT-006`: Promotion MUST preserve readable JSON and record every copied artifact with source and canonical path.
- `CAA-CONTRACT-007`: Missing optional artifacts MUST be represented in `missing_artifacts[]`, not guessed or synthesized.

## Invariants

- `CAA-INV-001`: Canonical audit artifacts are audit evidence, not runtime input for implementation.
- `CAA-INV-002`: HTML reports, raw logs, dispatch scratch files, and temporary execution state MUST remain outside the canonical audit bundle.
- `CAA-INV-003`: Local `.vibepro/` artifacts remain authoritative for an in-progress checkout; canonical audit artifacts are the merged/main-readable replay surface.
- `CAA-INV-004`: `usage report` MUST prefer local `.vibepro/` artifacts over canonical copies when both are present, to avoid double-counting.

## Scenarios

- `CAA-SCENARIO-001`: Given a successful merge with PR and review evidence, when `execute merge` finishes, then `audit-bundle.json` and copied JSON audit files exist under `docs/management/audit-artifacts/<story-id>/`.
- `CAA-SCENARIO-002`: Given a checkout with story docs and canonical audit artifacts but no `.vibepro/pr/<story-id>`, when `usage report` runs, then the story is not reported as `traceability_missing_pr_artifact`.
- `CAA-SCENARIO-003`: Given a dry-run or blocked merge, when `execute merge` returns, then no canonical audit bundle is created.

## Verification

- `CAA-VERIFY-001`: Unit/CLI coverage asserts successful `execute merge` creates the canonical audit bundle and manifest entry.
- `CAA-VERIFY-002`: Usage report coverage asserts canonical-only artifacts satisfy traceability accounting without `.vibepro/`.
- `CAA-VERIFY-003`: Unit/CLI coverage asserts dry-run and blocked `execute merge` paths do not create a canonical audit bundle or manifest entry.
