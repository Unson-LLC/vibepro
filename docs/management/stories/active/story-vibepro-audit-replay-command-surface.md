---
story_id: story-vibepro-audit-replay-command-surface
title: "Audit replay artifact contract must match the public CLI surface"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: vibepro-value-audit-replay-command-surface-gap
parent_design: vibepro-audit-replay-command-surface
architecture_docs:
  - docs/architecture/vibepro-audit-replay-command-surface.md
spec_docs:
  - docs/specs/vibepro-audit-replay-command-surface.md
created_at: 2026-06-27
updated_at: 2026-06-27
---

# Story

Canonical audit artifacts declare a `replay_command` so another engineer or agent can reconstruct the
handoff decision from a fresh checkout. That declaration is only valuable if the public VibePro CLI
surface accepts the exact command. A regression where artifacts say replay is possible but the CLI
returns `Unknown command: audit` is a fake-value failure: tests can pass while the handoff contract is
not executable.

VibePro should lock the artifact replay contract to the shipped CLI binary, not only to internal module
functions or permissive smoke tests.

## Engineering Judgment Spine

- current_reality: `origin/main` can currently replay canonical audit bundles, but a stale local CLI branch can still return `Unknown command: audit`, and existing smoke coverage would not necessarily fail on that clean non-zero path.
- failure_modes: The highest-risk failure is fake handoff readiness: artifacts declare `vibepro audit replay . --story-id <id>`, while the shipped binary cannot dispatch `audit replay`. A second failure mode is module-only replay coverage passing while the public CLI binary surface is disconnected.
- done_evidence: `test/canonical-audit-self-contained.test.js` now executes the `audit-index.json` replay command through `bin/vibepro.js`, with `.` resolved from the artifact checkout, and asserts `status=ready` plus `handoff_replay_status=ready`.
- authoritative_signal_source: Public replay readiness is the combination of `audit-index.json.replay_bundle.replay_command`, `bin/vibepro.js` dispatch, and current-head verification evidence. Internal helper success alone is not authoritative.

## Acceptance Criteria

- [ ] `ARCS-AC-001`: Canonical audit replay artifacts continue to declare `vibepro audit replay . --story-id <id>`.
- [ ] `ARCS-AC-002`: Regression tests execute the declared replay command through `bin/vibepro.js`, with `.` resolved from the artifact checkout.
- [ ] `ARCS-AC-003`: The CLI replay path must exit successfully and return `status=ready` for a valid compressed canonical audit bundle.
- [ ] `ARCS-AC-004`: A missing top-level `audit` command or disconnected CLI handler must fail the regression test rather than being accepted as a clean non-zero smoke result.
- [ ] `ARCS-AC-005`: The test does not rely on session `.vibepro/`; the committed canonical audit artifact is sufficient for replay.

## Non Goals

- Changing the compressed audit bundle schema.
- Rewriting historical audit artifacts.
- Treating a stale local canonical worktree branch as the source of truth over `origin/main`.
