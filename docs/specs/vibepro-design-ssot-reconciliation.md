---
title: VibePro Design SSOT Reconciliation Spec
status: draft
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-design-ssot-reconciliation
parent_design: vibepro-design-ssot-reconciliation
---

# VibePro Design SSOT Reconciliation Spec

## Invariants

- `DSSOT-INV-001`: VibePro MUST support a repo-committed Design SSOT registry source. `.vibepro/design-ssot/` MUST be treated as generated artifact output, not the only durable authority.
- `DSSOT-INV-002`: The registry MUST model design roots and child docs without replacing Story, Architecture, Spec, Requirement, Responsibility Authority, or Design System gates.
- `DSSOT-INV-003`: Reconciliation MUST prefer deterministic checks over LLM-only semantic contradiction claims.
- `DSSOT-INV-004`: A missing registry MUST be `not_applicable` so existing repositories can adopt the feature gradually.
- `DSSOT-INV-005`: A configured design root with missing required children or deterministic accepted ADR supersession conflict MUST be visible before PR creation.

## Contracts

- `DSSOT-CONTRACT-001`: `design-ssot.json`, `design-ssot/index.json`, `docs/design-ssot.json`, `docs/design-ssot/*.json`, and `docs/management/design-ssot/*.json` are registry sources.
- `DSSOT-CONTRACT-002`: A design root contains `id`, `title`, `root_doc`, optional `required_child_kinds`, and `children` grouped by child kind.
- `DSSOT-CONTRACT-003`: `vibepro design-ssot init|link|status|reconcile` exposes registry lifecycle operations.
- `DSSOT-CONTRACT-004`: `pr prepare` writes `.vibepro/pr/<story-id>/design-ssot-reconciliation.json`.
- `DSSOT-CONTRACT-005`: Gate DAG includes `gate:design_ssot_reconciliation` before `gate:responsibility_authority`.

## Scenarios

- `DSSOT-S-001`: Given a registry root and child docs with matching `parent_design`, when `design-ssot reconcile` runs, then status is `passed`.
- `DSSOT-S-002`: Given the root design doc changed and linked children did not, when `design-ssot reconcile --base <ref>` runs, then an action item with `root_only_change` appears.
- `DSSOT-S-003`: Given a required child is missing, when reconciliation runs, then status is `block`.
- `DSSOT-S-004`: Given a linked child lacks `parent_design`, when reconciliation runs, then status is `needs_review`.
- `DSSOT-S-005`: Given `pr prepare` runs on a registry-backed design change, then the Gate DAG includes `gate:design_ssot_reconciliation` before Responsibility Authority.

## Anti-patterns

- `DSSOT-AP-001`: A local-only `.vibepro/design-ssot/registry.json` is treated as the only registry authority.
- `DSSOT-AP-002`: VibePro auto-rewrites Story/Spec/Architecture docs to force consistency.
- `DSSOT-AP-003`: LLM-only interpretation blocks PR readiness without deterministic lineage evidence.
- `DSSOT-AP-004`: Design SSOT is confused with VibePro-native Design System authority.

## Verification

- `DSSOT-V-001`: Unit tests cover `design-ssot init|link|status|reconcile`.
- `DSSOT-V-002`: Unit tests cover root-only change action item generation.
- `DSSOT-V-003`: PR prepare tests cover `gate:design_ssot_reconciliation` DAG placement.
- `DSSOT-V-004`: Typecheck covers new CLI/module imports.
