---
story_id: story-vibepro-init-help-no-side-effect
title: init help is read-only
status: active
reason: Help is an inspection command and must not create a repository path named after its flag.
architecture_docs:
  - docs/architecture/vibepro-init-help-no-side-effect.md
spec_docs:
  - docs/specs/vibepro-init-help-no-side-effect.md
  - docs/specs/story-vibepro-init-help-no-side-effect.vibepro.json
parent_design: vibepro-init-help-no-side-effect
---

# Story: `vibepro init --help` must be read-only

## Background

Running `vibepro init --help` currently treats `--help` as the repository path.
It initializes a literal `--help/` directory and writes `.vibepro` artifacts
inside it. This created real cleanup residue in multiple repositories.

Deleting those directories only treats the symptom. The CLI must distinguish a
help request from a positional repository argument before calling
`initWorkspace()`.

## Acceptance Criteria

- `vibepro init --help` prints the normal CLI help, exits successfully, and
  performs no filesystem writes.
- `vibepro init -h` has the same read-only behavior.
- A regression test proves that no literal `--help/` or `-h/` path is created.
- `vibepro init <repo>` continues to initialize the explicitly supplied
  repository without behavior changes.

## Non-goals

- Redesigning option parsing for every command.
- Changing normal `init` output or workspace structure.
- Silently accepting unknown `init` options.

## Verification

- Targeted CLI unit tests cover both help aliases and normal initialization.
- The full CLI test file is run before PR preparation.
