# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 3 |
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

- REQ-INV-001: 既存 main 履歴上の重複コミットの遡及クリーンアップ（履歴書き換えはしない）。 (story:docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md)
- REQ-INV-002: failure_modes: 決定化の比較に失敗した場合は従来どおりコミットする側に倒す（audit 証跡の欠落より重複を許容する）。 (story:docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md)
- REQ-INV-003: gzip 決定化が環境依存で崩れた場合もコミット内容は正しく、重複が再発するだけで情報は失われない。 (story:docs/management/stories/active/story-vibepro-idempotent-audit-persistence.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/story-vibepro-idempotent-audit-persistence.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
