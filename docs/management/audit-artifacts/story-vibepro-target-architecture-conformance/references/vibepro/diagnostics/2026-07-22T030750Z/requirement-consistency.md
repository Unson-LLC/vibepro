# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 5 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 2 |
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

- C-001: docs/architecture/target-model.json is the hand-adjudicated target architecture SSOT holding modules (name/responsibility/paths), allowed_dependencies, budgets (default_max_file_lines and file_line_baseline), status (draft|adjudicated), and (inferred_spec:docs/management/stories/active/story-vibepro-target-architecture-conformance.md)
- S-001: vibepro architecture conformance compares the target model against .vibepro/graphify/graph.json and reports undeclared module dependencies with edge evidence, file/module budget violations, orphan files, and stale patterns as violations in  (inferred_spec:docs/management/stories/active/story-vibepro-target-architecture-conformance.md)
- C-002: architecture conformance is dry-run only: it exits 0 even when violations exist and never feeds gate_status; only the --strict flag makes violations produce a non-zero exit code. (inferred_spec:docs/management/stories/active/story-vibepro-target-architecture-conformance.md)
- C-003: When the target model status is draft, the conformance artifact and rendered summary carry an advisory notice stating violations are provisional until the model is adjudicated; adjudicated models carry no notice. (inferred_spec:docs/management/stories/active/story-vibepro-target-architecture-conformance.md)
- INV-001: Missing or unparsable graph.json or target model fails loud with a descriptive error; conformance never returns an empty violation list as success when its inputs are absent. (inferred_spec:docs/management/stories/active/story-vibepro-target-architecture-conformance.md)

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
