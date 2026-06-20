---
story_id: story-vibepro-issues-189-204-gate-friction
title: Gate friction reduction Spec for issues 189 and 204
---

# Spec

## Invariants

- `INV-GFR-1`: A reused Agent Review result must remain explicitly marked with `binding_status=reused_merge_delta`; silent reuse is not allowed.
- `INV-GFR-2`: Merge-delta reuse must fail closed when the changed path set overlaps recorded `inspection.inputs`, the inspected file surface is missing, or the diff cannot be resolved.
- `INV-GFR-3`: Story E2E AC coverage must require executable assertions; marker-only comments are not coverage.
- `INV-GFR-4`: Coverage diagnostics must expose the inspected file and candidate test block so another engineer can reconstruct why a gate remained unresolved.

## Contracts

- `CON-GFR-1`: `acceptance_e2e_coverage.coverage_diagnostics.missing_acceptance_criteria[]` contains `id`, `criterion`, `candidate_diagnostics`, and `guidance`.
- `CON-GFR-2`: Each candidate diagnostic contains `path`, `executable`, and per-block diagnostics with `line_start`, `line_end`, `test_name`, assertion samples, booleans for marker/criterion matching, and miss reasons.
- `CON-GFR-3`: AC coverage may use local static string/array bindings only when they are referenced by an executable assertion statement.
- `CON-GFR-4`: `buildE2eCoverageReason` must mention `coverage_diagnostics` when matched E2E files exist but AC coverage is missing.

## Scenarios

- `S-GFR-1`: Given a passing review inspected `src/runtime.js`, when current HEAD only adds `docs/base-sync.md`, then the role remains passing with `binding_status=reused_merge_delta`.
- `S-GFR-2`: Given the same review, when current HEAD changes `src/runtime.js`, then the role remains stale and names the touched reviewed file.
- `S-GFR-3`: Given a matching E2E file contains a candidate test block with AC text but no AC marker, when `pr prepare` runs, then the E2E gate stays `needs_evidence` and diagnostics explain the missing marker.
- `S-GFR-4`: Given a matching E2E file contains multiline `expect(...)` that references `criteria[0]` and `markers[0]`, when both local arrays are static string arrays, then the AC is covered.

## Anti-patterns

- `AP-GFR-1`: Passing AC coverage because a comment mentions `ac:1` without any executable assertion.
- `AP-GFR-2`: Reusing stale Agent Review evidence when the reviewed source file changed.
- `AP-GFR-3`: Reporting "AC missing" without showing which candidate file/block was inspected.

## Verification

- `V-GFR-1`: `test/vibepro-cli.test.js` covers candidate diagnostics, local binding extraction, multiline assertion coverage, and true-negative marker failures.
- `V-GFR-2`: Existing merge-delta tests continue to cover reused and stale review bindings for #189.
- `V-GFR-3`: `test/e2e/story-vibepro-issues-189-204-gate-friction-main.test.js` maps this Story's ACs and scenarios to executable assertions.
