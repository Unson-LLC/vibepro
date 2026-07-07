---
story_id: story-vibepro-idempotent-audit-persistence
title: VibePro Idempotent Audit Persistence Architecture
parent_design: vibepro-idempotent-audit-persistence
status: draft
---

# Architecture

## Decision

Canonical audit persistence becomes idempotent by making bundle generation
deterministic, not by restructuring the two-phase persistence flow in
`execute merge`. The control flow (promote → persist → write final merge
artifacts → promote again → final persist) is intentional: the second pass
exists so the canonical bundle includes the final merge artifacts. The defect
is that regeneration always changes bytes even when logical content is
unchanged — `promoted_at` is stamped with the current time and gzip embeds a
fresh modification time — so the existing `already_present` check
(`git diff --cached --quiet` in the temp worktree) can never pass, and every
story lands two identical-message commits on the base branch (measured: 22 of
the latest 40 main commits; 10 of 10 inspected stories duplicated).

Two changes make the existing check work as designed:

1. **Stable `promoted_at`**: when regenerating, if the bundle's logical
   content (all fields except `promoted_at` and derived hashes of the
   compressed bundle) equals the previously promoted bundle, carry the
   previous `promoted_at` forward instead of stamping a new one.
2. **Deterministic compression**: generate `audit-replay-bundle.json.gz` with
   a fixed mtime (zero) and stable input ordering so identical logical content
   compresses to identical bytes.

With those, the second persist call hits `already_present` whenever the final
merge artifacts did not change the bundle, and commits exactly the real delta
when they did.

## Public Contract

No new CLI surface. Behavioral contract changes:

- One `execute merge` produces **at most one**
  `docs: persist VibePro audit artifacts for <story-id>` commit on base.
- `promoted_at` semantics: the first promotion time of the current logical
  content, not the last regeneration time. A field-level regeneration
  timestamp is not preserved (it carried no audit meaning).
- `persistCanonicalAuditToBase` summary statuses (`pushed`,
  `already_present`, `failed`) are unchanged.

## Flow

```text
promoteCanonicalAuditArtifacts (regeneration path)
  -> build bundle logical content (artifacts, index, replay payload)
  -> read existing canonical bundle on disk if present
  -> if logical content equal (volatile fields excluded):
       reuse existing promoted_at and existing compressed bytes
     else:
       stamp new promoted_at, compress deterministically (mtime=0)
  -> write bundle + index + gz

persistCanonicalAuditToBase (unchanged)
  -> temp worktree on origin/base, cp canonical dir, git add
  -> diff --cached --quiet  => already_present (now reachable)
  -> else commit + push (real delta only)
```

## Boundaries

- Only the bundle generation path and its volatile-field handling change;
  gate semantics, `pr prepare`, and audit replay consumers are untouched.
- Logical-content comparison is structural (parsed JSON with volatile fields
  excluded), not byte comparison of the old format, so the first run after
  this change still commits once (format migration) and is idempotent after.
- No history rewriting: existing duplicated commits on main stay as they are.

## Invariants

- Regenerating a bundle from unchanged inputs yields byte-identical files,
  including the gzip member.
- A second `persistCanonicalAuditToBase` call within the same merge commits
  only if the final merge artifacts changed the bundle's logical content.
- When comparison itself fails (unparseable existing bundle), generation
  falls back to stamping fresh content and persisting — duplicated commits
  are acceptable, lost audit content is not.
- `vibepro audit replay` succeeds against bundles produced by both the old
  and the new generation path.

## Rollback

Revert the determinism changes in the bundle generation module and
`src/merge-manager.js` in one commit. The persisted canonical artifacts are
forward/backward compatible, so no data migration is needed in either
direction.
