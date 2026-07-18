---
story_id: story-vibepro-init-help-no-side-effect
title: Read-only init help spec
parent_design: vibepro-init-help-no-side-effect
---

# Spec

## Required behavior

- Given `runCli(['init', '--help'])`, the CLI renders `renderHelp()` to stdout,
  returns `{ exitCode: 0, command: 'help' }`, and does not call
  `initWorkspace()`.
- Given `runCli(['init', '-h'])`, behavior is identical.
- Given `runCli(['init', repo])`, the current initialization behavior and return
  shape remain unchanged.

## Invariants

- `INV-IH-1`: Help requests do not mutate the filesystem.
- `INV-IH-2`: A flag is never interpreted as the repository path on the two
  supported help paths.
- `INV-IH-3`: Explicit repository initialization remains backward compatible.

## Code references

- `src/cli.js`: `runCli()` init dispatch.
- `test/vibepro-cli.test.js`: CLI initialization regression tests.
