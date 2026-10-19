---
title: Localized UI bug_fix evidence caps
status: accepted
---

# Architecture

## Problem

Localized UI bug fixes with a handful of product lines have repeatedly shipped
with six-figure evidence lines and dozens of PNGs because Spec ACs required
other-screen full-pixel matrices and width×state grids. Evidence-only rework
then dominated review cycles (brainbase-organization PR #615 / Spec #612).

This note defines **future** Spec AC authoring defaults. It does not retroactively
change acceptance criteria for in-flight #615 / #612.

## Mechanical `localized_bug_fix` profile

Classification uses **git/diff metrics only** (implemented in
`src/localized-bugfix-evidence.js`):

| Constant | Value |
|---|---|
| `LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_FILES` | `2` |
| `LOCALIZED_BUGFIX_MAX_PRODUCT_SOURCE_LOC` | `80` (additions + deletions on product source paths) |

Product source paths: **all changed paths in the PR diff** `base...head`
except tests, docs, evidence artifacts (including `.vibepro/`), measure-only
scripts (`measure-*` / `*-measure`), image/summary evidence files, and shared
layout/CSS glob hits. Example: `apps/web/public/meeting-triage.js` counts as
product source for brainbase #615.

The mechanical classifier reads `git diff --numstat <base>...<head>` (same range
as `pr prepare`), not uncommitted working-tree changes.

Disqualifiers: any changed path matching `SHARED_LAYOUT_CSS_PATH_GLOBS` (shared
layout, global CSS, tailwind/postcss config, design-system/theme/styles trees,
etc. — full list in code).

When the Story `contract_type` is `bug_fix` / `regression_fix` and the
mechanical profile holds, `vibepro spec write` adds a non-blocking warning if
Spec clauses demand more than the `primary` tier cap.

## Evidence tiers

### `primary` (default for mechanical localized bug_fix)

Required in git:

- `*-summary.json` — counts, `outsidePixels`, digests, excluded rects
- Measure script + unit tests
- ≤ `4` PNGs (bug viewport + ≥ `760px` sanity viewport)
- ≤ `6` viewport×state cells

Not required in git (CI/local artifacts OK when digests appear in summary):

- Full computed-style dumps
- Full capture reports
- Full width×state PNG matrices
- Other-screen full-pixel matrices

### `regression_matrix`

Use only when the diff touches shared layout/CSS globs or the Story documents
multi-route blast radius. Requires explicit `ui_verification.evidence_tier`:
`regression_matrix` plus blast-radius language.

## Nondeterministic surfaces

Declare in Spec:

```json
"ui_verification": {
  "nondeterministic_surfaces": ["world"]
}
```

Policy:

1. Run before-a vs before-b on the same commit; drift &gt; 0 ⇒ mark
   nondeterministic for that surface.
2. **Listed surfaces:** computed-style path equality is pass/fail; pixel
   outside exclude rects is advisory only.
3. **Unlisted surfaces:** pixel diff remains pass/fail (no global “pixel is
   advisory” rule).

Enforced in `src/ui-visual-verify-policy.js` via `verify record` observation
keys (`ui_visual_surface_id`, `ui_visual_pixel_diff_pass`,
`ui_visual_computed_style_pass`, `ui_visual_nondeterministic_surfaces`).

## Maintainer sendback

Evidence-only sendback must cite the missing **slim** cell (summary field, unit
test, specific PNG), not a blanket request to restore an entire matrix.

## Intended outcome

Fewer evidence-only interventions and rework cycles per accepted small UI
bug_fix deliverable while keeping regression depth available when blast radius
warrants it.
