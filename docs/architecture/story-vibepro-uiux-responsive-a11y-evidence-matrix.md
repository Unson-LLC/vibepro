# story-vibepro-uiux-responsive-a11y-evidence-matrix Architecture

## Shape

`src/uiux-responsive-a11y.js` owns the story-scoped matrix builder. It reads
recorded verify/capture artifacts, normalizes route, viewport, state,
screenshot, overflow/overlap, keyboard/focus, accessibility, command, and git
head fields, then writes `.vibepro/uiux/<story-id>/responsive-a11y-matrix.json`
and `.md`.

`src/cli.js` exposes `vibepro uiux evidence [repo] --id <story-id>` with
`--route`, `--routes`, `--viewport`, `--viewports`, and `--from` overrides. The
legacy alias `uiux matrix` remains accepted to avoid breaking existing next
command hints, but help and generated guidance use `uiux evidence`.

`src/pr-manager.js` reads the matrix through `readResponsiveA11yMatrixForPr`
and places a bounded summary in `pr_context.uiux_responsive_a11y_matrix`. The PR
summary reports status, artifact, and missing evidence count without embedding
the full matrix.

## Status Model

Matrix rows use these statuses:

- `pass` when route, viewport, state, screenshot, command, git head, overflow,
  keyboard/focus, and accessibility evidence are all present and passing.
- `needs_evidence` when required metadata or required checks are missing.
- `fail` when an explicit check failed.
- `needs_setup`, `auth_required`, or `resource_unavailable` when a recorded
  check could not run for that explicit reason.

Accessibility status is normalized to `pass`, `fail`, `needs_setup`,
`auth_required`, `resource_unavailable`, or `missing`. Unknown values are
treated as `missing`.

## Authority Boundary

The responsive/a11y matrix is an organized proof surface. It does not replace
visual residual analysis and does not waive visual QA findings. When visual
residual evidence is present, the matrix records `visual_residual_authority`
with the source artifact and status so reviewers can follow the authoritative
visual QA artifact directly.
