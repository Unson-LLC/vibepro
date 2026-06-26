---
title: VibePro Responsibility Authority Core Catalog Spec
story_id: story-vibepro-responsibility-authority-core-catalog
---

# VibePro Responsibility Authority Core Catalog Spec

## Invariants

- `RAR-CORE-INV-1`: VibePro core workflow responsibilities must have primary authority refs in machine-readable Domain Contract clauses.
- `RAR-CORE-INV-2`: Each registered core responsibility must declare owned paths or symbols, required evidence, and `unknown_policy`.
- `RAR-CORE-INV-3`: Registry growth must not satisfy required evidence with generic test names unless the evidence is bound to the relevant contract clause ID.

## Contracts

- `RAR-CORE-CON-1`: `vibepro.pr_lifecycle.execution` owns PR create/merge readiness responsibilities.
- `RAR-CORE-CON-2`: `vibepro.agent_review.lifecycle` owns staged Agent Review dispatch, closure, and provenance.
- `RAR-CORE-CON-3`: `vibepro.verification.evidence_lifecycle` owns verification/review artifact freshness and reuse labeling.
- `RAR-CORE-CON-4`: `vibepro.story_source.integrity` owns selected Story source consistency.
- `RAR-CORE-CON-5`: `vibepro.engineering_judgment.route_axes` owns Engineering Judgment route and axis activation semantics.
- `RAR-CORE-CON-6`: `vibepro.managed_worktree.execution_locality` owns protected-command worktree locality.

## Scenarios

- `RAR-CORE-S-1`: Given a core VibePro owned file changes and current-head evidence names the matching contract clause, Responsibility Authority resolves the matching responsibility as passed.
- `RAR-CORE-S-2`: Given the same owned file changes and only generic evidence exists, Responsibility Authority keeps the matching contract evidence missing.
- `RAR-CORE-S-3`: Given a future high-risk VibePro workflow surface has no registry entry, Responsibility Authority must still emit unknown/no registered authority instead of inventing an SSOT.

## Anti-patterns

- `RAR-CORE-AP-1`: Do not use one broad `src/pr-manager.js` path match to attach every VibePro responsibility to every PR-manager edit.
- `RAR-CORE-AP-2`: Do not treat supporting Architecture/Spec docs as primary authority when a Domain Contract clause exists.

## Verification

- `node --test test/responsibility-authority.test.js`
