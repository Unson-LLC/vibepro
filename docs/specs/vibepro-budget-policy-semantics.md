---
story_id: story-vibepro-budget-policy-semantics
title: Canonical Audit Budget Policy Semantics Spec
parent_design: vibepro-budget-policy-semantics
related_architecture:
  - ../architecture/vibepro-budget-policy-semantics.md
---

# Canonical Audit Budget Policy Semantics Spec

## Invariants

- `BPOL-INV-001`: Canonical cost accounting MUST keep audit artifact changed
  lines out of the product changed-line denominator.
- `BPOL-INV-002`: Unavailable diff, token, or elapsed-time evidence MUST remain
  unavailable rather than becoming `0`.

## Contracts

- `BPOL-CONTRACT-001`: Normal canonical audit cost budget MUST treat persisted
  canonical artifacts with `artifact_code_ratio <= 3` as within policy.
- `BPOL-CONTRACT-002`: Normal canonical audit cost budget MUST keep
  `artifact_code_ratio > 3` as `budget_status = exceeded`.
- `BPOL-CONTRACT-003`: Compact canonical audit promotion MUST recompute
  `budget_status` using the same effective 3x line budget after persisted
  artifact lines are known.
- `BPOL-CONTRACT-004`: The fixed `canonical_artifact_lines` threshold MUST be
  a minimum absolute guard, not a stricter cap than the relative 3x budget when
  product changed-line stats are available.

## Scenarios

- `BPOL-S-001`: Given a compact canonical audit has 710 persisted artifact
  lines and 269 product changed lines, when cost summary is computed, then the
  ratio is `2.639` and the story is within budget.
- `BPOL-S-002`: Given persisted artifact lines exceed 3x product changed
  lines, when cost summary is computed, then `artifact_code_ratio_exceeded`
  remains present.
- `BPOL-S-003`: Given raw evidence is compacted during canonical promotion,
  when the persisted compact line count is recomputed, then budget status uses
  the same effective policy as standalone cost accounting.

## Anti-patterns

- `BPOL-AP-001`: Do not make the fixed line cap a hard failure when the ratio
  is within the accepted 2-3 range.
- `BPOL-AP-002`: Do not loosen the ratio beyond 3 for routine normal-risk
  stories.

## Verification

- `test/evidence-cost-budget.test.js` covers `BPOL-CONTRACT-001` and
  `BPOL-CONTRACT-002`.
- `test/canonical-audit-self-contained.test.js` covers `BPOL-CONTRACT-003`.
