---
story_id: story-vibepro-graphify-path-diagnostics
title: Graphify PATH Diagnostics Architecture
---

# Architecture

Graphify execution is centralized in `src/graphify-adapter.js`. The fix stays there so every caller of `--run-graphify` gets the same diagnostic behavior.

## Decision

`ENOENT` from `spawn('graphify')` means "the command could not be resolved from the current PATH". It does not prove Graphify is uninstalled. VibePro should therefore report the PATH lookup failure first.

The adapter checks common user-level install locations, starting with `$HOME/.local/bin/graphify`, using executable-file checks only. It does not run a discovered candidate because that would introduce a diagnostic side effect and could execute an unexpected binary.

## Boundaries

- `src/graphify-adapter.js` owns Graphify execution and diagnostic wording.
- CLI commands such as `graph`, `story derive`, `story diagnose`, and `design-system derive --run-graphify` continue to call the adapter.
- This story does not bundle Graphify, change Graphify installation, or alter graph import formats.

## Failure Modes

- Candidate exists but is not executable: do not claim it is usable; fall back to normal missing guidance.
- PATH is empty: show `(empty)` so the user sees the concrete root cause.
- No candidate exists: keep the install command visible.

## Review Notes

The important product value is avoiding a false remediation path. A senior engineer should see whether the fix is "add directory to PATH" or "install Graphify" without re-running exploratory shell commands.
