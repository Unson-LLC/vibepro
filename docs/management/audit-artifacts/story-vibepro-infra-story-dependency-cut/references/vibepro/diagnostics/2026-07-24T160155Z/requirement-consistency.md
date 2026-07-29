# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 6 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 5 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 3 |
| Legacy Keyword Resolutions | 2 |

## Invariants

- C-001: src/decision-records.js is classified under the workspace-infra module in docs/architecture/target-model.json (not story), because its only imports are workspace.js/run-context-capsule.js/artifact-routing.js and its only consumers are manag (inferred_spec:docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)
- C-002: src/managed-worktree.js and src/managed-worktree-gate.js no longer import from src/decision-records.js as a story-module file; the import target moves module classification only, the call sites (readDecisionRecordsIfExists) are unchanged. (inferred_spec:docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)
- C-003: normalizeActiveStories and its private helper isArchived move from src/story-manager.js to src/workspace.js (workspace-infra), which already owns DEFAULT_BRAINBASE_STORIES; src/story-manager.js, src/guard.js, src/performance-evidence.js, an (inferred_spec:docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)
- S-001: Given the workspace-infra dependency cut is applied, when `vibepro architecture conformance . --json` is re-run after `vibepro graph . --run-graphify`, then the conformance summary's violation_count does not increase from the pre-change mea (inferred_spec:docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)
- S-002: Given the remaining workspace-infra -> story edges reported by conformance (e.g. src/workspace.js -> src/story-manager.js), when the actual import statements of the reported source files are read directly, then no such import exists, confir (inferred_spec:docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)
- INV-001: src/performance-evidence.js's user-perceived-metric readiness branches (hasUserPerceivedEvidence(context.beforeRuns)/hasUserPerceivedEvidence(context.afterRuns) guards, and the metric.readinessKind === 'user_perceived' && !evidenceSources.s (inferred_spec:docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- INV-001: hasUserPerceivedEvidence(context.beforeRuns) (unchanged; files=src/performance-evidence.js)
- INV-001: hasUserPerceivedEvidence(context.afterRuns) (unchanged; files=src/performance-evidence.js)
- INV-001: metric.readinessKind === 'user_perceived' (unchanged; files=src/performance-evidence.js)

## Legacy Keyword Resolution Deprecations

- src/performance-evidence.js: !hasUserPerceivedEvidence(context.beforeRuns - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/performance-evidence.js: !hasUserPerceivedEvidence(context.afterRuns - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-infra-story-dependency-cut.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
