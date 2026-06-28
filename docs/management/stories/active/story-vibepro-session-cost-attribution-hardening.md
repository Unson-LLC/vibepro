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

## Verification

- `node --test test/session-efficiency-audit.test.js`
- `node --test --test-name-pattern "AUTCOST|SCATTR|session-cost" test/vibepro-cli.test.js`
- `npm run typecheck`
