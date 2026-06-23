---
story_id: story-vibepro-canonical-audit-diff-stats
title: Canonical Audit Diff Stats Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Merge["execute merge result"] --> Resolve["resolve base/head/merge refs"]
        Resolve --> Numstat["collect per-file numstat"]
        Numstat --> Classify["classify changed lines by bucket"]
        Classify --> Cost["build canonical cost summary"]
        Cost --> Bundle["audit-bundle / audit-index"]
        Bundle --> Usage["usage report / value audit"]
---

# Spec

## Contracts

- `CADS-CONTRACT-001`: `execute merge` MUST pass per-file diff statistics into canonical audit promotion when the merge result identifies a base/head or merge commit.
- `CADS-CONTRACT-002`: Diff statistics MUST be stored with provenance: command or API source, base ref, head ref, merge commit when known, collected_at, and status.
- `CADS-CONTRACT-003`: Missing diff statistics MUST be represented as `diff_stats_status: unavailable` with a reason; unavailable data MUST NOT be converted to zero changed lines.
- `CADS-CONTRACT-004`: Changed lines MUST be bucketed into `src`, `test`, `story_spec_architecture_docs`, `audit_artifacts`, and `other` using the same classifier as evidence cost reporting.
- `CADS-CONTRACT-005`: `artifact_code_ratio` MUST be `null` when the denominator is zero or unavailable, and MUST include a machine-readable reason.
- `CADS-CONTRACT-006`: `usage report` MUST render bucketed changed-line data from canonical audit bundles before falling back to local `.vibepro` artifacts.
- `CADS-CONTRACT-007`: The implementation MUST NOT mutate historical raw PR artifacts to make ratios look complete.

## Scenarios

- `CADS-SCENARIO-001`: Given a merged PR with `src/` and `test/` changes, when `execute merge` promotes canonical audit artifacts, then `cost_summary.changed_lines.by_bucket.src` and `test` are non-zero.
- `CADS-SCENARIO-002`: Given a docs-only Story, when canonical audit is promoted, then story/spec/architecture docs lines are counted separately from audit artifacts.
- `CADS-SCENARIO-003`: Given numstat collection fails, when canonical audit is promoted, then the bundle records `diff_stats_status: unavailable` and usage report prints `未確認`.
- `CADS-SCENARIO-004`: Given an audit-only post-merge persistence commit, when ratio is calculated, then audit artifact lines are not mistaken for product code lines.

## Verification

- `CADS-VERIFY-001`: Unit test covers `buildCanonicalEvidenceCostSummary` with real per-file diff stats.
- `CADS-VERIFY-002`: Execute-merge regression test asserts promoted canonical artifacts contain non-zero bucketed stats for a fixture PR.
- `CADS-VERIFY-003`: Usage-report test asserts bucketed values and unavailable reasons are rendered.
- `CADS-VERIFY-004`: Regression test asserts unavailable diff stats do not produce fake `0` product lines.
