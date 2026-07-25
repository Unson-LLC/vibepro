---
story_id: story-vibepro-docs-only-evidence-profile
title: docs-only Evidence Profile Spec
parent_design: story-vibepro-docs-only-evidence-profile
---

# Spec

Machine-readable clauses are the authority: `docs/specs/story-vibepro-docs-only-evidence-profile.vibepro.json` (clause ids `C-001`..`C-007`). This document is the human-readable projection of the same contract.

## Contract

- `DOE-CONTRACT-001` (C-001): change-surface resolution MUST classify every changed path as exactly one of `product_code`, `docs`, `evidence_artifacts`, or `unknown`, and MUST report `docs_only` only when at least one `docs` path changed and no `product_code` path changed.
- `DOE-CONTRACT-002` (C-001): an unclassified path, a VibePro-record-only change, an empty observed change set, and an unavailable diff-stats status MUST each resolve to `unknown`, never to `docs_only`.
- `DOE-CONTRACT-003` (C-001): line counts MUST be reported only when per-file numstat was observed, and `null` otherwise; an unmeasured count MUST NOT be reported as zero.
- `DOE-CONTRACT-004` (C-002): a docs-only change MUST default to `summary` persistence depth, and an explicit requested evidence depth MUST remain authoritative over that default.
- `DOE-CONTRACT-004a` (C-002): the docs-only default MUST NOT override the pre-existing risk escalation; a docs-only change with a high-risk profile or an active trigger signal MUST keep the depth it resolved to before this change, and MUST keep its recorded `risk_profile` and `trigger_signals`.
- `DOE-CONTRACT-001a` (C-001): under `docs/`, the deployed manual surface (`docs/.vitepress/`, `docs/public/`), machine-read responsibility contracts (`docs/contracts/`), and machine-read registries inside the documentation trees (`docs/architecture/target-model.json`, `docs/management/roi-ledger/`, `docs/management/responsibility-authority/`) MUST classify as `product_code`; the requirement trees (`docs/management/`, `docs/specs/`, `docs/architecture/`, `docs/adr/`) MUST classify as `docs` whatever their file extension; anything else under `docs/` MUST classify as `docs` only when it carries a documentation extension.
- `DOE-CONTRACT-001b` (C-001): a `docs_only` verdict MUST name the VibePro-managed records it tolerated in `sample_evidence_artifact_paths`, so the accepted exclusion is never silent.
- `DOE-CONTRACT-005` (C-002): a change that touches product code MUST keep the pre-existing implementation depth resolution unchanged.
- `DOE-CONTRACT-006` (C-003): the evidence cost budget MUST define a `docs_only` profile whose absolute canonical artifact line threshold equals the `normal` profile's, and which does not apply the artifact-to-code ratio rule.
- `DOE-CONTRACT-006a` (C-003): the `docs_only` profile MUST NOT be stricter than the risk-based profile the same change would otherwise use. It MUST preserve the ratio-derived effective line floor (`max(configured_lines, changed_lines x ratio)`) via `line_budget_ratio`, and MUST take the more permissive of the docs-only and risk-based line budgets and floors. `budget.risk_profile_basis` MUST record the risk profile it was relaxed over.
- `DOE-CONTRACT-007` (C-003): budget verdicts MUST be reported on separated axes — `budget_scope`, `implementation_budget_status` (`not_applicable` for docs-only), and `docs_only_budget_status` (`not_applicable` for implementation changes).
- `DOE-CONTRACT-008` (C-003): a caller-supplied budget that predates the `docs_only` profile MUST fall back to the `normal` profile rather than becoming unbounded.
- `DOE-CONTRACT-009` (C-004): merge diff-statistic collection MUST reject a candidate base that already contains the head, and MUST prefer the merge commit's first parent as the pre-merge base when a merge commit is known.
- `DOE-CONTRACT-010` (C-004): when no usable pre-merge base exists, diff statistics MUST be recorded as `unavailable` with the containment reason, never as an available zero-line change set.
- `DOE-CONTRACT-011` (C-005): `product_code_changed_lines` MUST be `0` with reason `docs_only` for a documentation change, and `null` with status `unavailable` when the diff base could not be resolved.
- `DOE-CONTRACT-012` (C-006): the evidence depth planner contract MUST NOT be re-implemented; docs-only detection enters as a planner input, and the planner's schema version, summary-first default, artifact policy vocabulary, and risk escalation MUST stay unchanged.
- `DOE-CONTRACT-013` (C-007): the usage report MUST separate `implementation_budget_exceeded_count` from `docs_only_budget_exceeded_count`, and a canonical bundle carrying no `budget_scope` MUST remain on the implementation axis.

## Inherited behavior

- The merge gate-authorization branch `!gateAuthorization.allowed` in `src/merge-manager.js` is unchanged and existing; diff-base collection was added alongside it without altering when a merge is authorized.
- When a change touches product code, evidence depth resolution, budget profile selection, and pre-merge diff-base collection are unchanged and existing (`src/evidence-cost-budget.js`, `src/evidence-depth-planner.js`, `src/merge-manager.js`).
- When a canonical bundle carries no `budget_scope`, its place in the implementation budget signal is unchanged and existing (`src/usage-report.js`).
- The evidence depth vocabulary `summary` / `standard` / `full` and `product_changed_lines` semantics are unchanged and existing (`src/evidence-cost-budget.js`).

## Non Goals

- Retiring canonical audit for docs-only Stories.
- Raising the global budget threshold.
- Weakening review or gate requirements for documentation changes beyond depth.

## Target Files

- `src/docs-only-change.js`
- `src/evidence-cost-budget.js`
- `src/evidence-depth-planner.js`
- `src/canonical-audit.js`
- `src/merge-manager.js`
- `src/usage-report.js`
- `test/docs-only-evidence-profile.test.js`
- `test/merge-diff-base-preservation.test.js`
- `test/docs-only-evidence-profile-integration.test.js`
- `test/e2e/story-vibepro-docs-only-evidence-profile-acceptance.spec.js`
