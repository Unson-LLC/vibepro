---
story_id: story-vibepro-visual-evidence-gate-ux
title: "Visual QA gate accepts current-head visual verification evidence"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "VibePro evidence gate feels too heavy when visual proof already exists"
related_stories:
  - story-vibepro-verification-evidence-roi
  - story-vibepro-evidence-token-normalization
  - story-vibepro-verification-observation-artifacts
parent_design: vibepro-visual-evidence-gate-ux
architecture_docs:
  - docs/architecture/vibepro-visual-evidence-gate-ux.md
spec_docs:
  - docs/specs/story-vibepro-visual-evidence-gate-ux.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

Visual QA gate should protect user-facing UI quality without forcing a second
artifact format when current-head verification already records explicit visual
evidence.

## User Story

**As a** VibePro user preparing a PR with UI changes<br>
**I want** Visual QA Gate to accept current-head `verify record` evidence that
explicitly names visual QA and screenshot proof<br>
**So that** I do not have to duplicate the same evidence only because it was not
stored under `.vibepro/qa/<qa-id>/`

## Scope

- Preserve existing `.vibepro/qa/*` residual analysis behavior and threshold checks.
- Use current-head passing verification evidence only when residual artifacts are absent.
- Require explicit `visual_qa` and `screenshot` evidence markers for the fallback.
- Normalize `visual_qa`, `visual-qa`, `visual qa`, `screenshot`, and screen-shot wording.
- Improve unresolved Visual QA Gate guidance so the next command is concrete.

## Acceptance Criteria

- [x] VQG-S-1: A UI source change with no visual evidence still produces an unresolved `gate:visual_qa`.
- [x] VQG-S-2: A current-head passing `verify record --kind e2e` with `visual_qa` and `screenshot` evidence makes `gate:visual_qa` ready for review when no `.vibepro/qa/*` residual run exists.
- [x] VQG-S-3: A generic verification command without explicit visual markers does not satisfy Visual QA Gate.
- [x] VQG-S-4: Existing residual analysis evidence remains authoritative when present, including `needs_review` residuals.
- [x] VQG-S-5: Gate guidance names the accepted `verify record` scenario markers.

## Non Goals

- Removing Visual QA Gate from UI source changes.
- Treating broad test success as visual proof.
- Ignoring residual thresholds when `.vibepro/qa/*` artifacts are present.
- Generating screenshots automatically inside `pr prepare`.
