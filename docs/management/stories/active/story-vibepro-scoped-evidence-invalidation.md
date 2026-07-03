---
story_id: story-vibepro-scoped-evidence-invalidation
title: "Gate planner scopes stale evidence invalidation by changed surface"
status: active
view: dev
period: 2026-07
source:
  type: github_issue
  id: 268
  title: "Gate planner should scope stale evidence invalidation by changed surface"
related_stories:
  - story-vibepro-risk-adaptive-gate-dag
  - story-vibepro-evidence-summary-reuse
  - story-vibepro-path-surface-matrix-gate
parent_design: vibepro-scoped-evidence-invalidation
architecture_docs:
  - docs/architecture/vibepro-scoped-evidence-invalidation.md
spec_docs:
  - docs/specs/story-vibepro-scoped-evidence-invalidation.md
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Story

VibePro currently binds verification evidence to the whole dirty fingerprint. That preserves
current-state safety, but it is too coarse when the only change is Story, Spec, responsibility,
contract, or generated VibePro metadata that does not touch runtime source or the relevant test set.

Gate must classify the changed surface and explain whether each verification command is still reusable,
needs a lightweight re-record, needs a full rerun, or needs an additional targeted check.

## User Story

**As a** VibePro user preparing a PR with fresh documentation/specification changes<br>
**I want to** Gate to reuse still-valid runtime verification evidence when the runtime and tests are unchanged<br>
**So that** I rerun expensive E2E only when the changed surface can affect the checked behavior

## Scope

- Add a machine-readable changed-surface model for runtime source, tests, Story/Spec/architecture docs,
  responsibility/authority metadata, contract metadata, VibePro generated artifacts, repo control, and other files.
- Decide evidence reuse per verification gate instead of accepting all stale low-risk evidence uniformly.
- Allow docs/spec-only HEAD or dirty-fingerprint changes to reuse passing E2E evidence when runtime source and E2E tests are unchanged.
- Force full rerun for verification gates affected by changed test files.
- Include the changed files and action reason in Gate output and artifact consistency output.
- Keep the strict current-binding fallback for source, repo-control, unknown, or unclassified surfaces.

## Acceptance Criteria

- [ ] A `docs/specs/**`-only change keeps previous passing E2E evidence reusable when runtime source files and E2E test files are unchanged.
- [ ] A test-file change does not reuse stale E2E/unit evidence as passing verification.
- [ ] Gate output records which changed files and surfaces drove the evidence reuse or invalidation decision.
- [ ] Artifact Consistency Gate uses the same scoped decision so reused evidence is not reported stale.
- [ ] Unknown/source/repo-control changes continue to require strict current evidence.
- [ ] Regression tests cover docs/spec-only reuse across a committed HEAD change and test-file invalidation.

## Non Goals

- Computing semantic dependency graphs for every command.
- Proving runtime equivalence beyond the current path-surface model.
- Reusing failed or legacy evidence as passing evidence.
