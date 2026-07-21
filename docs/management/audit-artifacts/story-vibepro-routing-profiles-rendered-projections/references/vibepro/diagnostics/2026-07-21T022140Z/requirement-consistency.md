# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 24 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 0 |
| Requirement Sources | 5 |
| Spec Refs | 5 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 0 |

## Invariants

- REQ-INV-001: brainbase.stories[]のartifact_profileと明示的feature_slugを共通resolverが読み、全producer/consumerへ同じrouting contextを返す。 (story:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- REQ-INV-002: AC-14: profile未設定repositoryと既存artifact_routing.artifacts設定の後方互換を維持する (story:docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- REQ-SRC-001: INV-ASD-1: story derive must compute a repo profile before promoting preset product surface Stories. (spec:docs/specs/vibepro-architecture-aware-story-derive.md)
- REQ-SRC-002: INV-ASD-2: When no preset is explicit and the repo profile is not next-app or web, Next.js/Web/SaaS product surface Stories must not be promoted from code token matches alone. (spec:docs/specs/vibepro-architecture-aware-story-derive.md)
- REQ-SRC-003: INV-ASD-3: Explicit --preset <id> and repo-local story_catalog.preset must remain authoritative operator input and preserve backwards-compatible preset behavior. (spec:docs/specs/vibepro-architecture-aware-story-derive.md)
- REQ-SRC-004: INV-ASD-4: Suppressed template Stories must be represented as warnings or candidates, never as validated story_cluster Stories. (spec:docs/specs/vibepro-architecture-aware-story-derive.md)
- REQ-SRC-005: INV-ASD-5: story-catalog.json must include selected preset, preset resolution mode, repo profile, and suppression warnings. (spec:docs/specs/vibepro-architecture-aware-story-derive.md)
- REQ-SRC-006: INV-ASD-6: story-map.md must expose repo profile and warning codes so a human can understand why Stories were omitted. (spec:docs/specs/vibepro-architecture-aware-story-derive.md)
- REQ-SRC-007: INV-BP-1: Gate DAG MUST include gate:bug_physics_triage. (spec:docs/specs/vibepro-bug-physics-triage-router.md)
- REQ-SRC-008: INV-BP-2: Bug physics class MUST be a multi-label array from timing, state-invariant, deterministic-byte, observability, deployment. (spec:docs/specs/vibepro-bug-physics-triage-router.md)
- REQ-SRC-009: INV-BP-3: A selected class MUST change the downstream gate profile. (spec:docs/specs/vibepro-bug-physics-triage-router.md)
- REQ-SRC-010: INV-BP-4: Typed N/A with reason MUST be distinct from waiver decisions. (spec:docs/specs/vibepro-bug-physics-triage-router.md)
- REQ-SRC-011: INV-BP-5: Active triage MUST require probe evidence before PR readiness. (spec:docs/specs/vibepro-bug-physics-triage-router.md)
- REQ-SRC-012: INV-BP-6: Harness contradiction MUST expose a feedback edge to triage. (spec:docs/specs/vibepro-bug-physics-triage-router.md)
- REQ-SRC-013: The embedded authorization_scoring object MUST contain: (spec:docs/specs/vibepro-pr-prepare-authorization-scoring.md)
- REQ-SRC-014: When no story can be resolved (transient mode) or no decisions exist, the field MUST still appear, with authorization_level = 'unknown' and the matrix's recommendation for that cell. (spec:docs/specs/vibepro-pr-prepare-authorization-scoring.md)
- REQ-SRC-015: pr-prepare.json MUST remain valid JSON; adding the new field MUST NOT break any existing field path consumed elsewhere. (spec:docs/specs/vibepro-pr-prepare-authorization-scoring.md)
- REQ-SRC-016: INV-PAS-1: authorization_scoring is advisory; it MUST NOT alter gate_status, role-mode policy, or ready_for_pr_create. (spec:docs/specs/vibepro-pr-prepare-authorization-scoring.md)
- REQ-SRC-017: The recommendation is surfaced as a new artifact and a new field on PR preparation, never as a silent gate downgrade. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-018: INV-RAS-1: A vague story statement that does not name the affected risk surface MUST NOT produce high or medium. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-019: INV-RAS-3: review_outcome_recommendation MUST NOT be allow for workflow_heavy risk profiles when authorization is low or unknown. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-020: INV-RAS-4: Scoring is a pure function of the supplied evidence inputs; it MUST NOT read repository state directly. (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-021: INV-RAS-5: When inputs are empty/absent, authorization_level resolves to unknown (never to high). (spec:docs/specs/vibepro-review-authorization-scoring.md)
- REQ-SRC-022: Flow Verification evidence MUST be bound to the current git state before it can satisfy workflow-heavy release readiness. (spec:docs/specs/vibepro-risk-adaptive-gate-dag.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- なし

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
