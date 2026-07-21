# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 4 |
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

- REQ-INV-001: GAH-S-2: retry対象と非対象がpolicyで分離され、backoff中断・再開が監査できる。 (story:docs/management/stories/active/story-vibepro-guarded-autonomy-hardening.md)
- REQ-INV-002: GAH-S-5: Storyからpr_readyまたは型付き停止理由までを1コマンドで進め、process restart後も同じRunを再開できる。 (story:docs/management/stories/active/story-vibepro-guarded-autonomy-hardening.md)
- REQ-INV-003: 最終UXをexecute run --until pr-ready --autonomy guardedへ統合し、mergeは明示操作のまま残す。 (story:docs/management/stories/active/story-vibepro-guarded-autonomy-hardening.md)
- REQ-INV-004: 予算切れやtimeoutを「対象なし」「成功」として扱うこと。 (story:docs/management/stories/active/story-vibepro-guarded-autonomy-hardening.md)

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
