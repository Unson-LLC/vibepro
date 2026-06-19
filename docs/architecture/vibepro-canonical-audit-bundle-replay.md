---
story_id: story-vibepro-canonical-audit-bundle-replay
title: Canonical Audit Bundle Replay Architecture
---

# Architecture

## Decision

VibePro persists a minimal, tracked audit bundle at the successful merge boundary so a later main checkout can replay the decision without the originating worktree's `.vibepro` directory.

## Flow

`execute merge` already knows the story id, PR URL, merge status, merge commit, and local PR/review artifact paths. That boundary is the only point where promotion should happen. `usage report` and audit tooling then read canonical bundles as a replay surface when local `.vibepro` evidence is absent.

## Boundaries

- Promotion is allowed only after a confirmed `merged` result.
- Promotion copies JSON audit core files and records missing optional files.
- Promotion does not auto-commit or push the canonical directory.
- Replay reads canonical artifacts but does not treat them as live implementation state.

## Tradeoff

Tracking a small JSON bundle adds repository history, but it prevents the stronger failure mode where a merged decision cannot be reconstructed after the original worktree disappears.
