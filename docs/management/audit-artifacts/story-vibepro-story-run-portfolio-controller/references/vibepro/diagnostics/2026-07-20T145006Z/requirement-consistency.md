# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 3 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: SRP-S-2: 1つのRunは1つのStoryだけを所有し、他Storyのmutation、evidence、review、token/timeを同じRunへ混載しない。 (story:docs/management/stories/active/story-vibepro-story-run-portfolio-controller.md)
- REQ-INV-002: Storyごとにrun id、managed worktree、branch、context capsule、evidence、session cost、terminal stateを分離する。 (story:docs/management/stories/active/story-vibepro-story-run-portfolio-controller.md)
- REQ-INV-003: blocker、未確認、runtime waitを空結果やsuccessへ変換せず、portfolio状態へ保持する。 (story:docs/management/stories/active/story-vibepro-story-run-portfolio-controller.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- なし

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
