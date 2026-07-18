---
story_id: story-vibepro-init-help-no-side-effect
title: Read-only init help architecture
parent_design: vibepro-init-help-no-side-effect
---

# Architecture

## Decision

Handle `--help` and `-h` at the start of the existing `init` command branch,
before repository-path resolution and before any workspace function is called.
The branch renders the canonical top-level help and returns exit code zero.

This keeps ownership in `src/cli.js`, where command dispatch and help rendering
already live. It does not introduce a second parser or change `initWorkspace()`.

## Boundaries

- Only `init --help` and `init -h` gain an early read-only exit.
- Explicit positional repositories continue through the existing init path.
- The existing top-level `help`, `--help`, and `-h` behavior remains unchanged.

## Why no ADR is required

The change corrects dispatch ordering inside an existing module. It adds no
storage, integration, public artifact schema, or cross-module boundary.
