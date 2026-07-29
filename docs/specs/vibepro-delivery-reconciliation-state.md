---
story_id: story-vibepro-delivery-reconciliation-state
title: Delivery and Reconciliation State Spec
parent_design: story-vibepro-delivery-reconciliation-state
code_refs:
  - src/merge-manager.js
  - src/cli.js
  - src/execution-state.js
  - src/story-transaction-lock.js
  - src/reconciliation-action.js
  - src/managed-worktree.js
  - src/canonical-audit.js
  - src/html-report.js
  - src/usage-report.js
test_refs:
  - test/cli-status-honesty.test.js
  - test/vibepro-cli.test.js
  - test/delivery-reconciliation-state.test.js
  - test/execution-state.test.js
  - test/story-transaction-lock.test.js
  - test/e2e/story-vibepro-delivery-reconciliation-state-main.spec.ts
  - test/traceability-usage-report.test.js
  - test/canonical-audit-self-contained.test.js
diagrams:
  - kind: state
    mermaid: |
      stateDiagram-v2
        [*] --> DeliveryUnknown
        DeliveryUnknown --> DeliveryObserved: merge commit is on base
        DeliveryUnknown --> Blocked: delivery cannot be verified
        DeliveryObserved --> Reconciled: evidence agrees
        DeliveryObserved --> ReconciliationRequired: gate or HEAD drift
        ReconciliationRequired --> Reconciled: follow-up succeeds
  - kind: threat_model
    mermaid: |
      flowchart LR
        GH["GitHub merge fact"] --> A["base ancestry verification"]
        A -->|verified| D["immutable delivery"]
        A -->|unverified| B["fail closed"]
        D --> R["current evidence reconciliation"]
        R -->|clean| OK["reconciled"]
        R -->|drift| F["non-zero follow-up"]
        F -. never rewrites .-> D
---

# Spec

## Inherited behavior outside this Story

The optional session-attribution projection in evidence reuse is pre-existing and
remains unchanged by the delivery/reconciliation state contract:

```yaml
inherited_behavior:
  condition: "sessions.length > 0"
  classification: unchanged
  files:
    - src/evidence-reuse.js
```

## Contracts

- `DRS-CONTRACT-001`: merge results MUST expose independent `delivery` and `reconciliation`
  objects while retaining the top-level `status` as a compatibility projection.
- `DRS-CONTRACT-002`: an external merge MUST NOT be accepted as delivered unless the GitHub merge
  commit is an ancestor of the configured base ref.
- `DRS-CONTRACT-003`: after delivery is observed, gate, worktree, remote-head, checks, or review
  drift MUST preserve the delivery fact and set `reconciliation.status=reconciliation_required`.
- `DRS-CONTRACT-004`: expected post-merge topology, including a closed PR and a branch no longer
  being fresh against base, MUST NOT by itself require reconciliation.
- `DRS-CONTRACT-005`: state-changing `execute merge` and `execute reconcile` commands MUST
  return a non-zero status for required reconciliation, while the read-only `execute status`
  command MUST return zero when the query succeeds and expose the unresolved state in its output.
  Read-only means that valid execution state is not rewritten. If its JSON is malformed, the query
  MUST atomically quarantine the original bytes as `state.json.corrupt-*.bak`, return `1`, and name
  the quarantine path instead of presenting missing or fabricated state as a successful query.
  Refreshing managed-worktree metadata during a valid query MUST NOT repair `.git/info/exclude` or
  mutate any other repository control file; a missing execution state returns `1` without emitting
  a fabricated status payload.
  Meanwhile,
  traceability records delivered lifecycle and the delivery workflow state transition records the
  remaining execution-state follow-up. The command that first encounters provider post-processing,
  persistence, or synchronization failure returns `1`; a later `execute reconcile` projection of the
  persisted unresolved state returns `2` until reconciliation succeeds.
- `DRS-CONTRACT-006`: a normal VibePro-managed merge with current evidence MUST produce delivered
  and reconciled state after refreshing the post-merge base ref.
