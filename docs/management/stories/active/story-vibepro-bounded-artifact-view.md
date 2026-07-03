---
story_id: story-vibepro-bounded-artifact-view
title: "Bounded artifact projection views for LLM handoff"
status: active
view: dev
period: 2026-07
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-07-03-BOUNDED-LLM-VIEW
  title: "Full artifact dumps should not be the default LLM handoff input"
related_stories:
  - story-vibepro-evidence-cost-budget
  - story-vibepro-audit-scope-pruning
  - story-vibepro-engineering-judgment-evidence-strength
parent_design:
  - vibepro-bounded-artifact-view
architecture_docs:
  - docs/architecture/vibepro-bounded-artifact-view.md
spec_docs:
  - docs/specs/vibepro-bounded-artifact-view.md
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Story

VibePro keeps full PR artifacts so that decisions can be audited later. The problem identified in value audit is not the existence of large machine artifacts; it is making those full dumps the default text that an LLM must read for handoff, review, or follow-up.

The default agent handoff should start from a bounded projection: enough status, blockers, traceability, and artifact references to decide what to inspect next. Full `pr-prepare.json`, Gate DAG, design reconciliation, or senior-gap artifacts remain durable evidence and are opened only by targeted path or gate id.

## User Story

**As a** VibePro user handing PR readiness work to another engineer or agent<br>
**I want to** pass a small, explicit `pr prepare` projection before any full artifact dump<br>
**So that** LLM token use goes to judgment and targeted drill-down instead of rereading large generated evidence by default

## Scope

- Add CLI output for a bounded default LLM projection from `pr prepare`.
- Keep `--json` as the full durable artifact output for tooling and audit replay.
- Add focused views for readiness, blocking gates, gate evidence, traceability, design SSOT, and senior-gap inspection.
- Update docs and onboarding text so agents are instructed to start from the bounded view.
- Preserve deep artifact references for targeted follow-up.

## Acceptance Criteria

- [ ] `vibepro pr prepare --summary-json` emits a bounded JSON projection and does not include full diagnostics or full Gate DAG nodes/edges.
- [ ] `vibepro pr prepare --view blocking-gates` emits only focused blocking-gate context, not the full `pr-prepare.json`.
- [ ] Existing `vibepro pr prepare --json` behavior remains full output for durable evidence consumers.
- [ ] README and CLI help direct AI/LLM handoff to `--summary-json` or focused `--view` before full artifact drill-down.
- [ ] The projection includes artifact references so a reviewer can open full evidence only when a specific gate, path, or risk requires it.
- [ ] Existing canonical audit accounting reuse remains valid when `currentAccountingSignature === previousAccountingSignature`; bounded LLM views must not force full artifact rereads for unchanged accounting signatures.

## Non Goals

- Deleting or weakening canonical audit artifacts.
- Treating artifact line count as the main cost metric.
- Weakening Engineering Judgment, Agent Review, or traceability gates.
