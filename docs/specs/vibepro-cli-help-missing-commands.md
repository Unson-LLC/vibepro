---
story_id: story-vibepro-cli-help-missing-commands
title: VibePro CLI Help Missing Commands Spec
parent_design: vibepro-cli-help-missing-commands
---

# Spec

## Required Behavior

- `renderHelp('en')` output (from `HELP_EN` in `src/cli.js`) contains a Usage
  line `vibepro check list`.
- `renderHelp('ja')` output (from `HELP_JA`, the default) contains Usage lines:
  - `vibepro check list`
  - `vibepro story map [repo] [--json]`
  - `vibepro task brief [repo] --task <task-id> [--group <group-id>] [--id <story-id>]`
  - `vibepro task plan [repo] --task <task-id> [--group <group-id>] [--id <story-id>]`
  - `vibepro task handoff [repo] --task <task-id> [--group <group-id>] [--id <story-id>]`
- The documented commands map to their existing runtime handlers in
  `runCli()` (`src/cli.js`): the `check` branch's `packId === 'list'` path, the
  `story` `map` subcommand, and the `task` `brief`/`plan`/`handoff` subcommands.
  These runtime behaviors are unchanged/existing — only their documentation is
  added.

## Invariants

- The edit is additive: every Usage line already present in `HELP_EN` or
  `HELP_JA` before this change is present, byte-for-byte, after it.
- `HELP_EN` and `HELP_JA` agree on the wording and argument surface for
  `check list`, `story map`, and `task brief|plan|handoff`.

## Verification

- `test/vibepro-cli.test.js` asserts each new line in both the JA (`output`) and
  EN (`englishOutput`) help renderings.
- `vibepro check list` continues to print the available diagnosis packs (existing
  `check list prints available diagnosis packs` test).
