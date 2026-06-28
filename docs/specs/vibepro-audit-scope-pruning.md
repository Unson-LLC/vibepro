---
story_id: story-vibepro-audit-scope-pruning
title: Audit Scope Pruning Spec
parent_design: vibepro-audit-scope-pruning
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        Raw["local full .vibepro artifacts"] --> RefScan["raw reference scan"]
        Raw --> Scope["canonical audit scope"]
        Scope --> Summary["judgment evidence summary"]
        Scope --> Excluded["debug/replay-only excluded"]
        Summary --> Canonical["canonical audit artifacts"]
        RefScan --> Handoff["handoff references"]
---

# Spec

## Invariants

- `ASP-INV-001`: Canonical audit evidence is for validating engineering
  judgment, not for preserving every local debug structure.
- `ASP-INV-002`: Local full artifacts may remain in `.vibepro`, but canonical
  audit data must be scoped to judgment, verification, review, traceability,
  merge, and cost evidence.
- `ASP-INV-003`: Handoff reference discovery must use raw source artifacts before
  pruning so audit scope reduction does not hide referenced evidence.

## Contracts

- `ASP-CONTRACT-001`: `pr_prepare`, `pr_create`, `pr_merge`, `gate_dag`,
  `senior_gap_judgment`, and `verification_evidence` are normalized through
  `judgment_evidence_v1` before canonical persistence or compressed replay.
- `ASP-CONTRACT-002`: Canonical audit inventory records raw digest and raw line
  count separately from audit digest and scoped audit line count.
- `ASP-CONTRACT-003`: Scoped PR lifecycle artifacts replace duplicated full gate
  DAGs with summaries and preserve final status, blockers, waivers, decisions,
  verification, and cost accounting.
- `ASP-CONTRACT-004`: Scoped design-SSOT evidence preserves counts and changed
  docs, but excludes full registered/unregistered inventory lists.
- `ASP-CONTRACT-005`: Scoped engineering judgment evidence preserves active axes
  and evidence refs, but excludes inactive axis detail and verbose evidence
  payloads.

## Scenarios

- `ASP-SCENARIO-001`: A PR artifact with full design inventory is promoted to a
  canonical summary that keeps counts and changed docs but omits
  `unregistered_docs`.
- `ASP-SCENARIO-002`: A PR artifact with inactive judgment axes is promoted to a
  canonical summary that records inactive count but does not keep inactive
  matched evidence.
- `ASP-SCENARIO-003`: A pruned PR artifact still resolves `.vibepro/...`
  handoff references discovered in the raw source artifact.
- `ASP-SCENARIO-004`: Over-budget canonical replay remains possible with scoped
  audit summaries and raw digests.

## Anti-Patterns

- `ASP-AP-001`: Do not count pretty-printed debug JSON lines as audit evidence.
- `ASP-AP-002`: Do not persist HTML reports or UI cockpit data as canonical
  audit evidence.
- `ASP-AP-003`: Do not duplicate full gate DAGs inside every lifecycle artifact.
- `ASP-AP-004`: Do not remove raw digest/reference provenance when pruning
  canonical audit data.

## Verification

- `ASP-VERIFY-001`: Canonical audit tests prove scoped summaries omit debug
  inventory and verbose evidence payloads.
- `ASP-VERIFY-002`: Existing canonical replay tests prove compact replay and
  corruption detection still work.
- `ASP-VERIFY-003`: Existing handoff reference tests prove raw reference
  discovery survives pruning.