- `DRS-CONTRACT-007`: execution DAG, human/HTML summaries, usage reports, and canonical audit
  projections MUST preserve both axes; a canonical persistence failure MUST remain actionable
  failure even when delivery is already observed. Missing reconciliation and execution-state
  synchronization failure MUST fail closed, and branch cleanup MUST follow delivery verification.
  Recovery projections MUST retain the delivered PR selector and non-default base so their emitted
  commands remain executable after HEAD drift or loss of local PR-create evidence. Provider command
  or JSON parse failures MUST persist a blocked artifact rather than throw before evidence is written;
  positive delivery fallback MUST bind both the same base and the same PR selector and MUST fail closed
  when either identity component is absent or differs;
  external delivery MUST NOT imply historical `merge_ready`; and unresolved reconciliation MUST NOT
  produce `ready` automation audit status.
  When execution-state synchronization fails, every human and canonical projection MUST expose the
  same ordered `reconciliation_action`: its first and only command is `vibepro execute reconcile`,
  and prepare-and-merge guidance MUST NOT be mixed into that failure path. When that persisted command
  successfully writes execution state, it MUST consume only `execution_state_sync_failed`, preserve
  delivery/base/PR identity, update local and canonical merge artifacts, and converge to `reconciled`
  unless another reconciliation reason remains. Recovery MUST require both stored and supplied base/PR
  identity and reject any missing or mismatched component. Follow-up persistence across local artifacts,
  canonical artifacts, and the manifest MUST roll back as one unit when any write fails.
  Linked execution-state rollback MUST restore only values written by the failing transaction; a
  concurrent state or source-artifact change MUST be preserved and surfaced as an explicit rollback
  conflict. Execution-state compare-and-swap MUST treat every existing local or linked-source
  authority as one baseline: a linked-only observed value is valid, while any authority that differs
  from the observed value MUST stop the write before mutation. VibePro writers MUST serialize the
  local and linked-source authorities with the same
  story-scoped transaction lock, capture ownership after each artifact write, and compare the expected
  recovered follow-up before compensating it. The lock MUST heartbeat while live, MUST NOT evict a live
  local PID solely because elapsed time exceeded the stale threshold, and MUST release only when its owner
  token still matches. Normal execute-merge artifact writes and recovery/follow-up writes MUST participate
  in that same lock. Stale takeover, heartbeat, and release MUST serialize through a fixed lock-generation
  mutation guard so two takeover contenders cannot evict a replacement owner and a retiring owner cannot
  delete or overwrite its successor; release MUST prove the current owner token before quarantining a lock
  generation. An abandoned mutation guard MUST fail closed for operator inspection
  rather than infer ownership from age. Follow-up rollback MUST restore only exact artifact paths whose
  transaction ownership is proven; unknown partial output and concurrent unrelated files MUST remain untouched.
  When PR artifacts use a configured canonical route, merge writes, compare-and-swap, transaction snapshots,
  sync-failure recovery, verification projections, and managed-worktree-to-source synchronization and rollback ownership MUST resolve and use that same routed directory in each root. They MUST
  NOT create or consume a parallel legacy `.vibepro/pr` authority; routed JSON/HTML and canonical audit outputs
  MUST converge in the same transaction.
  The first sync-failure follow-up write MUST compare against the exact pre-sync merge
  snapshot persisted in local `pr-merge.json`, rather than a returned object whose canonical-audit metadata may
  have been finalized after the last local write, so only a newer operator update becomes an explicit conflict.
  A successful merge-state projection MUST
  compare that observed execution-state snapshot again under the story lock before its final write. Reconciliation
  MUST also compare its initially observed execution state, including an explicit absent-state expectation, before
  its first write and compare the first committed state again before its final write, so build-time operator changes
  cannot be overwritten. These comparisons ensure successful projections cannot
  overwrite a newer operator state. JSON CLI failures MUST retain the original cause,
  nested cause details, and per-authority restoration errors on the public execute path.

## Scenarios

- `DRS-SCENARIO-001` (`DRS-STORY-S-002`): Given an externally merged PR whose merge commit is on base and whose current
  evidence agrees, when merge execution imports it, then delivery is `merged_externally`,
  reconciliation is `reconciled`, and the command succeeds.
- `DRS-SCENARIO-002` (`DRS-STORY-S-003`): Given the same delivery fact with a non-ready Gate DAG, when merge execution
  imports it, then delivery remains observed, reconciliation becomes required with
  `gate_not_ready`, and the command exits non-zero.
- `DRS-SCENARIO-003` (`DRS-STORY-UNVERIFIED-004`): Given a claimed merge commit that is not on base, when merge execution checks
  it, then delivery remains unverified and the operation is blocked.
