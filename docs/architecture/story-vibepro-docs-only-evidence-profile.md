# docs-only Evidence Profile Architecture

## Decision

Add one pure classifier, `src/docs-only-change.js`, as the shared answer to "does this change touch product code?", and consume it as an **input** at the two places that already own evidence weight: the evidence depth planner (`src/evidence-depth-planner.js`) and the canonical evidence cost budget (`src/evidence-cost-budget.js`). Neither owner's contract is re-implemented.

Separately, make merge diff-statistics collection base-authority aware in `src/merge-manager.js`, so a change set that could not be measured is recorded as unmeasured instead of as zero.

These two changes are one intent: evidence weight should follow the measured change surface, and a lost measurement must never look like a small change.

## Current reality this replaces

Across the 89 canonical audit bundles promoted since 2026-07-01, 27 record `budget_status: exceeded`. Two distinct causes were conflated in that number:

1. **Lost diff base.** The five largest over-budget bundles (4,996 / 3,773 / 3,606 / 2,158 / 1,502 artifact lines) all record `src=0 test=0 docs=0 other=0` with `merge_commit_sha == base_sha`. These are implementation Stories whose diff was collected against `origin/<base>` *after* the PR had landed, so `origin/<base>...<head>` was empty. `product_changed_lines: 0` was persisted as a fact, and `artifact_code_ratio` collapsed to `null`.
2. **Meaningless ratio for documentation.** Documentation and roadmap Stories have no product code, so the artifact-to-code ratio judged them against a denominator that only ever contained docs lines.

Both causes pushed noise into the same `budget_exceeded` counter that is supposed to point at heavy implementation Stories.

## Components and boundaries

### Change-surface classifier (`src/docs-only-change.js`)

- Classifies a single path as `product_code`, `docs`, `evidence_artifacts`, or `unknown`. `docs/` outranks the product prefixes so a spec is never read as code; the VibePro-managed evidence prefixes (`.vibepro/`, promoted audit bundles, the design registry) are checked first because they live under `docs/` too.
- `detectDocsOnlyChange` reports `docs_only` only when at least one `docs` path changed and no `product_code` path changed.
- Fails conservative by construction. An unclassified path, a VibePro-record-only change, an empty observed change set, and an unavailable diff-stats status all resolve to `unknown`, which keeps the change on the implementation profile. A wrong `docs_only` verdict silently lightens evidence; a wrong `product_change` verdict only costs tokens.
- Reports line counts only when per-file numstat was actually observed, and `null` otherwise, so "not measured" is never returned as zero.
- Owns no policy: it does not choose a depth, a budget, or a gate outcome.

### Evidence depth planner (input, not re-implementation)

- `buildEvidencePlan` accepts a resolved `docsOnlyChange`, or derives one from the `git.diff_line_stats` / `git.changed_files` it already receives.
- The planner keeps its schema version, its summary-first default depth, its artifact-policy vocabulary, its manual-override contract, and its risk escalation behaviour unchanged.
- What it adds is attribution: `docs_only_change`, `planner_inputs.docs_only_status`, `planner_inputs.docs_only_reason`, and `default_depth_reason`. Risk surfaces still escalate for a docs-only change; documentation never weakens gate or review requirements.

### Canonical evidence cost budget

- Selects the budget profile from the change surface: `docs_only`, else the pre-existing `high` / `normal` split.
- The `docs_only` profile keeps the **same** absolute canonical artifact line threshold as `normal`. Raising the global threshold is an explicit non-goal; the ratio rule is simply not applied, because there is no product-code denominator to divide by. The ratio is still measured and persisted — it stops being a verdict, not a measurement.
- Resolves the persistence depth to `summary` for a docs-only change. An explicit `--evidence-depth` request stays authoritative above that default.
- Reports the verdict on separated axes so one Story's spend cannot be read as another's: `budget_scope` names which axis applies, `implementation_budget_status` is `not_applicable` for a docs-only change, and `docs_only_budget_status` is `not_applicable` for an implementation change. `budget_status` remains the unscoped verdict, so nothing is hidden from the audit trail.
- Distinguishes the two kinds of zero: `product_code_changed_lines` is `0` with reason `docs_only` for a documentation change, and `null` with status `unavailable` when the diff base could not be resolved.
- `applyCanonicalEvidenceBudgetStatus` is shared with the compact canonical writer, which re-measures its own persisted output. Both passes derive the verdict the same way, so a docs-only bundle keeps its scope through compaction.

### Merge diff-base authority

- `collectMergeDiffLineStats` checks containment before it measures. A candidate base that already contains the head cannot express the pre-merge diff, so it is rejected rather than measured.
- When the merge commit is known, its first parent is the authoritative pre-merge base — correct for both a merge commit and a squash merge.
- `execute merge` collects statistics before `gh pr merge` as before; when that pre-merge collection could not resolve a usable base (the PR was already merged externally), it re-collects once the merge commit is resolved.
- If no candidate base survives, the result is `diff_stats.status: unavailable` with the containment reason and `base_authority: unresolved`. Recording nothing is correct; recording zero is not.

### Usage report

- Splits the aggregate signal into `implementation_budget_exceeded_count` and `docs_only_budget_exceeded_count` (with `docs_only_bundle_count`), and carries `budget_scope` on each per-story row.
- A canonical bundle promoted before this change carries no `budget_scope` and stays on the implementation axis, so historical counts are unchanged.

## Data flow

1. `pr prepare` observes the change surface (`git.diff_line_stats`, `git.changed_files`) and passes it to `buildEvidencePlan`, which records the docs-only verdict alongside the depth it already resolves.
2. `execute merge` resolves a base that predates the merge, measures per-file statistics against it, and persists both the statistics and their provenance (`refs.base_authority`) on the merge artifact.
3. `promoteCanonicalAuditArtifacts` reads those statistics, resolves the change surface from them, and writes a cost summary carrying the scope-separated verdict into the canonical bundle.
4. `usage report` reads the promoted bundles and reports documentation spend and implementation spend on separate axes.

## Alternatives considered

- **Exempt docs-only Stories from canonical audit entirely.** Rejected: it removes the audit trail, which is an explicit non-goal.
- **Raise the global budget so documentation Stories stop exceeding.** Rejected: it hides real implementation regressions behind a looser threshold.
- **Treat the empty post-merge diff as a legitimate zero and special-case it downstream.** Rejected: the zero is already persisted in 5 bundles and cannot be distinguished from a genuinely tiny change once written. The base must be fixed at collection time.

## Compatibility and rollback

The evidence depth vocabulary (`summary` / `standard` / `full`), the planner contract, and `product_changed_lines` semantics are unchanged. New fields are additive; consumers that do not read them behave as before. Rollback is one revert of the classifier, the profile default, the budget split, and the diff-base check; bundles already promoted stay valid and readable.

## Boundary

Depth selection, budget definition, and diff-stats base preservation only. Gate semantics, review requirements, and the canonical audit trail for documentation changes are untouched.
