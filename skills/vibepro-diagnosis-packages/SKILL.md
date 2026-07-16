---
name: vibepro-diagnosis-packages
description: Use when the user asks VibePro to check UI, security, performance, architecture, PR readiness, launch readiness, or performance improvement evidence.
---

# VibePro Diagnosis Packages

## Purpose

Use VibePro purpose-level packages instead of guessing which low-level scanner or log to inspect. The package is the user-facing intent; the scanner set and evidence paths are VibePro's implementation detail.

## When to Use

Use this Skill when the user asks VibePro to check, audit, diagnose, verify, or compare UI behavior, security, performance, architecture, PR readiness, launch readiness, agent harness readiness, public discovery, self-dogfood readiness, OSS readiness, or regression risk.

Use it when a claim needs package-level evidence rather than ad hoc scanner output, especially when the user asks whether VibePro has "confirmed" something.

## Diagnosis Packages

List packages first when the request is ambiguous:

```bash
vibepro check list
```

Use these mappings:

- UI quality / user flow / API contract in UI calls / gesture UX: `vibepro check ui <repo> --story-id <story-id>`
- Security / auth / exposed surface / API route contracts: `vibepro check security <repo> --story-id <story-id>`
- Performance readiness / heavy dev / DB access risks: `vibepro check performance <repo> --story-id <story-id>`
- Architecture / responsibility boundary: `vibepro check architecture <repo> --story-id <story-id>`
- PR readiness: `vibepro check pr-readiness <repo> --story-id <story-id> --base <ref> --head <ref>`
- Release or handoff readiness: `vibepro check launch-readiness <repo> --story-id <story-id>`
- Broad inspection: `vibepro check all <repo> --story-id <story-id>`
- Public page source inspection: `vibepro check public-discovery <repo>`
- Built public site inspection: `vibepro check public-discovery <repo> --public-dir <build-output-dir>`
- Deployed public site inspection: `vibepro check public-discovery <repo> --base-url <https-url>`

Package evidence is written to:

```text
.vibepro/checks/<pack>/<run-id>/check.json
.vibepro/checks/<pack>/<run-id>/check.md
```

## Performance Evidence

For a performance improvement claim, define Story-level metrics and record before/after runs. Do not rely only on ad hoc server logs or one-off E2E output.

Define metrics:

```bash
vibepro performance define <repo> \
  --id <story-id> \
  --metric-id <metric-id> \
  --user-story <text> \
  --start-condition <text> \
  --completion-condition <text> \
  --intermediate-marker <marker-id> \
  --timeout-ms <ms> \
  --evidence-source <server_log|browser_e2e|api_log|client_marker|manual_observation> \
  --readiness-kind <server_side|user_perceived|external_dependency|system_internal>
```

Record runs:

```bash
vibepro performance record <repo> \
  --id <story-id> \
  --metric-id <metric-id> \
  --label before \
  --status completed \
  --duration-ms <ms> \
  --marker <marker-id=ms> \
  --evidence-source <type:ref:summary>

vibepro performance record <repo> \
  --id <story-id> \
  --metric-id <metric-id> \
  --label after \
  --status completed \
  --duration-ms <ms> \
  --marker <marker-id=ms> \
  --evidence-source <type:ref:summary>
```

Compare:

```bash
vibepro performance compare <repo> --id <story-id>
```

Run evidence is written to:

```text
.vibepro/pr/<story-id>/performance-runs/*.json
```

## Performance Guardrails

