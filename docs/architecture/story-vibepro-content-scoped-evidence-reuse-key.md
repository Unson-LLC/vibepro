---
story_id: story-vibepro-content-scoped-evidence-reuse-key
title: Content Scoped Evidence Reuse Key Architecture
parent_design: vibepro-content-scoped-evidence-freshness
---

# Architecture

## Decision

The evidence-reuse key (`src/evidence-reuse.js`) is split into a shared *base*
key (story, base branch, spec/risk/verification/planner fingerprints) and a
*per-role* dimension (each role's inspected content-surface digest, or its
current HEAD for a `strict_head` role). `head_sha`/`head_ref` and verification
wall-clock timestamps are removed from the key entirely. A fix commit that
does not touch a role's inspected surface no longer invalidates that role's
reuse; a fix commit or verification re-run that does touch it still does.

This mirrors story-vibepro-content-scoped-evidence-freshness (#384), which
already made *review result* freshness content-scoped instead of HEAD-bound.
This Story applies the same idea to the *evidence reuse* artifact (the
decision-index / evidence-plan / pr-prepare / gate-dag bundle handed to
reviewers as "first input"), which #384 left HEAD-bound.

## Problem

`buildEvidenceKeyInputs` previously hashed `head_sha`, `head_ref`,
`verification_command_timestamps`, and `verification_evidence_updated_at`
into the evidence-reuse key. Every fix commit moves `head_sha`; every
verification re-run moves the timestamps. Either alone changed the key, so
`compareEvidenceReuse` reported `stale` for the *entire* artifact on every
iteration of the self-review loop, even when nothing a reviewer had actually
inspected had changed. This forced full re-derivation of the evidence bundle
and repeated full-context reviews, which measured accounting attributed to a
majority of the token cost of Story-driven review waves (see the Story's
Background section).

## Old vs new key composition

Old `key_inputs` (single, undifferentiated, all roles share one verdict):

```
story_id, base_ref, base_sha, head_ref, head_sha,
spec_fingerprint, risk_surface_fingerprint,
verification_summary_fingerprint, verification_evidence_updated_at,
verification_command_timestamps, evidence_depth, planner_version
```

New `key_inputs` (base fields shared by every role, no HEAD, no timestamps):

```
story_id, base_ref, base_sha,
spec_fingerprint, risk_surface_fingerprint,
verification_summary_fingerprint,   # now content-only, see D2 below
evidence_depth, planner_version,
role_surface_digests: { "<stage>:<role>": { mode, digest } }
```

`role_surface_digests` is the new per-role dimension. For a `content_surface`
role, `digest` is `sha256:<hex>` of that role's last-recorded inspected
content surface, re-hashed against the *current* tree. For a `strict_head`
role, `digest` is the current `head_sha`. `evidence_key` is still a single
hash of the whole `key_inputs` object (base + `role_surface_digests`), so the
top-level `status`/`evidence_key` still flips to a fresh value the moment
*anything* changes -- consumers that only look at the top level (the
`gate:evidence_reuse_freshness` node, `senior-gap-judgment.js`,
`usage-report.js`) keep working unmodified. The new, additional `role_reuse`
map (see CRK-S-5 below) is what makes the change selective.

## Per-role digest source: reused, not reinvented

`role_surface_digests` is built by the new `buildRoleContentDigests(stageSummaries,
{ headSha })` (exported from `src/evidence-reuse.js`), which reads
`{stage, roles: [{role, content_binding, freshness_policy}]}` -- exactly the
shape `buildStageSummary` in `src/agent-review.js` already produces for
`prContext.agent_reviews.stages[]`. `content_binding.current_surface_hash` /
`.recorded_surface_hash` come from `src/content-binding.js`'s
`evaluateContentBinding`, the same content-hashing machinery #384 built for
review-result freshness (`bindReviewResult`). No new hashing logic was
introduced; the evidence-reuse key just consumes a digest that was already
being computed for a different purpose.

Two call sites feed `buildRoleContentDigests`:

- **Key build side** (`pr prepare`): `buildEvidenceKeyInputs` calls it with
  `prContext.agent_reviews.stages` and `git.head_sha`. `prContext.agent_reviews`
  is already fully populated by `summarizeAgentReviewsForPr` before
  `buildEvidenceReuse` runs in `src/pr-manager.js`, so no new call site was
  added there -- `buildEvidenceKeyInputs` was simply changed to read a field
  that was already on `prContext`.
- **Evaluation side** (`review prepare`): `prepareAgentReview` in
  `src/agent-review.js` now calls `buildStageSummary` *twice*. An early call,
  right after `collectReviewGitContext`, computes an
  `earlySummaryForDigests` used only to derive
  `buildRoleContentDigests([earlySummaryForDigests], { headSha })` as
  `currentRoleDigests` for `evaluateEvidenceReuseForReview`. That early call
  cannot be reused for the response/artifact summary, because
  `buildStageSummary` also reflects `prepareAgentReview`'s own write of
  `parallel-dispatch.md`, made later in the same call, which its
  `next_actions` and `parallel_dispatch.prepared` fields derive from
  (`parallelDispatchPrepared = await pathExists(parallelDispatchPath)`). A
  summary computed before that write reports `parallel_dispatch.prepared:
  false` and next-action text like "Prepare `<stage>` review dispatch" even
  though dispatch was just prepared. The original, still-present second call
  to `buildStageSummary`, positioned right before `writeReviewSummaryArtifacts`
  (its historical position, unchanged by this story), recomputes the summary
  *after* that write so the persisted `review-summary.{json,md}` and the
  returned `summary` reflect current on-disk state, e.g. "Run and record
  `<stage>:<role>`" once dispatch is prepared.

A role with no prior recorded review has no `content_binding` yet, so
`buildRoleContentDigests` omits it. `evaluateEvidenceReuseForReview` then
falls back to the shared base-only check for that role (nothing it inspected
could have changed, because it has not inspected anything yet).

## D1 -- why `gate_evidence`/`release_risk` are not hardcoded strict_head

There is no code path anywhere in `src/agent-review.js` that hardcodes
`freshness_mode: strict_head` for any role by name. Strictness is entirely
role-policy-driven: `getRolePolicy` resolves `freshness_mode` per role from
`.vibepro/config.json` `agent_reviews.roles.<role>.freshness_mode`, defaulting
to `content_surface`; a global `strict_head` default is explicitly rejected
(`normalizeAgentReviewPolicy` throws). `gate_evidence` and `release_risk` use
the `content_surface` default like every other role unless an operator
opts a specific role into `strict_head` with a `freshness_reason` -- this was
already the case before this Story (see
`docs/architecture/vibepro-content-scoped-evidence-freshness.md`, "Review
freshness policy").

Given that, `buildRoleContentDigests` branches on the generic
`role.freshness_policy.effective_mode === 'strict_head'` read from the
role's *own last-recorded* freshness policy, never on a role-name allowlist.
Hardcoding role names instead would itself have been a behavior change: it
would newly HEAD-bind roles that today run under the default
`content_surface` policy -- e.g. `gate_evidence`, which carries no
`agent_reviews.roles` entry in `.vibepro/config.json` on this branch or on
`origin/main`, and so is not HEAD-bound today. Branching on the role's own
resolved policy instead avoids introducing that change: whichever roles an
operator actually configures `freshness_mode: strict_head` keep
re-reviewing on every head change, exactly as CRK-S-3 requires, via the
same generic mechanism review freshness already uses; the Story does not
introduce a new strict-role list.

(History: an earlier draft of CRK-S-3 and the Story's `reason` field
described `gate_evidence`/`release_risk` as a "built-in strict HEAD role".
That was corrected on 2026-08-05 -- see the Story's Background section --
once review established neither role carries such a config entry. The
CRK-S-3 text in the Acceptance Criteria already reflects the correction,
and this section is written to match it.)

## D2 -- timestamp-free verification fingerprint

`summarizeVerificationEvidence` (kept, renamed nowhere) still returns the
*full* descriptive summary including `updated_at` and per-command
`executed_at`/`git_recorded_at` -- but it is no longer used for the key.
A new `buildVerificationContentSummary` produces a fingerprint input built
only from `kind`, `status`, `command`, `target`, `binding_status`,
`artifact_check_status`, and `observation_check_status` per command --
deliberately excluding `updated_at`, `executed_at`, `git_recorded_at`, and
`head_sha`. Excluding `head_sha` here as well (not just from the top-level
key) matters: a verification re-run after a fix commit reproduces the same
command/target/status at a *new* head and a *new* timestamp, and without
excluding both, the fingerprint would still churn on every re-run even after
CRK-S-1 removed `head_sha`/`head_ref` from the rest of the key -- silently
reintroducing the same problem through a side door.

The old (now removed from the key, kept only as descriptive metadata)
`verification_evidence_updated_at` / `verification_command_timestamps`
fields are still written to the artifact as
`verification_evidence_metadata: { updated_at, command_timestamps }` so
`usage-report.js`, `canonical-audit.js`, and the review-request Markdown
that show "when was this last verified" keep working. Those two consumer
files gained one extra `??` fallback each
(`evidenceReuse.verification_evidence_metadata?.updated_at` /
`.command_timestamps`) so they still resolve the value when reading a raw
`evidence-reuse.json` (as opposed to the `summarizeEvidenceReuse` projection,
which already read from the new location).

## CRK-S-4 -- global invalidation invariants

`compareEvidenceReuse` first diffs the *base* fields only:
`base_sha`, `spec_fingerprint`, `risk_surface_fingerprint`,
`verification_summary_fingerprint`, `planner_version`. If any of those
differ from the previous artifact, every role's entry in the new `role_reuse`
map is forced to `status: 'miss'` regardless of whether that role's own
digest happens to still match -- `spec_fingerprint`/`risk_surface_fingerprint`/
`planner_version` drift still invalidates all roles, unconditionally, exactly
as before this Story. Only when the base is unchanged does a role's own
digest comparison determine its individual verdict (CRK-S-2).

One incidental invariant surfaced while writing the CRK-S-1 contract test:
`risk_surface_fingerprint` is itself partly diff-shape-derived
(`change_classification.risk_surfaces`, `engineering_judgment.active_axes`),
so two *different* commits against a fixed base can legitimately produce a
different `risk_surface_fingerprint` even when they touch the same file --
this is correct, pre-existing, CRK-S-4-covered behavior, not a defect
introduced here. It means "same content, different HEAD" is only guaranteed
to be a hit when the base-relative diff shape is otherwise unchanged (e.g.
amending a commit rather than stacking a new one) -- see the CRK-S-1 test's
comment in `test/evidence-summary-reuse.test.js` for the concrete repro.

## `evidence-reuse.json` schema delta

New top-level fields on the artifact (all additive; nothing existing was
removed from the artifact, only from the *key*):

- `role_reuse`: `{ "<stage>:<role>": { status: 'hit'|'miss', mode:
  'content_surface'|'strict_head', digest, previous_digest, stale_reasons:
  [{field, previous, current, reason}] } }` -- CRK-S-5. `status: 'miss'`
  covers both "this role's surface/HEAD changed" and "no previous baseline
  exists for this role yet"; `stale_reasons` is empty in the latter case
  (nothing to explain, there is no prior state to diff against). The
  `{field, previous, current, reason}` shape is the same one
  `compareEvidenceReuse`'s top-level `stale_reasons` already used, reused
  here rather than inventing a second shape.
- `recorded_git: { base_ref, base_sha, head_ref, head_sha }` -- descriptive
  only, not part of the key. Kept so `decision_outcome_summary` exposure
  (which is inherently a bounded current-HEAD projection, unrelated to
  content-surface reasoning) can still tell whether the reviewer's current
  HEAD matches the HEAD the artifact was generated at, without resurrecting
  `head_sha` in `key_inputs`.
- `verification_evidence_metadata: { updated_at, command_timestamps }` --
  descriptive only (D2).

`key_inputs.head_sha` / `.head_ref` / `.verification_evidence_updated_at` /
`.verification_command_timestamps` no longer exist. `key_inputs.role_surface_digests`
is new.

## `evaluateEvidenceReuseForReview` (CRK-S-2 / D5)

`review prepare` now computes one verdict per requested role
(`plan.evidence_reuse.by_role[role]`), each with the same field shape the old
single verdict had (`status`, `fresh`, `first_input`, `stale_reasons`,
`decision_outcome_summary`, ...), sourced from that role's own
`role_surface_digests` entry. The stage-level aggregate at
`plan.evidence_reuse` (top level, no `by_role` indexing) is kept for backward
compatibility: it is fresh only if every requested role's own verdict is
fresh, matching the historical "one verdict for the whole prepare call"
behavior for callers that do not look at `by_role`.

`renderEvidenceReuseReviewInput(plan, language, role)` picks
`plan.evidence_reuse.by_role[role]` when a `role` is supplied and falls back
to the aggregate otherwise. `review-request-{role}.md` (one file per role)
passes its own `role`, so each role's request shows that role's own reuse
verdict. `parallel-dispatch.md` (one file per stage, covering every requested
role) omits `role` and renders the aggregate, matching its historical
multi-role shape.

The redundant standalone `head_sha` equality check that used to gate the
whole verdict is removed for `content_surface` roles (it no longer has a
`key_inputs.head_sha` to compare against) and kept, per role, for
`strict_head` roles (comparing the role's recorded HEAD digest against the
reviewer's current HEAD from `collectReviewGitContext`).

## Rollback

Revert `src/evidence-reuse.js`, the `prepareAgentReview` /
`renderEvidenceReuseReviewInput` changes in `src/agent-review.js`, and the two
added `??` fallbacks in `src/usage-report.js` / `src/canonical-audit.js`.
`buildEvidenceKeyInputs` reverts to hashing `head_sha`/`head_ref`/verification
timestamps directly, `compareEvidenceReuse` reverts to its single
undifferentiated verdict, and `evaluateEvidenceReuseForReview` reverts to one
head-bound verdict per `review prepare` call -- restoring the original
head-bound reuse behavior with no data migration required (`role_reuse` /
`recorded_git` / `verification_evidence_metadata` are additive fields that
older code simply never reads).

## Invariants

- A role's own passing evidence-reuse verdict survives any commit that does
  not touch that role's last-inspected content surface (CRK-S-1/CRK-S-2).
- A `strict_head` role's evidence-reuse verdict still misses on every HEAD
  change, via the same role-policy mechanism review freshness already uses,
  never a hardcoded role-name list (CRK-S-3/D1).
- `spec_fingerprint`, `risk_surface_fingerprint`, or `planner_version` drift
  invalidates every role's verdict, unconditionally (CRK-S-4).
- A verification re-run that reproduces the same command/target/status does
  not invalidate reuse; a verification content change still does (D2).
- `evidence-reuse.json`'s `role_reuse` map is sufficient on its own to
  reconstruct, for any role, whether it hit or missed and exactly which
  digest changed (CRK-S-5).
