# story-vibepro-uiux-ia-flow-map Architecture

## Shape

The IA flow map lives in `src/uiux-flow-map.js`. It builds a story-scoped artifact from story text, optional UI/UX intake, route evidence, and Journey context. The artifact intentionally separates:

- `current_ia`: routes that are confirmed by explicit or discovered route evidence.
- `target_ia`: proposed target sequence and screen roles derived from story/intake context.
- `unknown_flow`: missing inputs that prevent the system from claiming a complete flow.
- `non_goals`: story-declared boundaries copied into the map.

`src/cli.js` exposes the workflow as:

- `vibepro uiux map [repo] --id <story-id>`

`src/design-modernize.js` consumes the map through `resolveUiuxIaFlowMapForPlan` before design briefs are rendered. It writes `ia-flow-map.json` and `ia-flow-map.md` next to the existing design-modernize artifacts.

`src/pr-manager.js` reads the story IA map as PR context. Missing maps stay visible as missing evidence rather than being converted into an empty result.

## Authority Boundary

Current IA is only confirmed from route evidence. Target IA remains proposed until implementation, runtime, or verification evidence confirms it. Missing route evidence blocks complete screen-flow inference and must be reported as `needs_route_evidence`.
