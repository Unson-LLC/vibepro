---
story_id: story-vibepro-design-ssot-coverage-auditor
title: Design SSOT Registry Coverage Auditor
status: active
view: dev
period: 2026-06
source:
  type: github_issue
  id: 232
  url: https://github.com/Unson-LLC/vibepro/issues/232
parent_design: vibepro-design-ssot-coverage-auditor
architecture_docs:
  - docs/architecture/vibepro-design-ssot-coverage-auditor.md
spec_docs:
  - docs/specs/vibepro-design-ssot-coverage-auditor.md
created_at: 2026-06-26
updated_at: 2026-06-26
---

# Story

VibePro now has a Design SSOT registry and reconciliation gate, but that gate is
only as strong as the registered design roots and child links. A repository can
still change an Architecture, ADR, Story, Spec, UX, workflow, or data-model doc
that is not covered by the registry, and the gate will appear clean because the
document is outside the known lineage graph.

VibePro should audit Design SSOT registry coverage and surface changed design
documents that are not registered, without turning the entire historical backlog
of unregistered docs into an immediate blocker.

## Acceptance Criteria

- [ ] `DSSOT-COV-AC-001`: `vibepro design-ssot coverage` reports design-doc coverage counts from repo-committed registry sources.
- [ ] `DSSOT-COV-AC-002`: Coverage distinguishes registered roots, registered children, unregistered design-doc candidates, and changed unregistered design docs.
- [ ] `DSSOT-COV-AC-003`: `design-ssot reconcile --base <ref>` includes coverage summary and action items.
- [ ] `DSSOT-COV-AC-004`: Changed unregistered design docs produce `needs_review`, while old unregistered docs remain visible as non-blocking coverage debt.
- [ ] `DSSOT-COV-AC-005`: `pr prepare` carries Design SSOT coverage into `.vibepro/pr/<story-id>/design-ssot-reconciliation.json` and the Gate DAG.
- [ ] `DSSOT-COV-AC-006`: Tests cover CLI coverage, changed unregistered docs, and PR prepare coverage propagation.

## Non Goals

- Auto-registering every discovered Markdown file.
- Treating repository-wide historical coverage debt as a merge blocker.
- Using LLM-only semantic contradiction detection as a blocking signal.
