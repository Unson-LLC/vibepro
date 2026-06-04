---
title: PR Scope Judgment Gate Architecture
summary: "Promotes PR reviewability and Story split judgment into a first-class Gate DAG node."
---

# PR Scope Judgment Gate Architecture

## Context

VibePro already calculates scope and split plans, but those results were surfaced as PR context rather than a required Gate DAG node. Recent reviews blocked broad multi-story diffs before detailed evidence review.

## Design

`gate:pr_scope_judgment` sits immediately after the common Engineering Judgment spine and before route-specific triage. It reuses existing `assessScope` results and file group classification.

The expected edge order is `gate:common_judgment_spine -> gate:pr_scope_judgment -> gate:bug_physics_triage`, so DAG connectivity tests assert the scope judgment as an explicit engineering decision point.

The gate classifies scope as:

- `focused`
- `large_but_coherent`
- `needs_split`

`needs_split` becomes a critical unresolved gate, preventing PR creation until the branch is narrowed or split.

## Boundary

This gate does not automatically split commits or branches. It produces split suggestions and required actions; the user or agent must reduce scope and rerun `vibepro pr prepare`.
