# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 12 |
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

- REQ-INV-001: pathまたはsymbolを宣言した責務は、共有risk surfaceだけでは一致しない。 (story:docs/management/stories/active/story-vibepro-responsibility-authority-match-precision.md)
- REQ-INV-002: path/symbolが一致した責務では、一致したrisk surfaceを matched_by の補強情報として残す。 (story:docs/management/stories/active/story-vibepro-responsibility-authority-match-precision.md)
- REQ-INV-003: path/symbolを宣言しないrisk-only責務は、既存互換としてrisk surface単独で一致する。 (story:docs/management/stories/active/story-vibepro-responsibility-authority-match-precision.md)
- REQ-INV-004: Domain Contractは責務IDを列挙しただけでは一致しないが、条項自身のpath/symbolが直接一致すれば責務を解決する。 (story:docs/management/stories/active/story-vibepro-responsibility-authority-match-precision.md)
- REQ-INV-005: symbol一致は変更されたproduction source行だけを対象とし、Story文面・未変更行・test-onlyファイルから責務を拡張しない。 (story:docs/management/stories/active/story-vibepro-responsibility-authority-match-precision.md)
- REQ-INV-006: high-riskだが登録authorityの直接一致がない変更は、quiet successではなく no_registered_authority を維持する。 (story:docs/management/stories/active/story-vibepro-responsibility-authority-match-precision.md)
- REQ-SRC-001: RAR-MATCH-INV-001: pathまたはsymbolを宣言したresponsibilityは、risk surface単独では一致してはならない。 (spec:docs/specs/vibepro-responsibility-authority-match-precision.md)
- REQ-SRC-002: RAR-MATCH-INV-002: path/symbolを宣言しないrisk-only responsibilityは、互換性のためrisk surface単独で一致できる。 (spec:docs/specs/vibepro-responsibility-authority-match-precision.md)
- REQ-SRC-003: RAR-MATCH-INV-003: symbolは変更されたproduction source行だけから一致させ、Story text、未変更行、test-only sourceから一致させてはならない。 (spec:docs/specs/vibepro-responsibility-authority-match-precision.md)
- REQ-SRC-004: RAR-MATCH-INV-005: Domain Contract clause自身のpath/symbol直接一致は、registry pathと異なる場合でもauthorityを解決できる。 (spec:docs/specs/vibepro-responsibility-authority-match-precision.md)
- REQ-SRC-005: RAR-MATCH-INV-006: direct authorityがないhigh-risk surfaceは no_registered_authority を維持する。 (spec:docs/specs/vibepro-responsibility-authority-match-precision.md)
- REQ-SRC-006: RAR-MATCH-S-001: Given cleanup責務とbilling責務が queue_worker を共有し、cleanup pathだけを変更した時、Then cleanup責務だけが一致する。 (spec:docs/specs/vibepro-responsibility-authority-match-precision.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-responsibility-authority-match-precision.md: VibePro Responsibility Authority Match Precision Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
