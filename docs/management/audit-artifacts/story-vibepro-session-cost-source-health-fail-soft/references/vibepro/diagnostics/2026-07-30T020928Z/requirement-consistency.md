# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 4 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 1 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 3 |

## Invariants

- C-001: Process-manager ingestion returns structured source health and does not abort session-cost for a missing, empty, malformed, or non-array chat_processes.json source. (inferred_spec:docs/management/stories/active/story-vibepro-session-cost-source-health-fail-soft.md)
- S-001: Given an empty or malformed process-manager source and a valid session_meta.cwd, when audit session-cost runs, then the result uses session_meta as observed_worktree_source and preserves available token accounting. (inferred_spec:docs/management/stories/active/story-vibepro-session-cost-source-health-fail-soft.md)
- INV-001: A valid matching process-manager entry retains precedence over session metadata, and source diagnostics never include the source file contents. (inferred_spec:docs/management/stories/active/story-vibepro-session-cost-source-health-fail-soft.md)
- C-002: A valid process-manager array with no selected-session entry is reported as unavailable with session_not_found, while invalid source state is reported separately as degraded. (inferred_spec:docs/management/stories/active/story-vibepro-session-cost-source-health-fail-soft.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- src/session-efficiency-audit.js: selectedSessionId && sessionFiles.length > 0 - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/session-efficiency-audit.js: !inferSession && requestedSessionId !== 'auto' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/session-efficiency-audit.js: entry.type === 'session_meta' - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/vibepro-session-cost-source-health-fail-soft.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
