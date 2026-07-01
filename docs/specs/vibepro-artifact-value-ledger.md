---
story_id: story-vibepro-artifact-value-ledger
title: Artifact Value Ledger Spec
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
parent_design: vibepro-artifact-value-ledger
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Prepare["pr prepare"]
        EvidenceReuse["evidence-reuse artifact value ledger"]
        SeniorGap["senior gap judgment"]
        UsageReport["usage report"]
        Responsibility["responsibility authority"]
        Prepare --> EvidenceReuse
        EvidenceReuse --> SeniorGap
        EvidenceReuse --> UsageReport
        Prepare --> Responsibility
  - kind: threat_model
    mermaid: |
      flowchart LR
        Actor["developer or automation"]
        Artifact["PR evidence artifacts"]
        Gate["VibePro gates"]
        Risk["false workflow risk inflation"]
        Actor --> Artifact
        Artifact --> Gate
        Risk --> Gate
        Gate --> Actor
---

# Artifact Value Ledger Spec

## Invariants

- `INV-AVL-1`: Each generated ledger entry MUST bind an artifact to a named consumer and a decision it supports.
- `INV-AVL-2`: Ledger head binding MUST include current head SHA when git context is available.
- `INV-AVL-3`: Missing ledger state MUST remain explicit and MUST NOT be interpreted as zero artifact cost or zero artifact value.
- `INV-AVL-4`: Usage reporting MUST expose decision-bound artifact counts separately from raw evidence-reuse hit/miss counts.
- `INV-AVL-5`: Read-only audit reporting changes to ledger, senior gap judgment, or usage report MUST remain on the developer_tool route unless non-reporting source surfaces are changed.
- `INV-AVL-6`: Read-only audit reporting responsibilities MUST NOT require high-risk workflow replay evidence when current unit regression and current head binding are present.

## Verification

- `V-AVL-1`: `test/evidence-summary-reuse.test.js` verifies ledger generation and usage-report aggregation.
- `V-AVL-2`: `test/senior-gap-judgment.test.js` verifies senior-gap cost context and decision card integration.
- `V-AVL-3`: `test/responsibility-authority.test.js` verifies read-only audit reporting responsibility evidence semantics.
