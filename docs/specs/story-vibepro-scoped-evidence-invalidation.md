---
story_id: story-vibepro-scoped-evidence-invalidation
title: Scoped Evidence Invalidation Spec
parent_design: vibepro-scoped-evidence-invalidation
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart LR
        ChangedFiles["Changed files"] --> SurfaceClassifier["Changed surface classifier"]
        SurfaceClassifier --> ReuseDecision["Scoped evidence reuse decision"]
        RuntimeSource["Runtime source or repo control"] --> StrictCurrent["strict_current"]
        TestFiles["Changed test files"] --> FullRerun["full_rerun"]
        DocsSpecs["Story/Spec/architecture/policy metadata"] --> ReuseDecision
        ReuseDecision --> GateOutput["Gate and artifact consistency output"]
---

# Spec

## Contracts

### SEI-CONTRACT-001: Changed surface model

`classifyChangeRisk` MUST return `changed_surfaces` and `changed_surface_files`.
The model MUST distinguish runtime source, tests, Story docs, Spec docs, architecture docs,
policy docs, responsibility/authority metadata, contract metadata, VibePro generated artifacts,
repo control, and unknown/other files.

### SEI-CONTRACT-002: Per-gate reuse decision

For each verification gate, PR preparation MUST compute a scoped reuse decision with:

- `action`: `reuse`, `lightweight_re_record`, `full_rerun`, `additional_check`, or `strict_current`
- `status`: `reusable` or `blocked`
- changed surfaces and changed files
- affected gate and evidence kind
- human-readable reason

### SEI-CONTRACT-003: Docs/spec-only reuse

If changed surfaces are limited to Story/Spec/architecture/policy docs, responsibility/authority
metadata, contract metadata, or VibePro generated artifacts, and no runtime source or relevant test
files changed, stale passing E2E evidence MAY be reused for Gate status.

### SEI-CONTRACT-004: Test changes invalidate test-bound verification

If a changed test file is present, stale unit/e2e/integration evidence MUST NOT be reused as passing.
The decision MUST be `full_rerun` and include the changed test file paths.

### SEI-CONTRACT-005: Conservative fallback

Runtime source, repo-control, unknown/other, failed evidence, legacy evidence, or unsupported binding
states MUST fall back to strict current evidence unless a narrower reuse policy explicitly allows them.

### SEI-CONTRACT-006: Gate output visibility

When stale evidence is reused or rejected through scoped invalidation, Gate output and Artifact
Consistency output MUST include the decision, changed files, changed surfaces, and reason.

## Test Requirements

- Classifier unit tests cover docs/spec-only surfaces and responsibility/contract metadata surfaces.
- `pr prepare` regression tests cover committed docs/spec-only reuse across HEAD change.
- `pr prepare` regression tests cover test-file changes invalidating stale E2E evidence.
