# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 6 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 2 |
| Spec Refs | 1 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |

## Invariants

- REQ-SRC-001: MME-INV-1: The skill MUST treat meeting minutes as an edited business document, not as a transcript summary or task candidate list. (spec:docs/specs/vibepro-meeting-minutes-editor-prompt.md)
- REQ-SRC-002: MME-INV-2: The skill MUST require source completeness checks for transcripts, Slack attachments, recordings, and referenced documents before generating a full note. (spec:docs/specs/vibepro-meeting-minutes-editor-prompt.md)
- REQ-SRC-003: MME-INV-3: The skill MUST NOT force every meeting into one fixed package or heading set. (spec:docs/specs/vibepro-meeting-minutes-editor-prompt.md)
- REQ-SRC-004: MME-INV-4: The skill MUST keep task and decision extraction downstream of the coherent meeting note. (spec:docs/specs/vibepro-meeting-minutes-editor-prompt.md)
- REQ-SRC-005: MME-INV-5: Missing owner or due-date information MUST remain unknown rather than being invented. (spec:docs/specs/vibepro-meeting-minutes-editor-prompt.md)
- REQ-SRC-006: MME-CONTRACT-3: The skill MUST include guidance for exemplar-driven prompt reverse engineering. (spec:docs/specs/vibepro-meeting-minutes-editor-prompt.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Requirement Sources

- spec: docs/specs/vibepro-meeting-minutes-editor-prompt.md: Spec
- architecture: docs/architecture/vibepro-meeting-minutes-editor-prompt.md: Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
