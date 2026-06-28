---
story_id: story-vibepro-session-cost-attribution-hardening
title: Session Cost Attribution Hardening Spec
parent_design: vibepro-runtime-cost-gap-closure
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        Symlink["Symlinked sessions dir"] --> Loop["Traversal loop / slow scan"]
        Loop --> Guard["Do not recurse symlink dirs"]
        WrongCwd["Explicit session from another repo"] --> Mismatch["cwd_mismatch readiness blocker"]
        EmptyWindow["No events in bounded window"] --> Unknown["elapsed unavailable, not 24h available"]
        Guard --> Cost["safe cost accounting"]
        Mismatch --> Cost
        Unknown --> Cost
---

# Spec

## Invariants

- `SCATTR-INV-001`: Session inference must not follow symlink directories while
  discovering Codex JSONL files.
- `SCATTR-INV-002`: Repo attribution must distinguish same-repository worktrees
  from unrelated cwd values.
- `SCATTR-INV-003`: A bounded window with no in-window events must not produce
  `elapsed_time_accounting.status=available`.
- `SCATTR-INV-004`: Missing or mismatched cost evidence must remain explicit and
  must not be converted to zero or ready.

## Contracts

- `SCATTR-CONTRACT-001`: `audit session-cost --infer-session` considers only
  JSONL files reachable through real directories under `<codex-home>/sessions`.
- `SCATTR-CONTRACT-002`: Cwd matching accepts exact path equality or the same
  Git common directory, so canonical and managed worktree paths can match.
- `SCATTR-CONTRACT-003`: Explicit sessions whose observed cwd does not match
  the requested repo are reported with a readiness blocker.
- `SCATTR-CONTRACT-004`: Empty bounded windows report token and elapsed
  accounting as unavailable with a reason.

## Scenarios

- `SCATTR-SCENARIO-001`: Given a symlink directory under sessions, discovery
  ignores it and inference still completes from real JSONL files.
- `SCATTR-SCENARIO-002`: Given a session from a same Git worktree, inference
  treats it as repo-matching. The JSONL `entry.type === 'session_meta'` branch
  is the cwd metadata source for repo/worktree attribution.
- `SCATTR-SCENARIO-003`: Given an explicit session whose cwd is another repo,
  the audit remains partial with `session_cwd_mismatch`.
- `SCATTR-SCENARIO-004`: Given a bounded window before the session's first
  event, elapsed time is unavailable and no 24h window is reported.

## Anti-Patterns

- `SCATTR-AP-001`: Do not infer session cost from timestamp proximity alone.
- `SCATTR-AP-002`: Do not mark elapsed time available merely because a requested
  window has start and end timestamps.
- `SCATTR-AP-003`: Do not treat canonical-main artifact absence as zero-cost
  evidence.

## Verification

- `SCATTR-VERIFY-001`: `test/session-efficiency-audit.test.js` covers symlink
  pruning, same-repo worktree matching, cwd mismatch, and empty-window elapsed
  handling.
- `SCATTR-VERIFY-002`: CLI regression confirms merge/session-cost still exposes
  cost provenance.
