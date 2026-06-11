---
story_id: story-vibepro-evidence-user-fingerprint
title: VibePro evidence user fingerprint Spec
---

# VibePro evidence user fingerprint Spec

## Problem

Verification evidence, flow verification, Agent Review results, and managed worktree bindings must remain tied to the user-change git state without being invalidated by VibePro's own workbench artifacts.

## Requirements

- `verify record`, `verify flow`, `review prepare`, `review record`, `review status`, and `pr prepare` record both the historical full dirty fingerprint and a user dirty fingerprint.
- The user dirty fingerprint excludes `.vibepro/` and `.worktrees/vibepro/`.
- Evidence binding compares `user_status_fingerprint_hash` when both recorded and current contexts provide it.
- Older evidence that only has `status_fingerprint_hash` keeps the legacy full-fingerprint comparison.
- `pr prepare` exposes raw VibePro-internal dirty files separately from user dirty files.
- Managed worktree dirty fingerprints use the same user scope and keep raw dirty state as diagnostic metadata.
- Review lifecycle updates remain serialized with the existing lifecycle lock and atomic JSON write behavior so concurrent starts do not lose entries.

## Scenarios

- `S-001`: Given the PR evidence workflow is in a current recorded state for the current HEAD, when tracked VibePro workbench artifacts change, then evidence binding uses the user dirty fingerprint and transitions to PR-ready current while raw dirty diagnostics are still reported.
- `S-002`: Given the PR evidence workflow is in a legacy full-fingerprint state, when tracked VibePro artifacts change, then VibePro keeps the legacy evidence stale instead of fabricating a user fingerprint transition.
- `S-003`: Given the Flow Verification workflow is in connection setup state with `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`, when evidence git context is recorded, then the Basic Auth connection branch remains unchanged while the user dirty fingerprint is added to the recorded state.

## Non-goals

- This spec does not weaken HEAD binding. Evidence recorded for another HEAD remains stale.
- This spec does not implement acceptance-criteria coverage marker APIs.
- This spec does not implement disk-space preflight warnings.
