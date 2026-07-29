# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 7 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 11 |
| Requirement Sources | 4 |
| Spec Refs | 4 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 10 |
| Legacy Keyword Resolutions | 11 |

## Invariants

- C-001: execute run with --until pr-ready and --autonomy guarded selects the closed autonomous implementation DAG and the persisted codex then claude-code provider order by default, while an explicit legacy profile and provider override remain avai (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)
- INV-001: Only final_prepare may produce pr_ready, and it does so only after the current managed-worktree HEAD pr-prepare artifact reports gate_status.ready_for_pr_create=true. (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)
- INV-003: The guarded closure never creates or merges a PR, grants a critical waiver, or performs a material external side effect. Every implementation and repair dispatch requires workspace_write plus local_workspace_only, which a connector may adve (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)
- S-003: The guarded Run workflow state matrix covers success, restart and resume, material human decision, verification failure with explicit correction/resume, needs_changes review repair convergence, no progress, quota, timeout, CI pending, and c (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)
- S-001: A production connector smoke proves a real managed-worktree commit plus distinct read-only closed review session when the provider exposes the required capability. If every selected provider lacks a required capability, it instead proves a  (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)
- S-002: Pre-PR roadmap-closure acceptance cites PR #372, PR #377, and PR #382 as the canonical merged evidence for Autonomous Action DAG, Production Runtime Connectors, and Independent Review Orchestration, does not reimplement those surfaces, and  (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)
- INV-002: Managed-worktree post-merge artifact synchronization resolves only the selected catalog Story. It derives story-scoped PR directory ownership from the selected canonical route template and never resolves an undeclared probe Story under sche (inferred_spec:docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- C-001: operation === 'dispatch' && dispatchAuthority.error (unchanged; files=src/guarded-run-session.js)
- C-001: operation === 'dispatch' && options.request?.requirements?.managed_worktree !== authorityRoot (unchanged; files=src/guarded-run-session.js)
- C-001: loaded.state.status === 'cancelled' || loaded.state.status === 'pr_ready' || loaded.state.status === 'waiting_for_human' (unchanged; files=src/guarded-run-session.js)
- INV-003: state.status === 'cancelled' (unchanged; files=src/human-decision-checkpoint.js)
- INV-003: error?.code !== 'run_cancelled' (unchanged; files=src/guarded-run-session.js)
- S-001: /not logged in|unauthenticated/i.test(authStatus) (unchanged; files=src/agent-runtime-connectors.js)
- S-001: record.cancelRequested (unchanged; files=src/agent-runtime-connectors.js)
- S-001: authorization.action && authorization.action !== 'dispatch' (unchanged; files=src/independent-review-orchestrator.js)
- S-001: isStop(authorization) (unchanged; files=src/independent-review-orchestrator.js)
- S-002: PR #377 and PR #382 are already merged and their implementation surfaces are outside this closure Story (unchanged; files=src/agent-runtime-connectors.js, src/independent-review-orchestrator.js)

## Legacy Keyword Resolution Deprecations

- src/guarded-run-session.js: operation === 'dispatch' && dispatchAuthority.error - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/guarded-run-session.js: operation === 'dispatch' && options.request?.requirements?.managed_worktree !== authorityRoot - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/guarded-run-session.js: operation !== 'cancel' && latest.state.status === 'cancelled' && loaded.state.status !== 'cancelled' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/guarded-run-session.js: loaded.state.status === 'cancelled' || loaded.state.status === 'pr_ready' || loaded.state.status === 'waiting_for_human' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/guarded-run-session.js: persistedAfterOwners.state.status === 'cancelled' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/human-decision-checkpoint.js: state.status === 'cancelled' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/agent-runtime-connectors.js: /not logged in|unauthenticated/i.test(authStatus - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/agent-runtime-connectors.js: record.cancelRequested - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/independent-review-orchestrator.js: isStop(authorization - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/independent-review-orchestrator.js: authorization.action && authorization.action !== 'dispatch' - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/merge-manager.js: !gateAuthorization.allowed - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-one-command-pr-ready-closure-execution-topology-replay.md: Execution Topology Replay Plan
- spec: docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md: One-command PR-ready Closure Test Plan
- spec: docs/specs/story-vibepro-explicit-run-attribution-lineage.md: Explicit Run Attribution Lineage Spec
- spec: docs/specs/vibepro-agent-review-independence-provenance.md: Spec

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
