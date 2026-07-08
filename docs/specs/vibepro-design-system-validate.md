---
title: VibePro Design System Validate Spec
status: draft
created_at: 2026-05-26
updated_at: 2026-07-08
parent_design:
  - vibepro-uiux-style-preset-token-gate
related_stories:
  - story-vibepro-design-system-validate
---

# VibePro Design System Validate Spec

## Command

`vibepro design-system validate [repo] --id <ds-id> --story-id <story-id> [--base <base-ref>] [--json]`

The command validates an existing `.vibepro/design-system/<ds-id>/design-system.json` against the selected Story/Spec/Architecture context.

## Output

Artifacts:

- `.vibepro/design-system/<ds-id>/validation/<story-id>.json`
- `.vibepro/design-system/<ds-id>/validation/<story-id>.md`

The JSON output MUST include:

- `workflow: design-system-validation`
- `design_system_id`
- `story_id`
- `authority`
- `story_context`
- `style_token_drift`
- `summary.status`
- `findings[]`

## Required Findings

- `DS-VALIDATE-DRIFT`
- `DS-VALIDATE-CTA-PRIORITY`
- `DS-VALIDATE-STATE-SEMANTICS`
- `DS-VALIDATE-COMPONENT-ROLES`
- `DS-VALIDATE-NAV-DENSITY`
- `DS-VALIDATE-STORY-CONTEXT`
- `DS-VALIDATE-STORY-UI-SIGNAL`
- `DS-VALIDATE-STORY-DS-ALIGNMENT`
- `DS-VALIDATE-STYLE-PRESET-COVERAGE`
- `DS-VALIDATE-STYLE-TOKEN-DRIFT`
- `DS-VALIDATE-SECRET-SCAN`

When `--base` is provided, the command MUST diff changed UI/style files from that ref to `HEAD` and report one-off color, typography, radius, shadow, or spacing values that bypass native token policy as `DS-VALIDATE-STYLE-TOKEN-DRIFT`.

## Gate Semantics

`block` means the DS cannot be used as implementation input. `needs_evidence` means the Story or DS artifact is missing required evidence. `needs_review` means the change may continue only with explicit human or agent review. `pass` means this validation concern is satisfied.
