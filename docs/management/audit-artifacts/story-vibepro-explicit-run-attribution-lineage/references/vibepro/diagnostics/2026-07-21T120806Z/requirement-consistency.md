# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 11 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 8 |
| Requirement Sources | 11 |
| Spec Refs | 7 |
| Architecture Refs | 4 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 0 |
| Legacy Keyword Resolutions | 8 |

## Invariants

- C-001: A Guarded Run dispatch persists a versioned lineage envelope containing the authoritative Story, Run, dispatch, worktree, branch, and HEAD binding. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- S-001: Provider observations append to the same dispatch lineage, deduplicate idempotently, and fail closed on provider identity conflict, cross-Run rebinding, or stale HEAD binding. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- C-002: Verification, review, decision, and action records inherit a validated active Run lineage, while an explicit Story or Run mismatch is rejected before the verification write. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- C-003: Run-aware session-cost attribution prioritizes explicit Run lineage and returns bucket, method, source_artifact, confidence, and run_id without treating a Thread-only observation as Story authority. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- S-002: Mixed-parent events are partitioned exactly once into story_attributed, shared_parent, other_story, unattributed, or replayed_context and bucket totals reconcile to the input event and token totals. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- INV-001: Shared-parent, unattributed, and replayed-context events remain in their own buckets and are not allocated into the target Story's attributed event or token totals. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- S-003: A VibePro-external or Thread-only session continues through inference and reports unavailable attribution when no authoritative lineage exists, without requiring Thread separation. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- INV-002: Existing session-cost run_id and session-id paths, Guarded Run readers, and Agent Runtime Adapter callers retain additive compatibility when lineage is absent or present. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- S-004: A fresh process can reconstruct bounded Story-to-Run-to-dispatch-to-provider-observation lineage from the Run context capsule without transcript content. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- S-006: Focused tests and an end-to-end fixture cover identity validation, mismatch handling, mixed-parent bucket partitioning, unattributed retention, Guarded Run dispatch, evidence propagation, canonical Run session-cost attribution, and transcri (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)
- INV-003: Lineage schema and attribution resolution remain in src/run-lineage.js while session-efficiency-audit.js consumes the resolver and preserves existing audit output compatibility. (inferred_spec:docs/management/stories/active/story-vibepro-explicit-run-attribution-lineage.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- なし

## Legacy Keyword Resolution Deprecations

- src/agent-runtime-adapter.js: request.role === 'review' && !started.session_id && !started.thread_id - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/verification-evidence.js: !supplied && !runAuthority - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/agent-review.js: !supplied && !runAuthority - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/human-decision-checkpoint.js: state.status === 'cancelled' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/session-efficiency-audit.js: !sessionSelection.session_id && !inferSession && sessionId !== 'auto' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/session-efficiency-audit.js: !inferSession && requestedSessionId !== 'auto' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/session-efficiency-audit.js: entry.type === 'session_meta' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/run-context-capsule.js: !options.authorityFile || path.resolve(authorityFile - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-explicit-run-attribution-lineage.md: Explicit Run Attribution Lineage Spec
- spec: docs/specs/vibepro-agent-review-independence-provenance.md: Spec
- spec: docs/specs/vibepro-automation-cost-defaults.md: Spec
- spec: docs/specs/vibepro-design-ssot-reconciliation.md: VibePro Design SSOT Reconciliation Spec
- spec: docs/specs/vibepro-downstream-diagram-preflight.md: VibePro Downstream Diagram Preflight Spec
- spec: docs/specs/vibepro-performance-evidence-framework.md: VibePro Performance Evidence Framework Spec
- spec: docs/specs/vibepro-session-attribution-inference.md: Spec
- architecture: docs/architecture/story-vibepro-explicit-run-attribution-lineage.md: Architecture
- architecture: docs/architecture/story-vibepro-guarded-run-session-contract.md: Architecture
- architecture: docs/architecture/story-vibepro-human-decision-checkpoint.md: Human Decision Checkpoint Architecture
- architecture: docs/architecture/story-vibepro-next-best-action-controller.md: Next Best Action Controller Architecture

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
