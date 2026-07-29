# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | needs_review |
| Invariants | 7 |
| Scenario Gaps | 1 |
| Contradictions | 0 |
| Scanned Code Files | 5 |
| Requirement Sources | 0 |
| Spec Refs | 0 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 1 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- C-001: Evidence change-surface resolution classifies every changed path as product_code, docs, evidence_artifacts, or unknown, and reports docs_only only when at least one docs path changed and no product_code path changed. An unclassified path, a (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)
- INV-001: A docs-only change defaults to the summary persistence depth, and an explicit requested evidence depth remains authoritative over that default so a documentation change can still be escalated. A change that touches product code keeps the pr (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)
- C-002: The canonical evidence cost budget defines a docs_only profile separate from the normal and high implementation profiles. The docs_only profile keeps the same absolute canonical artifact line threshold as the normal profile and does not app (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)
- S-001: scenario_clause_e2e: given a repository whose pull request has already been merged so that origin/<base> contains the branch head, when merge diff-line statistics are collected, then the base branch is rejected as a diff base and the pre-me (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)
- C-003: Canonical evidence cost distinguishes a docs-only zero from an unmeasured zero: product_code_changed_lines is zero with reason docs_only for a docs-only change, and null with status unavailable and reason diff_stats_unavailable when the dif (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)
- INV-002: The existing evidence depth planner contract is not re-implemented: docs-only detection enters as a planner input. The planner keeps its schema version, its summary-first default depth, its artifact policy vocabulary, and its risk escalatio (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)
- C-004: The usage report separates evidence-spend signals by scope: implementation_budget_exceeded_count counts only bundles on the implementation budget scope, docs_only_budget_exceeded_count and docs_only_bundle_count report the documentation axi (inferred_spec:docs/management/stories/active/story-vibepro-docs-only-evidence-profile.md)

## Scenario Gaps

- REQ-GAP-001: Requirement Sourcesに明示されていない重要分岐がある - src/merge-manager.js の `!gateAuthorization.allowed` 分岐が、Story/Spec/Architecture/Policyの受け入れ基準または方針で明示されているか確認が必要。

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- C-004: budget_scope is unchanged for canonical bundles promoted before the docs-only profile (existing; files=-)

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
