# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: GitHubのマージ済みPR 281件（2026-07-16取得）を月別に集計する (story:docs/management/stories/active/story-vibepro-release-notes-history.md)
- REQ-INV-002: GitHub Release、npm registry、git tagを正式公開版の正本として扱う (story:docs/management/stories/active/story-vibepro-release-notes-history.md)
- REQ-SRC-001: VRNH-CON-002: 履歴snapshotは2026-07-16時点のmerged PR 281件、main target 273件と明記する。 (spec:docs/specs/vibepro-release-notes-history.md)
- REQ-SRC-002: VRNH-CON-004: 正式公開版はGitHub v0.1.0-internal-beta.1、npm 0.1.0-alpha.0 / 0.1.0-beta.0だけを公開済みとして扱う。 (spec:docs/specs/vibepro-release-notes-history.md)
- REQ-SRC-003: VRNH-CON-006: version historyはrelease notesへリンクし、installed binary contract優先の説明を維持する。 (spec:docs/specs/vibepro-release-notes-history.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-release-notes-history.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
