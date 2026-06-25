---
title: VibePro Responsibility Authority Core Catalog
status: draft
created_at: 2026-06-26
updated_at: 2026-06-26
related_stories:
  - story-vibepro-responsibility-authority-core-catalog
---

# VibePro Responsibility Authority Core Catalog

## Decision

Grow the Responsibility Authority Registry from a single self-dogfood contract into a first core catalog for VibePro itself.

The registry is not a global narrative design document. It is the machine-readable index that answers which authority owns a responsibility, which code surfaces belong to it, and which current-head evidence is required before PR readiness can pass.

## First Core Responsibilities

The first catalog covers responsibilities that regularly cross Story boundaries:

- PR lifecycle execution
- Agent Review lifecycle
- Verification evidence lifecycle
- Story source integrity
- Engineering Judgment route and axes
- Managed worktree execution locality

Each responsibility points at `docs/contracts/vibepro-core-responsibilities.json` for clause-level authority and keeps existing Architecture/Spec files as supporting authority.

## Boundary

This catalog intentionally avoids claiming that every VibePro responsibility is registered. Unknown high-risk responsibilities must continue to surface as `no_registered_authority`.

Broad shared modules such as `src/pr-manager.js` are not used as the primary path trigger for every responsibility. When a responsibility is implemented inside a shared orchestrator, the registry should prefer owned helper modules, stable symbols, and risk surfaces so small unrelated orchestrator edits do not inherit every contract.

## Growth Rule

When a future PR touches a VibePro surface that repeatedly appears in Gate DAG, review lifecycle, evidence, execution, or Story/source failures, add a new responsibility entry before relying on a one-off Story regression guard.
