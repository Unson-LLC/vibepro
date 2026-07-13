# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 8 |
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

- REQ-INV-001: standard / full の明示要求は reason、consumer、1件以上の target が揃わなければ失敗する。 (story:docs/management/stories/active/story-vibepro-summary-drilldown-log.md)
- REQ-INV-002: canonical full artifact の保存禁止。 (story:docs/management/stories/active/story-vibepro-summary-drilldown-log.md)
- REQ-SRC-001: SDL-CONTRACT-001: buildEvidencePlan MUST default every implicit request to summary, including source and high-risk changes. (spec:docs/specs/vibepro-summary-drilldown-log.md)
- REQ-SRC-002: SDL-CONTRACT-002: summary plans MUST preserve risk signals and targeted full surfaces in compact machine-readable artifacts. (spec:docs/specs/vibepro-summary-drilldown-log.md)
- REQ-SRC-003: SDL-CONTRACT-003: explicit standard or full MUST require non-empty reason, consumer, and at least one target path or gate id. (spec:docs/specs/vibepro-summary-drilldown-log.md)
- REQ-SRC-004: SDL-CONTRACT-004: each valid non-summary override MUST append a HEAD-bound entry to evidence-drilldown-log.json. (spec:docs/specs/vibepro-summary-drilldown-log.md)
- REQ-SRC-005: SDL-CONTRACT-005: a summary run MUST NOT append a drill-down entry or erase prior entries. (spec:docs/specs/vibepro-summary-drilldown-log.md)
- REQ-SRC-006: SDL-CONTRACT-006: the ledger MUST describe requested exposure only and MUST NOT claim actual reads or decision use. (spec:docs/specs/vibepro-summary-drilldown-log.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

## Requirement Sources

- spec: docs/specs/vibepro-summary-drilldown-log.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
