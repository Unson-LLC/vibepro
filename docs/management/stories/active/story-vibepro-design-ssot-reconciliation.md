---
story_id: story-vibepro-design-ssot-reconciliation
title: Design SSOT Registry / Reconciliation Gate
status: active
view: dev
period: 2026-06
source:
  type: github_issue
  id: 232
  url: https://github.com/Unson-LLC/vibepro/issues/232
parent_design: vibepro-design-ssot-reconciliation
architecture_docs:
  - docs/architecture/vibepro-design-ssot-reconciliation.md
spec_docs:
  - docs/specs/vibepro-design-ssot-reconciliation.md
created_at: 2026-06-26
updated_at: 2026-06-26
---

# Story

VibePro already checks Story / Architecture / Spec / Requirement / Responsibility
Authority, but it cannot reconstruct which central design document owns which
ADR, Architecture, Story, Spec, or UX child document. When a root design document
changes, another engineer or agent still has to infer whether child artifacts are
stale.

VibePro should add a machine-readable Design SSOT lineage registry and a
reconciliation gate that projects root/child design-doc gaps into PR readiness
without replacing Story, Architecture, Spec, Responsibility Authority, or the
VibePro-native Design System.

## Acceptance Criteria

- [ ] A repo-committed Design SSOT registry can store design roots and child docs.
- [ ] `vibepro design-ssot init|link|status|reconcile` can create, inspect, and reconcile the registry.
- [ ] `.vibepro/design-ssot/` remains generated artifact output, not the only registry authority.
- [ ] `vibepro pr prepare` emits `gate:design_ssot_reconciliation`.
- [ ] Gate DAG routes `gate:path_surface_matrix -> gate:design_ssot_reconciliation -> gate:responsibility_authority -> gate:requirement`.
- [ ] Root-only changes, missing required children, missing `parent_design`, stale root hash bindings, and accepted ADR supersession conflicts become action items.
- [ ] Deterministic conflicts can block; heuristic semantic concerns are not auto-blocked by LLM-only judgment.
- [ ] PR artifacts include a concise `design-ssot-reconciliation.json` reference.

## Non Goals

- Automatically rewriting Markdown docs.
- Treating a free-form central design doc as the only product authority.
- Replacing Design System, Responsibility Authority, Requirement, Story, Architecture, or Spec gates.
- Using LLM-only semantic contradiction detection as a blocking gate.
