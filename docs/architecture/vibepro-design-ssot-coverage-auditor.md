---
title: VibePro Design SSOT Coverage Auditor Architecture
status: active
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-design-ssot-coverage-auditor
---

# VibePro Design SSOT Coverage Auditor Architecture

## Decision

Extend Design SSOT reconciliation with a coverage auditor. Reconciliation already
checks known root/child lineage. Coverage answers the prior question: whether a
changed design-like document is inside that lineage graph at all.

The auditor is deterministic and path/frontmatter based. It does not infer
semantic contradictions. It reports repository-wide coverage debt, but only
changed unregistered design docs become `needs_review` action items.

## Design-Doc Candidate Model

The first coverage slice treats these paths as design-doc candidates:

- `docs/architecture/**/*.md` as architecture or ADR candidates.
- `docs/management/stories/**/*.md` and `docs/stories/**/*.md` as Story candidates.
- `docs/specs/**/*.md` as Spec candidates.
- `docs/design/**/*.md` as UX candidates.
- `docs/workflows/**/*.md` as workflow candidates.
- `docs/data-models/**/*.md` as data-model candidates.
- Markdown files with `parent_design`, `design_root`, or `design_roots` frontmatter.

## Gate Behavior

```text
changed paths
  -> Design SSOT coverage scan
  -> registered root/child lookup
  -> changed unregistered design docs become needs_review action items
  -> gate:design_ssot_reconciliation
```

Repository-wide unregistered docs stay visible in summary counts so operators can
plan registry expansion, but they do not block unrelated PRs.

## Evidence Contract

`design-ssot reconcile` and `pr prepare` include:

- `coverage.summary.total_design_doc_count`
- `coverage.summary.registered_doc_count`
- `coverage.summary.unregistered_doc_count`
- `coverage.summary.changed_unregistered_design_doc_count`
- `coverage.unregistered_changed_docs[]`

## Failure Modes

- Missing registry remains `not_applicable`; the auditor does not make adoption all-or-nothing.
- Changed unregistered design docs are `needs_review`, not `block`, because the correct fix might be linking the doc or explicitly deciding it is out of scope.
- Historical coverage debt is summarized but not promoted to PR-blocking action items.
