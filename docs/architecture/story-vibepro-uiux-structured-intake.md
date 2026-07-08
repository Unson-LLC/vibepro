# story-vibepro-uiux-structured-intake Architecture

## Shape

The structured intake lives in `src/uiux-intake.js`. It owns the schema, template writer, validator, coverage summarizer, vague-brief detection, and authority-boundary wording.

`src/cli.js` exposes the workflow as:

- `vibepro uiux intake template [repo] --id <story-id>`
- `vibepro uiux intake validate [repo] --id <story-id>`

`src/design-modernize.js` consumes the module through `resolveUiuxIntakeForPlan`. The plan command does not reinterpret the schema; it records the resolved coverage and writes `uiux-intake-coverage.json` beside existing design-modernize artifacts.

## Authority Boundary

The intake is structured reference material. It can guide `design-modernize`, but cannot override current route code, data contracts, screenshots, or VibePro story/spec/architecture artifacts.
