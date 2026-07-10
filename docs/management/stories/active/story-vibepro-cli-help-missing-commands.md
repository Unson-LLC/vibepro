---
story_id: story-vibepro-cli-help-missing-commands
title: CLI --help Usage must list runtime commands story map, task brief/plan/handoff, and check list
architecture_docs:
  - docs/architecture/vibepro-cli-help-missing-commands.md
spec_docs:
  - docs/specs/vibepro-cli-help-missing-commands.md
parent_design: vibepro-cli-help-missing-commands
reason: >-
  Pure documentation-string change to the two help constants in src/cli.js
  (HELP_EN / HELP_JA). No new module, boundary, dependency, data model, or
  control-flow branch is introduced, so no ADR is warranted.
  Alternatives considered: (a) auto-generate the Usage block from
  TOP_LEVEL_COMMANDS + subcommand dispatch — rejected as out of scope and
  higher-risk than the reported gap; (b) leave help as-is — rejected because it
  hides working commands from users. Compatibility: additive only; existing
  documented lines are unchanged. Rollback: revert the six added Usage lines and
  the mirrored test assertions. Boundary: touches only the help/usage text
  surface of src/cli.js and its pinning test; no runtime command dispatch,
  gating, or artifact code changes.
---

# Story: CLI --help Usage must list runtime commands story map, task brief/plan/handoff, and check list

## Background

`src/cli.js` renders two help constants — `HELP_EN` and `HELP_JA` — via
`renderHelp(language)`. Several subcommands are fully implemented and pass at
runtime but are missing from the printed Usage block, so users (and agents)
cannot discover them from `vibepro help`:

- `vibepro check list` — handled in the `command === 'check'` branch
  (`packId === 'list'` prints the available diagnosis packs via
  `listCheckPacks()`). Missing from **both** `HELP_EN` and `HELP_JA`.
- `vibepro story map` — handled by the `story`/`subcommand === 'map'` branch.
  Present in `HELP_EN`, missing from `HELP_JA`.
- `vibepro task brief` / `vibepro task plan` / `vibepro task handoff` — handled
  by the `task` subcommand branches. Present in `HELP_EN`, missing from
  `HELP_JA`.

Because this repo's agent guidance defaults output to `--language ja`, the JA
help is the surface users actually read, and it omits all of the above.

This work was deferred from PR #313 (story-vibepro-skills-claude-md-refresh),
whose Non-Goals excluded the CLI help Usage block; #313 fixed only the
skills/CLAUDE.md side.

## Acceptance Criteria

- `vibepro help --language en` and `vibepro help` (JA, the default) both print a
  `vibepro check list` Usage line.
- `vibepro help` (JA) prints `vibepro story map [repo] [--json]`, matching the
  wording and `[repo] [--json]` argument surface already documented in
  `HELP_EN`.
- `vibepro help` (JA) prints `vibepro task brief`, `vibepro task plan`, and
  `vibepro task handoff` Usage lines, matching the argument surface already
  documented in `HELP_EN`
  (`--task <task-id> [--group <group-id>] [--id <story-id>]`).
- Every newly listed command remains the existing runtime handler; the runtime
  dispatch for `check list`, `story map`, `task brief`, `task plan`, and
  `task handoff` is unchanged/existing behavior and is only being documented.
- All previously documented Usage lines in both `HELP_EN` and `HELP_JA` are
  unchanged (additive-only edit).
- `test/vibepro-cli.test.js` pins the new Usage lines for both `ja` and `en` so
  the help surface cannot silently regress.

## Non-Goals

- Auto-generating the Usage block from the command dispatch table.
- Documenting any other commands still missing from `HELP_JA` beyond the five
  named above (the broader HELP_EN/HELP_JA divergence is unchanged/existing and
  out of scope).
- Changing any runtime command behavior.
