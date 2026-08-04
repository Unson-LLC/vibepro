# Requirement Consistency

| 項目 | 内容 |
|------|------|
| Status | pass |
| Invariants | 6 |
| Scenario Gaps | 0 |
| Contradictions | 0 |
| Scanned Code Files | 3 |
| Requirement Sources | 1 |
| Spec Refs | 1 |
| Architecture Refs | 0 |
| Policy Refs | 0 |
| Domain Contract Refs | 0 |
| Responsibility Authority Matches | 0 |
| Responsibility Authority Unknowns | 0 |
| Structured Inherited Behavior Declarations | 1 |
| Legacy Keyword Resolutions | 3 |

## Invariants

- S-001: The waitFor test helper accepts a caller-specified timeout via an options object ({ timeoutMs }) while keeping the default at 10000ms so existing call sites keep their current deadline behavior. (inferred_spec:docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)
- S-004: The four load-sensitive containment waits (pid-file appearance after spawn and worker-exit / SIGTERM-marker detection after shutdown, in both the process-group containment test and the sandbox-boundary containment test) pass timeoutMs 30000 (inferred_spec:docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)
- S-003: The previously flaky containment test passes in both a targeted single-file run (node --test test/codex-subagent-host.test.js) and a full-suite run, verified by current-head verification evidence. (inferred_spec:docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)
- INV-002: Production changes are limited to closing the containment registration race: the shutdown escalation phases, signal ordering, sandbox EPERM fallback, Windows branches, and event delivery keep their existing behavior. (inferred_spec:docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)
- S-002: The worker registers the codex child pid in codex-process.json synchronously (writeFileSync) immediately after spawn and before any await, and terminateWorkerTree re-resolves codex-process.json whenever codexPid is unknown — before escalati (inferred_spec:docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)
- S-005: Test fixtures write pid files and signal markers atomically (tmp+rename), and the test-side waits parse the pid file content until it is a positive integer (> 1) instead of checking file existence alone, so a zero-byte read can never yield  (inferred_spec:docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)

## Scenario Gaps

- なし

## Potential Contradictions

- なし

## Structured Inherited Behavior Declarations

- INV-002: terminateWorkerTree SIGTERM-to-SIGKILL escalation phases and sandbox EPERM fallback are unchanged/existing (inherited; files=src/codex-subagent-host.js)

## Legacy Keyword Resolution Deprecations

- src/codex-subagent-host.js: !subscription || subscription.delivering - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/codex-subagent-host.js: subscription.delivered.has(file - replace with inferred spec clause inherited_behavior: { condition, classification, files }
- src/codex-subagent-host.js: state?.dispatch_id === dispatchId && state.status !== 'cancelled' - replace with inferred spec clause inherited_behavior: { condition, classification, files }

## Requirement Sources

- spec: docs/specs/story-vibepro-codex-host-containment-test-load-tolerance.md: Codex host containment test load-tolerant waitFor — Spec pointer

## Responsibility Authority

- status: not_generated
- matched responsibilities: 0
- matched contract clauses: 0
- missing evidence: 0
- stale evidence: 0
- unregistered candidates: 0
