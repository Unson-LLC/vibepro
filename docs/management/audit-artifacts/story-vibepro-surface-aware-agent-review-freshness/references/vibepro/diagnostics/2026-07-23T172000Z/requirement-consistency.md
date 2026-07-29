# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | needs_review |
| Invariants | 4 |
| Scenario Gaps | 1 |
| Contradictions | 0 |
| Scanned Code Files | 2 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 1 |

## Invariants

- INV-001: gate_evidence and release_risk default to content_surface while reasoned role policy and CLI strict overrides remain strict_head. (inferred_spec:docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)
- S-001: Given reviewed gate and release surfaces, when unrelated main movement is rebased into the branch, then unchanged content bindings remain current. (inferred_spec:docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)
- S-002: Given a content-bound review, when its inspected file, projection lineage, contract, or release-impact input changes or cannot be resolved, then the impacted review becomes stale. (inferred_spec:docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)
- S-003: Given a reasoned strict_head override, when HEAD changes, then the review becomes stale while dirty fingerprint, inspection input, provenance, and lifecycle validation remain enforced for all reuse modes. (inferred_spec:docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)

## Scenario Gaps

- REQ-GAP-001: Requirement Sourcesに明示されていない重要分岐がある - src/agent-review.js の `!startedEntry?.dispatch_authorization_id` 分岐が、Story/Spec/Architecture/Policyの受け入れ基準または方針で明示されているか確認が必要。

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- src/agent-review.js: !supplied && !runAuthority - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/vibepro-surface-aware-agent-review-freshness.md: Surface-aware Agent Review Freshness Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