- DB performance is included, but DB/server time and user-perceived time must be separate metrics.
- `server_side` examples: DB query completed, API handler completed, tmux/server readiness.
- `user_perceived` examples: button click to visible DOM, snapshot visible, input ready, interactive ready.
- Do not claim user-perceived improvement from `server_log` alone.
- Compare only runs with the same `metricId` and `completionCondition`.
- Keep incomplete runs as evidence: `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, `unknown`.
- If comparison is not possible, report `改善率不明` and list the missing marker/evidence.

## Network Contract Guardrails

- When UI code introduces `fetch('/api/...')`, axios, or an API wrapper call, confirm the matching Next.js route exists.
- App Router route example: `/api/foo/bar` -> `src/app/api/foo/bar/route.ts`.
- Pages Router route example: `/api/foo/bar` -> `src/pages/api/foo/bar.ts`.
- If a direct server function / Server Action call is replaced by an HTTP API call, treat it as a contract change requiring route, schema, auth/runtime, and network-aware E2E evidence.
- In `vibepro verify flow`, API 4xx/5xx, API HTML responses, console/page errors, `Failed to fetch`, `Unexpected token '<'`, and visible loading failure text are Gate failures even when the UI appears to render.

## Public Discovery Guardrails

- Prefer `--base-url` when the claim concerns the deployed site, and `--public-dir` when the claim concerns generated HTML before deploy. Argument-free source mode cannot prove the built or deployed representation.
- Input precedence is `--base-url` over `--public-dir` over repository source. An explicit input that cannot be inspected must stay explicit; do not silently fall back to source mode.
- Inspect `evidence.public_discovery.scan_coverage` in `check.json`. Report `mode`, `roots`, `discovered_count`, `scanned_count`, `failed_count`, and `errors` alongside findings.
- `scan_coverage.status: inconclusive` means VibePro inspected zero public pages. It is non-blocking for compatibility, but it is not evidence of a pass. Preserve the aggregate `inconclusive_count` in reports.
- Public Discovery finding rows and coverage are independent. Zero findings means no matching issue was found; only `scan_coverage.scanned_count > 0` proves that at least one page was actually inspected.
- Live mode is read-only and bounded: HTTP(S) GET only, same-origin root/sitemap targets, at most 40 pages, 2 MiB per response, and 10 seconds per request. It does not execute client JavaScript or inspect authenticated flows.

## UI Interactive Contract Guardrails

- `vibepro check ui` must evaluate the screen at the level of visible interaction contracts, not only at the Story E2E level.
- Clickable-looking UI must have one of these outcomes: save/mutate, visible state change, navigation, scroll/focus movement, explicit disabled state, or an explicit unfinished state such as `準備中` / `coming soon`.
- Treat normal-looking placeholder buttons as findings when they only `console.log`, TODO, no-op, or have no `onClick` / `href` / submit / disabled / unfinished-state marker.
- Story E2E coverage is not enough when the changed screen has additional clickable-looking controls. Require a screen-level clickable element inventory for UI-heavy changes.
- For Playwright flow checks, click not only the main happy path but also controls that appear actionable: secondary buttons, detail links, icon buttons, tabs, menu triggers, AI/voice actions, and expandable rows.

## Gesture Interaction Guardrails

- For mobile-heavy UI, map UI, carousel UI, drag/drop, swipe, or touch changes, inspect the `Gesture Interaction` section from `vibepro check ui/all/launch-readiness`.
- Treat these as review-required signals: ambiguous `touch-action`, map overlays without clear `pointer-events`, drag state not connected to click suppression, carousel surfaces without snap/threshold evidence, small gesture hit areas, and map markers without collision/zIndex/contrast/hit-area contract.
- Static gesture findings are review candidates, not automatic proof of an app bug. Convert them to block-level evidence when Playwright/runtime probes show wrong navigation, no scroll/active-card movement, intercepted hit targets, or visible interaction failure.
- In `vibepro verify flow`, add gesture probes for changed surfaces. Useful steps include `drag`, `touchDrag`, `expectUrlUnchanged`, `expectScrollLeftChanged`, active item change via `activeSelector` + `expectActiveChanged`, and `expectElementFromPoint`.
- For “swipe becomes tap” regressions, verify that drag after a card/map interaction does not change URL and does update the expected scroll or active item state.

## Common Rationalizations

- "One scanner was clean, so the package passed." Reject this; package status comes from the configured scanner set and written evidence artifact.
- "Server logs prove performance." Server-side readiness does not prove user-perceived speed.
- "The main E2E path passed, so UI controls are fine." UI-heavy changes need clickable-looking controls and alternate surfaces checked.
- "No API error appeared visually, so network contracts are safe." Network Contract Gate needs route/schema/runtime evidence and should catch hidden 4xx/5xx or HTML responses.
- "A skipped check is a pass." Skipped, unavailable, auth-required, or unknown states must stay visible.
- "Public Discovery had zero findings, so the deployed pages passed." Reject this unless `scan_coverage.mode` matches the claimed layer and `scanned_count` is greater than zero.

## Red Flags

- The answer does not name the package command or artifact path.
- A performance comparison omits p50, p90, max, sample count, or incomplete rate.
- Internal readiness and user-perceived readiness are mixed into one metric.
- UI findings do not say whether clickable controls have an interaction contract.
- Network/API changes are evaluated without route existence and network-aware flow evidence.
- A package report hides `blocked`, `needs_review`, `timeout`, `auth_required`, `resource_unavailable`, or `unknown` runs.
- A deployed-site claim is based on source mode, or Public Discovery omits its coverage mode/count/errors.

## Verification

Run the purpose-level package, inspect both `.vibepro/checks/<pack>/<run-id>/check.json` and `check.md`, and report the pack status, key findings, and artifact path. For performance, define metrics, record comparable before/after runs, and use `vibepro performance compare` before claiming an improvement rate.

For Public Discovery, also report the selected target layer and coverage. If the deployed page is the subject, use `--base-url`; if build output is the subject, use `--public-dir`. Never translate `inconclusive` or zero scanned pages into a clean result.

## Review Checklist

Before saying VibePro confirmed the result:

- The package or performance command that produced the evidence is named.
- The evidence artifact path is included.
- The Story ID is correct.
- p50, p90, max, sample count, and incomplete rate are shown for performance comparisons.
- The answer separates internal readiness from user-perceived readiness.
- UI findings include whether clickable-looking controls have an interaction contract or are explicitly disabled/unfinished.
- Public Discovery reports mode, scanned/failed counts, and preserves inconclusive when zero pages were inspected.
