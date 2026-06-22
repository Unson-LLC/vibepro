---
story_id: story-vibepro-traceability-ac-to-code-map
title: Traceability AC-to-code Map Architecture
---

# Architecture

## Decision

traceabilityをartifact presenceの一覧から、Acceptance Criteria / scenario clauseごとの
implementation and evidence mapへ拡張する。

各ACは、Story source、changed files、test targets、verification evidence、review findingsに
独立してbindingされる。bindingは強さを持ち、generic test passだけではfully mappedにしない。

## Mapping Sources

- Story frontmatter and Acceptance Criteria
- Spec scenario clauses
- changed files and file groups
- test files and explicit AC / scenario references
- verification evidence commands, observations, artifact checks
- review findings and finding dispositions

## Invariants

- artifact presence alone is not traceability
- unmapped or weakly mapped AC must remain visible
- traceability can inform value audit without directly blocking every PR
