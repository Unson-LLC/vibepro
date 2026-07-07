---
story_id: story-vibepro-idempotent-audit-persistence
title: VibePro Idempotent Audit Persistence Spec
parent_design: vibepro-idempotent-audit-persistence
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        Promote["promoteCanonicalAuditArtifacts"] --> Compare["logical content == existing bundle?"]
        Compare -- yes --> Reuse["reuse promoted_at + compressed bytes"]
        Compare -- no --> Fresh["new promoted_at + deterministic gzip (mtime=0)"]
        Reuse --> Persist["persistCanonicalAuditToBase"]
        Fresh --> Persist
        Persist --> Diff["git diff --cached --quiet"]
        Diff -- clean --> Present["already_present (no commit)"]
        Diff -- delta --> Commit["single commit + push"]
---

# Spec

## Public Contract

Canonical audit persistence keeps its statuses (`pushed`, `already_present`,
`failed`) and its two-phase call sites in `execute merge`. The behavioral
contract added: one `execute merge` lands **at most one**
`docs: persist VibePro audit artifacts for <story-id>` commit on the base
branch, and re-persisting unchanged logical content lands zero.

`promoted_at` denotes the first promotion time of the current logical
content, not the latest regeneration time.

## Contracts

### IAP-CONTRACT-001: Deterministic bundle bytes

Bundle generation (index, bundle manifest, and the gzip replay bundle) MUST
produce byte-identical output for identical logical content. The gzip member
MUST NOT embed a varying modification time.

### IAP-CONTRACT-002: Stable promoted_at on unchanged content

When regeneration finds the logical content (all fields excluding
`promoted_at` and hashes/sizes derived from the compressed member) equal to
the existing canonical bundle, it MUST carry the existing `promoted_at`
forward.

### IAP-CONTRACT-003: At most one persistence commit per merge

Within a single `execute merge`, the second persistence call MUST result in
`already_present` when the final merge artifacts did not change the bundle's
logical content, and MUST commit exactly the real delta when they did.

### IAP-CONTRACT-004: Fail toward duplication, never toward loss

When the logical-content comparison cannot run (missing or unparseable
existing bundle), generation MUST fall back to fresh content and persistence
MUST proceed. Duplicated commits are an acceptable degraded mode; missing
audit content is not.

### IAP-CONTRACT-005: Replay compatibility

`vibepro audit replay` MUST succeed against bundles produced before and after
this change.

## Scenarios

- `IAP-S-1`: Given an `execute merge` whose final merge artifacts do not
  change the bundle, when both persistence calls run, then exactly one
  persistence commit exists on base and the second call reports
  `already_present`.
- `IAP-S-2`: Given a canonical bundle already persisted, when the bundle is
  regenerated from unchanged inputs, then all produced files are
  byte-identical, including the gzip member.
- `IAP-S-3`: Given final merge artifacts that add new content to the bundle,
  when the second persistence call runs, then one commit containing that
  delta is pushed.
- `IAP-S-4`: Given an unparseable existing bundle on disk, when regeneration
  runs, then fresh content is generated, persistence proceeds, and no error
  aborts the merge.
- `IAP-S-5`: Given a bundle produced by the new deterministic path, when
  `vibepro audit replay` runs, then it succeeds.

## Verification

- Focused tests cover byte-identical regeneration, single-commit behavior
  across the double-persist flow, real-delta recommit, the unparseable
  fallback, and replay compatibility.
- `npm run typecheck` and the full `npm test` suite pass with no new
  failures.
