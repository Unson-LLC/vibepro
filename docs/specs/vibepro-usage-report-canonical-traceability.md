---
story_id: story-vibepro-usage-report-canonical-traceability
title: Usage Report Canonical Traceability Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Story["Story doc"] --> Resolve["resolve traceability sources"]
        Local[".vibepro/pr/<story-id>"] --> Resolve
        Canonical["docs/management/audit-artifacts/<story-id>"] --> Resolve
        Manifest["vibepro manifest merge records"] --> Resolve
        Resolve --> Report["usage report"]
        Report --> Gap["actual missing gap"]
        Report --> Resolved["alternate-source resolved"]
    rationale: "Usage report must separate true traceability gaps from evidence found on canonical or manifest surfaces."
---

# Spec

## Contracts

- `URCT-001`: `usage report` MUST resolve story traceability from local `.vibepro/pr/<story-id>`, canonical audit bundle, manifest merge records, and tracked traceability artifacts.
- `URCT-002`: Local `.vibepro` evidence MUST take precedence over canonical copies when both exist.
- `URCT-003`: Evidence found through canonical or tracked traceability sources MUST prevent `traceability_missing_pr_artifact` for that story.
- `URCT-004`: Report rows MUST expose the selected `artifact_source` and whether a gap was actual missing or alternate-source resolved.
- `URCT-005`: Aggregate traceability metrics MUST not double-count local and canonical evidence for the same story.

## Invariants

- GitHub API inference is outside this story; only local/tracked artifacts count as traceability evidence.
- Missing artifacts are not synthesized into merged evidence.
- Existing `traceability_gap_rate` remains meaningful by distinguishing actual missing from resolved alternate sources.

## Verification

- Unit coverage builds local-only, canonical-only, manifest-only, and missing fixtures.
- JSON report assertions verify `artifact_source`, actual missing count, alternate-source resolved count, and no double counting.
- Human-readable report assertions verify missing and resolved sections are separate.
