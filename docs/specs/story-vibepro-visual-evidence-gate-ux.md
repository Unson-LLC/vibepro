---
story_id: story-vibepro-visual-evidence-gate-ux
title: Visual Evidence Gate UX Spec
parent_design: vibepro-visual-evidence-gate-ux
---

# Spec

## Invariants

### VQG-INV-1: Visual gate is still required for UI changes

UI source changes MUST continue to add required `gate:visual_qa` coverage.
Missing visual evidence MUST keep the gate unresolved.

### VQG-INV-2: Residual artifacts remain authoritative

When `.vibepro/qa/<qa-id>/` residual analysis exists, Visual QA Gate MUST use it
before any verification-evidence fallback. Residual runs above threshold MUST
remain `needs_review`.

### VQG-INV-3: Verification fallback must be current and explicit

Verification evidence MAY satisfy Visual QA Gate only when the command is bound
to the current git head, has `status=pass`, and classifies as both `visual_qa`
and `screenshot`.

## Contracts

### VQG-CONTRACT-1: Accepted visual markers

The classifier MUST recognize `visual_qa`, `visual-qa`, `visual qa`, visual
regression/check wording, `screenshot`, and `screen shot` wording as explicit
visual evidence.

### VQG-CONTRACT-2: Accessibility evidence is supporting

`accessibility_evidence` MAY be recorded and surfaced as supporting evidence, but
it MUST NOT replace the required screenshot marker.

### VQG-CONTRACT-3: Gate instructions are executable

Unresolved Visual QA Gate feedback MUST include a concrete `vibepro verify
record --kind e2e --status pass` shape with `visual_qa` and `screenshot`
scenario markers.

## Scenarios

### VQG-S-1: No visual evidence

Given a UI source diff and no residual or verification visual evidence, `pr
prepare` keeps `gate:visual_qa` unresolved.

### VQG-S-2: Current visual verification fallback

Given a UI source diff and current-head passing E2E verification evidence with
`visual_qa` and `screenshot` markers, `pr prepare` marks `gate:visual_qa` as
`ready_for_review` when no residual run exists.

### VQG-S-3: Generic verification does not pass visual gate

Given only broad verification without explicit visual markers, `pr prepare` does
not treat it as visual evidence.

### VQG-S-4: Residual evidence wins

Given residual evidence and verification evidence, `pr prepare` uses the
residual status for Visual QA Gate.

### VQG-S-5: Actionable missing-evidence guidance

Given unresolved Visual QA Gate, PR blocking guidance names the accepted
`visual_qa` and `screenshot` scenario markers.

## Anti-patterns

### VQG-AP-1: Broad test equals visual proof

Do not infer visual quality from `npm test`, typecheck, or a generic E2E command
unless visual markers are recorded.

### VQG-AP-2: Residual threshold bypass

Do not let verification fallback override residual runs that already require
review.

## Verification

- Node regression tests cover VQG-S-1 through VQG-S-5.
- `npm run typecheck` validates edited modules.
- `vibepro pr prepare` must emit a Gate DAG without implicit spec fallback for
  this story.
