---
story_id: story-vibepro-graphify-path-diagnostics
title: Graphify PATH Diagnostics Spec
---

# Spec

## Invariants

- `INV-GPD-1`: When `spawn('graphify')` fails with `ENOENT`, VibePro MUST report that the command was not found on the current `PATH`, not that Graphify is definitely uninstalled.
- `INV-GPD-2`: If an executable Graphify candidate exists in a common install location outside `PATH`, VibePro MUST show the candidate path and a concrete `PATH="$HOME/.local/bin:$PATH"` style retry hint.
- `INV-GPD-3`: If no executable candidate is found in common install locations, VibePro MAY show install guidance with `uv tool install graphifyy`.
- `INV-GPD-4`: Successful `--run-graphify` execution MUST keep existing behavior: import `.vibepro/graphify` artifacts, record `manifest.graphify.last_execution`, and clean generated `graphify-out`.

## Contracts

- Common candidate paths include at least `$HOME/.local/bin/graphify`.
- The diagnostic message MUST include the current PATH value or explicitly say it is empty.
- Candidate detection MUST not execute the candidate binary; it only checks for an executable file.
- The adapter remains the single source for Graphify execution diagnostics, so callers do not implement per-command error wording.

## Scenarios

- `S-GPD-1`: `PATH=""`, `$HOME/.local/bin/graphify` exists and is executable. `vibepro graph <repo> --run-graphify` exits non-zero and prints PATH guidance plus the candidate path, without install guidance.
- `S-GPD-2`: `PATH=""`, no common candidate exists. `vibepro graph <repo> --run-graphify` exits non-zero and prints install guidance.
- `S-GPD-3`: `graphify` is on `PATH` and succeeds. Existing graph import behavior remains unchanged.

## Anti-patterns

- `AP-GPD-1`: Treating all `ENOENT` failures as "not installed".
- `AP-GPD-2`: Suggesting reinstall before checking common user-level binary directories.
- `AP-GPD-3`: Running an arbitrary discovered candidate binary just to diagnose PATH.

## Verification

- Unit/CLI regression: `node --test --test-name-pattern "Graphify|GPD" test/vibepro-cli.test.js`
- Integration: `npm run typecheck`
