---
story_id: story-vibepro-session-cost-attribution-hardening
title: Session Cost Attribution Hardening
parent_design: vibepro-runtime-cost-gap-closure
status: active
architecture_docs:
  - docs/architecture/vibepro-session-cost-attribution-hardening.md
spec_docs:
  - docs/specs/vibepro-session-cost-attribution-hardening.md
---

# Story

VibePro should keep merge-time cost accounting cheap, safe, and attributable.
The previous implementation can collect token/time data, but field evidence showed
three remaining gaps:

- `--infer-session` can scan too broadly and stall the merge path.
- Explicit session IDs can point at a different repo without a clear readiness
  blocker.
- A single Codex conversation can be split across multiple rollout JSONL files,
  causing false ambiguity or partial token accounting if each file is ranked as
  a separate session.
- Bounded windows with no session events can look like valid elapsed time.

## Acceptance Criteria

- [ ] `SCATTR-AC-001`: Session inference avoids symlink traversal loops and
  finishes from bounded local JSONL discovery.
- [ ] `SCATTR-AC-002`: Cwd attribution treats same Git repository worktrees as
  matching, while mismatched explicit sessions remain `partial`.
- [ ] `SCATTR-AC-003`: A bounded window with no in-window events does not report
  elapsed time as `available`.
- [ ] `SCATTR-AC-004`: Merge/session-cost evidence preserves mismatch and
  selection provenance instead of fabricating usable cost.
- [ ] `SCATTR-AC-005`: Split JSONL files for the same Codex session are merged
  for inference and token/time accounting.

## Scenarios

- `SCATTR-SCENARIO-001`: Given symlinked or very large Codex sessions storage,
  session inference only scans bounded real day directories and still returns
  instead of traversing the full store.
- `SCATTR-SCENARIO-002`: Given a Codex session whose cwd is a sibling Git
  worktree of the canonical repo, cost attribution treats the session as
  repo-matching. JSONL parsing may use the `entry.type === 'session_meta'`
  branch to read cwd metadata, but that branch must feed repo/worktree
  attribution instead of becoming timestamp-only attribution.
- `SCATTR-SCENARIO-003`: Given an explicit session whose observed cwd belongs
  to another repository, the audit remains partial with `session_cwd_mismatch`
  instead of ready.
- `SCATTR-SCENARIO-004`: Given a bounded session window with no in-window events,
  `elapsed_time_accounting` is unavailable and no elapsed duration is fabricated
  from requested bounds.
- `SCATTR-SCENARIO-005`: Given two rollout JSONL files with the same
  `session_meta.session_id`, inference treats them as one session candidate and
  token accounting spans the selected files instead of failing as ambiguous.

## Verification

- `node --test test/session-efficiency-audit.test.js`
- `node --test --test-name-pattern "AUTCOST|SCATTR|session-cost" test/vibepro-cli.test.js`
- `npm run typecheck`
