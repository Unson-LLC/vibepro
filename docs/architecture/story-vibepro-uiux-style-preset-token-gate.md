# story-vibepro-uiux-style-preset-token-gate Architecture

## Shape

Style preset resolution lives in `src/uiux-style-presets.js`. It owns the
supported product archetypes, default archetype, inference rules, explicit
selection normalization, not-applicable handling, and the authority boundary.

`src/uiux-intake.js` records style preset selection as optional metadata outside
the existing required 18 intake fields, so current intake coverage semantics do
not change. Coverage now includes `style_preset`.

`src/design-modernize.js` resolves the same preset before building the derived
Design System. The plan writes `style-preset.json`, includes the preset in
`uiux_style_preset`, and propagates preset posture into derived DS foundations.
The derived DS gate includes an explicit style-preset token authority check.

`src/design-system.js` stores `style_preset` in native DS artifacts and validates
changed UI/style files when `design-system validate --base <ref>` is provided.
The validator diffs changed files, scans UI/style sources for direct color,
typography, radius, shadow, and spacing values, and reports bypasses as
`DS-VALIDATE-STYLE-TOKEN-DRIFT`.

## Authority Boundary

Style presets are product-archetype guidance, not implementation authority. The
following sources remain authoritative over preset guidance:

- Story, Spec, and Architecture.
- Current route code and data contracts.
- Native Design System tokens and component roles.
- VibePro gate evidence.

When a repo is CLI-only, non-web, or otherwise has no meaningful visual surface,
the DS may mark style preset coverage `not_applicable`, but only with rationale
and evidence.
