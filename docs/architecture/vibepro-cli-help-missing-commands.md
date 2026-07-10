---
design_id: vibepro-cli-help-missing-commands
title: CLI --help Usage coverage for story map / task brief|plan|handoff / check list
kind: architecture
story_id: story-vibepro-cli-help-missing-commands
---

# Architecture: CLI --help Usage coverage

## Context

`src/cli.js` holds two hand-maintained help strings, `HELP_EN` and `HELP_JA`,
selected by `renderHelp(language)` (JA is the repo default). The runtime command
surface is dispatched separately in `runCli()`. Over time the two help strings
drifted from the dispatch table: some implemented subcommands are printed in
`HELP_EN` but not `HELP_JA`, and `check list` is printed in neither.

## Decision

Keep the existing hand-maintained help-string design (no generator) and close
the specific documented-command gaps additively:

- Add `vibepro check list` to both `HELP_EN` and `HELP_JA`.
- Add `vibepro story map` and `vibepro task brief|plan|handoff` to `HELP_JA`
  (already present in `HELP_EN`).

Wording and argument surfaces are copied verbatim from the existing `HELP_EN`
lines so the two languages agree for these commands.

## Boundary

Only the help/usage text surface of `src/cli.js` and its pinning test
(`test/vibepro-cli.test.js`) change. No command dispatch, gating, artifact, or
data-model code is touched.

## Alternatives

- **Generate Usage from the dispatch table** — larger blast radius than the
  reported gap; deferred.
- **Do nothing** — leaves working commands undiscoverable from `vibepro help`,
  especially in the JA default.

## Compatibility & Rollback

Additive-only; no existing documented line changes. Rollback = revert the six
added Usage lines plus the mirrored test assertions.
