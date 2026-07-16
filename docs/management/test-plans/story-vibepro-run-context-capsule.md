---
story_id: story-vibepro-run-context-capsule
status: active
updated_at: 2026-07-16
---

# Test Plan: Run Context Capsule

## Contract matrix

| Story clause | Test surface | Expected observation |
|---|---|---|
| RCC-S-1 / RCC-S-2 / RCC-S-3 | `test/run-context-capsule.test.js` typed and bounded fixture | Required typed fields exist, serialized bytes are at most 32768, reduced sections are named, and raw logs/diffs/transcripts are absent. |
| RCC-S-4 | capsule idempotence and `test/guarded-run-session.test.js` persistence hook | Identical authoritative bytes leave the capsule byte-stable; Run mutation invokes refresh only after authority persistence. |
| RCC-S-4 | verification, review, and decision recorder regressions | Recorder APIs retain their return contracts; decision creation refreshes a unique active Run, while zero or ambiguous Runs remain non-destructive. |
| RCC-S-5 | stale HEAD, deleted/new source, mismatched Story, malformed JSON, oversized capsule, and injected write-failure fixtures | Read fails closed with a typed error; explicit recovery replaces malformed or oversized disposable projections from authority; an authority failure preserves prior bytes and a mirror failure is distinguishable after authority commit. |
| RCC-S-6 | fresh child Node process and managed-worktree fixture | A new process reconstructs blocker and decision context without transcript input; authority and mirror capsules are byte-identical. |
| RCC-S-7 | combined contract suite | Size, freshness, source, event, mirroring, and restart boundaries all pass deterministically. |

## Verification commands

```bash
node --test test/run-context-capsule.test.js test/guarded-run-session.test.js test/decision-records.test.js
node --test test/verification-evidence-artifact-check.test.js test/verification-observation.test.js test/review-inspection-first.test.js test/agent-review-independence.test.js
node --test --test-concurrency=2
node bin/vibepro.js skills lint .
cmp -s CLAUDE.md AGENTS.md
```

The first two commands isolate the new contract and its recorder integration boundaries. The full suite is the regression authority for unrelated VibePro workflows. The final two commands protect agent-instruction structure and byte-for-byte entrypoint identity.

## Failure interpretation

- A stale or missing capsule is not repaired in place; reproduce against the authoritative Story, Run, Git HEAD, and referenced artifacts.
- A recorder integration failure must be classified separately from its authoritative evidence/review write because projection is additive and best-effort.
- A managed mirror mismatch is a projection defect even when the authority capsule validates; the expected contract is exact serialized bytes after the authority write.
