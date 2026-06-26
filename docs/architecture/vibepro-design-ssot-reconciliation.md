---
title: VibePro Design SSOT Reconciliation Architecture
status: draft
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-design-ssot-reconciliation
---

# VibePro Design SSOT Reconciliation Architecture

## Decision

Add a Design SSOT lineage registry and reconciliation gate. The registry is a
machine-readable index of design roots and their child artifacts. It is not a
new monolithic design document and does not replace Story, Architecture, Spec,
Requirement Consistency, Responsibility Authority, or the VibePro-native Design
System.

The durable registry source is repo-committed, such as `design-ssot.json` or
`docs/design-ssot/*.json`. `.vibepro/design-ssot/` is generated evidence output
for snapshots and reconciliation reports. This keeps handoff reconstructable
across worktrees and agents.

## Authority Boundary

Design SSOT Reconciliation answers these questions:

- Which design root owns this child ADR, Architecture, Story, Spec, UX, workflow,
  data model, policy, or domain contract doc?
- Did the root change without linked child updates?
- Are required child docs missing?
- Do child docs declare `parent_design`?
- Is a child explicitly reviewed against a stale root hash?
- Does an accepted ADR remain accepted after the root marks it superseded?

It does not decide product correctness by free-form semantic judgment. LLM or
agent review can suggest possible contradictions, but the first gate slice only
blocks deterministic lineage conflicts.

## Data Flow

```text
git diff / changed docs
        |
        v
Design SSOT registry
        |
        v
root + child doc existence, frontmatter, hash, supersession checks
        |
        v
gate:design_ssot_reconciliation
        |
        v
gate:responsibility_authority
        |
        v
gate:requirement
```

## Gate Placement

The gate sits after path/surface discovery and before Responsibility Authority:

```text
gate:path_surface_matrix -> gate:design_ssot_reconciliation -> gate:responsibility_authority -> gate:requirement
```

If a Journey context gate is active, the chain becomes:

```text
gate:path_surface_matrix -> gate:journey_context -> gate:design_ssot_reconciliation -> gate:responsibility_authority -> gate:requirement
```

This ordering lets path/surface discovery identify relevant changed docs before
Design SSOT checks lineage, then lets Responsibility Authority and Requirement
Consistency consume a more reliable design context.

## Failure Modes

- Missing registry: `not_applicable`, not a hard block, so existing repos can adopt gradually.
- Root-only change: `needs_review` action item.
- Missing required child: `block`.
- Missing or mismatched `parent_design`: `needs_review`.
- Stale root hash binding: `needs_review`.
- Root supersedes an accepted ADR without `superseded_by`: `block`.

## Non-Goals

- No automatic Markdown rewrite.
- No LLM-only contradiction block.
- No conflation with DESIGN.md or Design System authority.
- No replacement of existing Story / Architecture / Spec / Requirement gates.
