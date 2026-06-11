---
story_id: story-vibepro-evidence-user-fingerprint
title: VibePro should not stale evidence because its own workbench artifacts changed
architecture_docs:
  reason: This story narrows the existing evidence binding contract; no new runner architecture is introduced.
spec_docs:
  - docs/specs/vibepro-evidence-user-fingerprint.md
issue:
  - https://github.com/Unson-LLC/vibepro/issues/170
---

# Story: VibePro should not stale evidence because its own workbench artifacts changed

## Context

Issue #170 showed that Gate evidence can become stale when VibePro updates `.vibepro/vibepro-manifest.json` or related workbench artifacts during the PR workflow. The Gate should stay strict about user code and HEAD changes, while treating VibePro-generated workbench dirt as diagnostic metadata instead of invalidating freshly recorded evidence.

## User Story

As a VibePro user preparing a PR, I want verification and Agent Review evidence to bind to the user-change fingerprint, so VibePro's own generated artifacts do not force repeated evidence and review recording.

## Acceptance Criteria

- [x] Verification evidence records a user dirty fingerprint that excludes `.vibepro/` and `.worktrees/vibepro/`.
- [x] Agent Review records and status checks use the same user dirty fingerprint.
- [x] `pr prepare` compares user dirty fingerprints when both recorded and current contexts provide them.
- [x] Legacy evidence that lacks the user fingerprint still uses the existing full dirty fingerprint comparison.
- [x] `pr prepare` reports VibePro-internal dirty files separately from user dirty files.
- [x] Managed worktree dirty fingerprinting uses the user scope while retaining raw dirty diagnostics.
- [x] Concurrent review lifecycle starts preserve all lifecycle entries through the existing lock and atomic write path.

## Scenarios

- `S-001`: Given the PR evidence workflow is in a current recorded state for the current HEAD, when tracked VibePro workbench artifacts change, then evidence binding uses the user dirty fingerprint and transitions to PR-ready current while raw dirty diagnostics are still reported.
- `S-002`: Given the PR evidence workflow is in a legacy full-fingerprint state, when tracked VibePro artifacts change, then VibePro keeps the legacy evidence stale instead of fabricating a user fingerprint transition.
- `S-003`: Given the Flow Verification workflow is in connection setup state with `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`, when evidence git context is recorded, then the Basic Auth connection branch remains unchanged while the user dirty fingerprint is added to the recorded state.

## Non-goals

- AC coverage scanner improvements remain a separate story.
- Disk space preflight remains a separate story.
- Review lifecycle storage migration beyond the existing lock and atomic JSON update is out of scope.
