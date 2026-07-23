# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 15 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 11 |
| Requirement Sources | 15 |
| Spec Refs | 14 |
| Architecture Refs | 1 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 7 |
| Legacy Keyword Resolutions | 8 |

## Invariants

- S-001: In the atomic review workflow, the scope state transitions from split_recommended to accepted only when typed dependency boundaries connect every generated lane, every lane is declared as a review facet, no typed unsafe scope signal exists, (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-001: Atomic scope is not accepted until every required or checkpoint-required Agent Review role is closed and passing on the strict current HEAD, and every changed path in each generated facet is represented in that required-role owner map; opti (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-002: Accepted atomic scope retains the automatic split plan and maps every generated lane to cumulative_atomic_head on one current HEAD. (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-003: Accepted atomic validation preserves every generated unit, integration or build, typecheck, and required E2E command without dropping a lane command. (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- S-002: Structured surface evidence covers one surface row only when its evidence targets collectively contain every changed path in that row; a matching surface name, targetless Flow Verification prose, or one covered path cannot cover unrelated o (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-004: Stories without atomic scope metadata and small reviewable pull requests retain their existing split and readiness behavior. (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-005: Accepted atomic scope reconciles the PR scope judgment and split resolution gates to passed and recomputes needs_evidence_count in the same prepare result, so scope advice cannot remain a contradictory readiness blocker in either nodes or s (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-006: When multiple current commands match required responsibility evidence, the resolver prefers a command bound to the target contract clause ID over an earlier scenario-only match, without weakening existing authority registry validation. (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- S-003: Multiple commits remain a review-required scope signal but do not disable atomic override by count alone; only explicit commit-message lineage to a Story, STR, BFD, BUG, or INC other than the current Story produces an unsafe typed signal. (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-007: A separate_session relation is not accepted from CLI assertions or arbitrary identifiers; atomic owner evidence requires the latest lifecycle for the same role, agent, and agent system to be closed, its reviewer session or thread identifier (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-008: Typed atomic scope metadata is treated as a schema validation boundary, while governance-only review role or responsibility authority language does not create an auth_denied candidate. (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-009: The change-risk classifier promotes the gate-review boundary to workflow_heavy only when gate_orchestration and review_lifecycle coexist; gate-only and review-only changes retain their prior non-heavy profile unless another independent heav (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-010: Failure-mode coverage requires a current-bound passing executable command, a structured observation, at least one target, and an explicit mode assertion in scenario or observed values; keyword-only, failing, inspection-only, or target-unbou (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-011: When .vibepro/config.json is the only mixed repo-control path it is treated as tracked canonical Story registration and may be reviewed through the typed atomic contract; any additional independent repo-control path remains unsafe for atomi (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)
- INV-012: A versioned current-Story lineage exception is accepted only for a real merge commit whose canonical origin/codex source ref resolves to one of its parents and whose target is the matching codex branch; title-only, single-parent, missing-re (inferred_spec:docs/management/stories/active/story-vibepro-atomic-scope-review-contract.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- S-001: !authority (unchanged; files=src/responsibility-authority.js)
- S-001: !entry.primary_authority?.ref (unchanged; files=src/responsibility-authority.js)
- S-001: !VALID_AUTHORITY_KINDS.has(entry.primary_authority.kind (unchanged; files=src/responsibility-authority.js)
- S-001: gitContext?.user_status_fingerprint_hash (unchanged; files=src/git-fingerprint.js)
- INV-006: !authority (unchanged; files=src/responsibility-authority.js)
- INV-006: !entry.primary_authority?.ref (unchanged; files=src/responsibility-authority.js)
- INV-006: !VALID_AUTHORITY_KINDS.has(entry.primary_authority.kind (unchanged; files=src/responsibility-authority.js)

## Legacy Keyword Resolution Deprecations

- src/responsibility-authority.js: !authority - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/responsibility-authority.js: !entry.primary_authority?.ref - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/responsibility-authority.js: !VALID_AUTHORITY_KINDS.has(entry.primary_authority.kind - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/agent-review.js: !startedEntry?.dispatch_authorization_id - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/agent-review.js: !supplied && !runAuthority - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/agent-review.js: !authorizationId - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/change-risk-classifier.js: sourceFiles.some(isAuthBoundaryPath - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/verification-evidence.js: !supplied && !runAuthority - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-atomic-scope-review-contract.md: Atomic Scope Review Contract Specification
- spec: docs/specs/story-vibepro-explicit-run-attribution-lineage.md: Explicit Run Attribution Lineage Spec
- spec: docs/specs/vibepro-agent-review-independence-provenance.md: Spec
- spec: docs/specs/vibepro-architecture-aware-story-derive.md: Architecture-Aware Story Derive Spec
- spec: docs/specs/vibepro-automation-cost-defaults.md: Spec
- spec: docs/specs/vibepro-bug-physics-triage-router.md: VibePro Bug Physics Triage Router Spec
- spec: docs/specs/vibepro-design-ssot-reconciliation.md: VibePro Design SSOT Reconciliation Spec
- spec: docs/specs/vibepro-downstream-diagram-preflight.md: VibePro Downstream Diagram Preflight Spec
- spec: docs/specs/vibepro-judgment-dag-adjudication.md: Judgment DAG Adjudication Spec
- spec: docs/specs/vibepro-performance-evidence-framework.md: VibePro Performance Evidence Framework Spec
- spec: docs/specs/vibepro-pr-prepare-authorization-scoring.md: Spec
- spec: docs/specs/vibepro-review-authorization-scoring.md: Spec
- spec: docs/specs/vibepro-risk-adaptive-gate-dag.md: VibePro Risk-Adaptive Gate DAG Spec
- spec: docs/specs/vibepro-session-attribution-inference.md: Spec
- architecture: docs/architecture/story-vibepro-explicit-run-attribution-lineage.md: Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
