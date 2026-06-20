---
story_id: story-vibepro-issues-189-204-gate-friction
title: Gate friction reduction Architecture
---

# Architecture

## Decision

Keep gate strictness, but make low-value friction explainable and reusable when evidence is still valid.

#189 remains implemented in Agent Review binding: `review status` compares the recorded review HEAD to the current HEAD and reuses a pass only when the merge delta is outside the review's concrete inspected file surface.

#204 is implemented in PR manager Story E2E coverage: coverage remains executable-assertion based, but the detector now inspects assertion statements rather than single lines and can expand local static string/array bindings referenced by those assertions.

## Data Flow

1. `pr prepare` gathers Story ACs and matching E2E files.
2. Candidate E2E test blocks are extracted with line range and test name metadata.
3. Executable assertion statements are extracted from each block, including multiline `expect(...)` / `assert.*(...)` calls.
4. Local static string and array bindings are collected only from the same test block.
5. A binding contributes to coverage only when the executable assertion references that binding.
6. Missing coverage emits diagnostics that show file, block, assertion samples, marker match state, criterion match state, and miss reasons.

## Boundaries

- Comments can provide nearby story-bound markers, but comments alone do not cover an AC.
- Dynamic values, imported constants, runtime data, and template interpolations are not resolved for AC coverage.
- Merge-delta review reuse does not prove semantic equivalence for changed reviewed files.

## Operational Impact

The result is lower fake-value friction: operators can see whether VibePro missed a real executable assertion, whether they need an explicit marker, or whether review evidence was safely reused after an unrelated base-sync.
