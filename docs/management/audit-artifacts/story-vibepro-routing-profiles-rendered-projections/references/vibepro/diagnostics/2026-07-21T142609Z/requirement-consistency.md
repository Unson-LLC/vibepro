# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 14 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 6 |
| Requirement Sources | 5 |
| Spec Refs | 5 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 3 |
| Legacy Keyword Resolutions | 2 |

## Invariants

- INV-001: schema 0.2.0 repositories must define at least two stable named artifact-routing profiles; each selected profile must independently define story, architecture, accepted_spec, task_plan, graphify, evidence, test_plan, review, gate, and pr wi (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- S-001: Given catalog-authoritative artifact_profile and feature_slug for a named-profile Story, matching Story-frontmatter mirrors are mandatory and every lifecycle consumer resolves the same profile and context; missing or conflicting mirrors fai (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- INV-002: routing must fail closed before any write when the profile is undefined, required variables are missing, or metadata conflicts are detected. (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- C-001: Accepted Spec JSON must render deterministically into Functional Spec Markdown, preserving clauses, origin references, and diagrams. (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- C-002: Functional Spec, Tasks, Evidence, Test Plan, Review, Gate, and Release Markdown views in both profiles must carry generated, curated, or human_owned ownership plus profile, feature_slug, source canonical path and SHA-256, renderer id/versio (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- C-003: The existing machine task authority at .vibepro/stories/{story_id}/tasks/tasks.json must remain unmoved and render deterministically by unique task id and fixed field order into lineage-bearing Tasks Markdown using tasks_markdown renderer v (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- INV-003: VibePro must never overwrite a human_owned packet file, and curated views must remain outside automatic overwrite paths. (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- C-004: Each semantic artifact must have exactly one writable canonical path, and generated projections must not become read authority. (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- S-002: artifacts resolve JSON/text must report story_id, profile, metadata_source, variables, and per-kind canonical owner/writer/read authority plus projection ownership and renderer; artifacts migrate --dry-run must keep edits_performed at zero  (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- S-003: Story discovery, status, Architecture, Spec, Task, Graphify, Evidence, Test Plan, Review, Gate, PR prepare/create/merge, and migration must each consume one shared resolver result and expose the same profile and feature_slug without local d (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- S-004: A fresh checkout must resolve story-feature-checkout to feature_packet surfaces under docs/features/checkout-feature and story-governance-checkout to governance_packet surfaces under docs/governance/checkout-governance, including Functional (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- C-005: artifact_routing schema 0.2.0 introduces named profiles, ownership, and renderers; the new CLI must preserve 0.1.0 repository-global routing, while an old CLI must reject 0.2.0 as unsupported_schema and must not ignore profiles or silently  (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- S-005: Given an Agent Review record has neither supplied lineage nor Run authority, the recorder leaves lineage absent; when either source is available, the established lineage-resolution path remains unchanged. (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- S-006: Given recorded git context contains user_status_fingerprint_hash, freshness comparison uses that user fingerprint; when it is absent, the established full-fingerprint fallback remains unchanged. (inferred_spec:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- S-001: artifact_profile is unset, or schemaVersion is 0.1.0 and artifact_routing.artifacts remains the repository-global route source (inherited; files=src/artifact-routing.js)
- S-005: !supplied && !runAuthority (inherited; files=src/agent-review.js)
- S-006: gitContext?.user_status_fingerprint_hash (inherited; files=src/git-fingerprint.js)

## Legacy Keyword Resolution Deprecations

- src/agent-review.js: !supplied && !runAuthority - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/git-fingerprint.js: gitContext?.user_status_fingerprint_hash - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/vibepro-architecture-aware-story-derive.md: Architecture-Aware Story Derive Spec
- spec: docs/specs/vibepro-bug-physics-triage-router.md: VibePro Bug Physics Triage Router Spec
- spec: docs/specs/vibepro-pr-prepare-authorization-scoring.md: Spec
- spec: docs/specs/vibepro-review-authorization-scoring.md: Spec
- spec: docs/specs/vibepro-risk-adaptive-gate-dag.md: VibePro Risk-Adaptive Gate DAG Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
