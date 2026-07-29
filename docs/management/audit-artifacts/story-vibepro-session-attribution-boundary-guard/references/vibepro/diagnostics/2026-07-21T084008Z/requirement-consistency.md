# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 9 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 2 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 3 |
| Legacy Keyword Resolutions | 1 |

## Invariants

- S-001: A synthetic session containing two story cue sets reports mixed_parent, detected story ids, and strict-to-associated divergence. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- INV-001: A single-story session reports mixed_parent false without changing existing token or semantic bucket totals. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- INV-002: Every event belongs to exactly one of strict, associated-only, other-story, or unclassified and their counts sum to the target event count. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- S-002: Attribution risk becomes high only below the declared strict-to-associated threshold and mixed parents make audit readiness partial. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- S-003: PR preparation stores a non-blocking session_boundary note and delegates mixed-session determination to audit session-cost. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- S-004: When no session can be selected, attribution is explicitly unavailable with a reason instead of being omitted. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- C-001: Explicit non-auto session selection behavior remains unchanged. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- C-002: Requested non-auto session inference behavior remains unchanged. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- C-003: Session metadata continues to establish the canonical session id and cwd while JSONL input is parsed. (inferred_spec:docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- C-001: !sessionSelection.session_id && !inferSession && sessionId !== 'auto' (unchanged; files=src/session-efficiency-audit.js)
- C-002: !inferSession && requestedSessionId !== 'auto' (unchanged; files=src/session-efficiency-audit.js)
- C-003: entry.type === 'session_meta' (unchanged; files=src/session-efficiency-audit.js)

## Legacy Keyword Resolution Deprecations

- src/session-efficiency-audit.js: !inferSession && requestedSessionId !== 'auto' - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-session-attribution-boundary-guard.md: Contracts

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
