---
story_id: story-vibepro-canonical-audit-cost-accounting
title: Canonical Audit Cost Accounting Spec
parent_design: vibepro-canonical-audit-cost-accounting
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Session["session / merge usage data"] --> Merge["execute merge result"]
        Merge --> Extract["canonical audit accounting extraction"]
        Extract --> Normalize["normalize token and elapsed time"]
        Normalize --> Cost["cost_summary"]
        Cost --> Bundle["audit-bundle / audit-index"]
        Bundle --> Audit["usage report / value audit"]
---

# Spec

## Contracts

- `CACOST-CONTRACT-001`: `buildCanonicalEvidenceCostSummary` MUST accept optional
  `tokenAccounting` and `elapsedTimeAccounting` inputs.
- `CACOST-CONTRACT-002`: Token accounting MUST preserve `total_tokens`, `input_tokens`,
  `output_tokens`, `cached_input_tokens`, `source`, and `window` when provided.
- `CACOST-CONTRACT-003`: If `total_tokens` is absent but both input and output tokens are present,
  total tokens MUST be inferred as their sum.
- `CACOST-CONTRACT-004`: If only partial token data exists, the token accounting status MUST be
  `partial` unless an explicit non-unavailable status is supplied.
- `CACOST-CONTRACT-005`: Elapsed-time accounting MUST preserve `elapsed_ms`, `started_at`,
  `finished_at`, `source`, and `window` when provided.
- `CACOST-CONTRACT-006`: If `elapsed_ms` is absent but valid start and finish timestamps are present,
  elapsed_ms MUST be inferred from that interval.
- `CACOST-CONTRACT-007`: Missing or invalid accounting inputs MUST remain unavailable with a
  machine-readable reason; unknown values MUST NOT become zero.
- `CACOST-CONTRACT-008`: `promoteCanonicalAuditArtifacts` MUST extract accounting from merge result
  shapes used by VibePro automation: `cost_accounting`, direct accounting fields, `usage`, and
  `session`.
- `CACOST-CONTRACT-009`: Compact canonical decision summaries MUST print token/time status and
  measured values when available.

## Scenarios

- `CACOST-SCENARIO-001`: Given a merge result with `cost_accounting.token_accounting.total_tokens`,
  when canonical artifacts are promoted, then the bundle cost summary stores that total and source.
- `CACOST-SCENARIO-002`: Given a merge result with start and finish timestamps but no elapsed_ms,
  when canonical artifacts are promoted, then elapsed_ms is inferred and persisted.
- `CACOST-SCENARIO-003`: Given no accounting input, when canonical artifacts are promoted, then token
  and time accounting remain unavailable with reasons.
- `CACOST-SCENARIO-004`: Given over-budget evidence that compacts into a decision index, when a value
  audit reads the summary, then token/time status is visible without decompressing the replay bundle.

## Verification

- `CACOST-VERIFY-001`: Unit test covers available token accounting and elapsed-time inference.
- `CACOST-VERIFY-002`: Regression test covers unavailable fallback.
- `CACOST-VERIFY-003`: Canonical audit promotion test asserts merge cost accounting is persisted in
  bundle, index, replay bundle, and decision summary.
