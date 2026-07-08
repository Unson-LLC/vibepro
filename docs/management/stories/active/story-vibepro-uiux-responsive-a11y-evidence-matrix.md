---
story_id: story-vibepro-uiux-responsive-a11y-evidence-matrix
title: UI/UX responsive and accessibility evidence matrix
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "Qiita UI/UX prompt checklist gap review"
  url: https://qiita.com/yusuke_ando_vj/items/dd17a285217a15841a3a
related_stories:
  - story-vibepro-visual-evidence-gate-ux
  - story-vibepro-flow-screenshot-visual-gate-bridge
  - story-vibepro-visual-residual-local-runner
created_at: 2026-07-08
updated_at: 2026-07-08
---

# Story

Visual QA currently accepts explicit screenshot evidence, and accessibility
evidence can be attached, but responsive and accessibility proof are not yet a
standard route-by-viewport matrix. UI/UX gates should show exactly which screens
were checked on which viewports and which accessibility checks remain missing.

## User Story

**As a** reviewer of a UI-heavy PR<br>
**I want** responsive screenshots and accessibility checks organized as a
story-scoped evidence matrix<br>
**So that** I can see whether the UI/UX quality claim is backed by current-head
proof instead of broad test success

## Scope

- Generate `.vibepro/uiux/<story-id>/responsive-a11y-matrix.json` and
  `responsive-a11y-matrix.md`.
- Matrix dimensions include route/screen, viewport, state, screenshot artifact,
  overflow/overlap result, keyboard/focus result, accessibility result, command,
  git head, and status.
- Support mobile, tablet, and desktop defaults, with story-specific overrides.
- Connect passing matrix rows to `gate:visual_qa` and accessibility evidence.
- Keep `needs_setup`, `auth_required`, and `resource_unavailable` explicit
  instead of treating unavailable checks as pass or zero.

## Acceptance Criteria

- [ ] UIEA-S-1: `vibepro uiux evidence <repo> --id <story-id>` creates a
  matrix from recorded verify/capture artifacts.
- [ ] UIEA-S-2: `pr prepare` can summarize missing matrix rows for UI-heavy
  stories.
- [ ] UIEA-S-3: A screenshot without route, viewport, state, command, and git
  head does not satisfy the matrix.
- [ ] UIEA-S-4: Accessibility evidence is reported as pass, fail,
  needs_setup, auth_required, resource_unavailable, or missing.
- [ ] UIEA-S-5: Existing visual residual analysis remains authoritative when
  present; the matrix is the organized proof surface, not a waiver path.

## Non Goals

- Replacing manual reviewer judgment with screenshot existence.
- Requiring all products to use the same viewport set.
- Treating broad E2E success as accessibility proof.
