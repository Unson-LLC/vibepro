# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 9 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 1 |
| Spec Refs | 0 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: AMG-S-3: commit は書き込み直後の読み戻しで継続性メタデータの parse 同値性を検証し、不一致・解析不能を非ゼロ exit で報告する。 (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-INV-002: AMG-S-4: commit は既存 memory の自由記述セクション（findings / session notes 等）を保持し、継続性ブロックだけを更新する。 (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-INV-003: 読み戻し不一致・解析不能は非ゼロ exit で失敗させる。 (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-INV-004: 継続性メタデータは memory 冒頭の機械可読ブロックとして固定フォーマット化し、自由記述の findings セクション（既存の ## Key findings 等）は保持・非破壊で扱う。 (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-INV-005: Automation prompt-driven fallback handling remains possible when the guard is not invoked; existing automations keep working unchanged. (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-INV-006: memory の findings セクションのスキーマ化（自由記述のまま保持する）。 (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-INV-007: commit の書き込み失敗・読み戻し不一致は非ゼロ exit で明示され、部分書き込みは temp file + rename で防ぐ。 (story:docs/management/stories/active/story-vibepro-audit-automation-memory-guard.md)
- REQ-SRC-001: It never derives or edits audit results, token accounting, or gate (architecture:docs/architecture/vibepro-audit-automation-memory-guard.md)
- REQ-SRC-002: Existing automations that never call the guard see byte-identical CLI (architecture:docs/architecture/vibepro-audit-automation-memory-guard.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- architecture: docs/architecture/vibepro-audit-automation-memory-guard.md: Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
