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

## Implementation Scenarios

- Scenario `URCT-S-001`: Given a Story has no local `.vibepro/pr/<story-id>` directory but has a canonical audit bundle with `pr-prepare.json` and `pr-merge.json`, `usage report --json` marks the Story as prepared/merged evidence present, sets `traceability_resolution.status=alternate_source_resolved`, sets `artifact_source=canonical_audit`, and does not emit `traceability_missing_pr_artifact`.
- Scenario `URCT-S-002`: Given a Story has no local, canonical, manifest, or tracked traceability evidence, `usage report --json` sets `traceability_resolution.status=actual_missing` and increments `actual_missing_traceability_gap_count`.
- Scenario `URCT-S-003`: Given local and canonical evidence both exist for the same artifact key, the local artifact wins and aggregate traceability metrics do not double count that Story.