- `DRS-SCENARIO-004` (`DRS-STORY-S-001`): Given a normal VibePro merge, when GitHub returns the merge result, then both
  axes are complete after a post-merge base fetch and no follow-up is left in execution state.
- `DRS-SCENARIO-005` (`DRS-STORY-S-005`): Given delivery succeeded but canonical persistence failed, when execution
  status is rebuilt, then delivery remains observed while completion is `failed` with a retry action.
- `DRS-SCENARIO-006` (`DRS-STORY-S-005`): Given delivery was observed but execution-state synchronization failed, the
  CLI still returns the observed merge result plus an explicit reconciliation command, persists that
  follow-up to local and canonical artifacts, and exits non-zero.
- `DRS-SCENARIO-007` (`DRS-STORY-S-006`): Given a provider command fails or its JSON is malformed, merge execution writes
  an explicit blocked artifact without inferring delivery; retrying an already observed external merge
  remains idempotent and does not manufacture historical merge readiness.
- `DRS-SCENARIO-008` (`DRS-STORY-S-005`): Given execution-state synchronization fails after observed delivery, text,
  HTML, usage, and compact canonical projections retain the same base/PR identity and expose only the
  ordered execute-reconcile recovery action.
- `DRS-SCENARIO-009` (`DRS-STORY-S-005`, `DRS-STORY-TXN-007`, `DRS-STORY-ROUTE-008`): Given that persisted execute-reconcile recovery action is run successfully,
  local and canonical artifacts consume the synchronization failure, preserve delivery/base/PR
  identity, expose no merge retry, and execution state converges to `merged` and `reconciled`.
  Missing or mismatched identity fails closed, unrelated reasons remain actionable, and partial
  local/canonical/manifest persistence restores the original synchronization-failure artifacts.
  Each copied or promoted file records transaction ownership immediately after its write; directory-wide
  restore and post-step ownership inference are forbidden. A concurrent writer is never overwritten by rollback, and final-state persistence failure restores
  the original follow-up through the public reconciliation orchestration.

## Verification

- `DRS-VERIFY-001`: `test/cli-status-honesty.test.js` covers clean external delivery, the five-way
  drift matrix, and unverified delivery; `test/vibepro-cli.test.js` covers managed merge behavior,
  branch retention, and persistence/synchronization boundaries.
- `DRS-VERIFY-002`: assertions bind the CLI exit code, persisted merge artifact, traceability
  lifecycle, and execution-state follow-up to the same outcome.
- `DRS-VERIFY-003`: dedicated summary, DAG, usage-report, and canonical-audit tests prove the two
  axes survive each derived surface without being collapsed.
- `DRS-VERIFY-004`: provider nonzero/malformed JSON, command replay, non-default base recovery,
  durable sync failure, and automation readiness are asserted on persisted artifacts.
- `DRS-VERIFY-005`: the synchronization-failure CLI contract executes its persisted recovery command
  and asserts convergence in execution state plus both local and canonical merge artifacts;
  omitted/wrong identity, unrelated-reason retention, and persistence rollback are negative-path assertions.

- Responsibility authority validation MUST reject a registry entry whose `primary_authority.ref` is
  absent with `primary_authority is required`. It MUST NOT infer or promote another authority. The
  responsibility-authority regression suite is the executable contract for this fail-closed branch.
- `DRS-VERIFY-006`: the shipped `bin/vibepro.js execute merge --json` entrypoint is executed as a child
  process for both selector failure and observed-delivery execution-state synchronization failure. The latter
  independently proves exit `1`, immutable delivery, one identity-bound reconcile command, visible diagnostics,
  and the persisted follow-up artifact. Dispatcher and real merge follow-up transaction tests complement that
  public journey with nested diagnostics and per-artifact rollback without replacing production transaction code.
- `DRS-VERIFY-007`: `test/story-transaction-lock.test.js` pauses a lock initializer across takeover,
  verifies generation fencing, and covers verified stale transition recovery versus live-owner fail-closed behavior.
- `DRS-VERIFY-008`: transaction/concurrency evidence is bound to `DRS-CONTRACT-008`; routed/linked
  authority evidence is independently bound to `DRS-CONTRACT-009`, so a failure identifies its risk lane.
