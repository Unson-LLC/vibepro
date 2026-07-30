---
story_id: story-vibepro-session-cost-source-health-fail-soft
title: Session Cost Source Health Fail-Soft Spec
parent_design: story-vibepro-session-cost-source-health-fail-soft
---

# Spec

## Contracts

- `SCSH-CONTRACT-001`: Process-manager ingestion MUST return structured source health for
  `available`, `unavailable`, or `degraded` states and MUST NOT throw for ENOENT, empty input,
  malformed JSON, or a non-array root.
- `SCSH-CONTRACT-002`: A degraded source MUST include a stable reason code, source path, and safe
  diagnostic message, but MUST NOT include source contents.
- `SCSH-CONTRACT-003`: A valid matching entry MUST retain cwd precedence. Otherwise
  `session_meta.cwd`, then the CLI repository, MUST remain the fallback order.
- `SCSH-CONTRACT-004`: Session token accounting and attribution MUST continue when process-manager
  health is unavailable or degraded.
- `SCSH-CONTRACT-005`: The public `process_manager` result MUST distinguish a healthy source with
  no matching entry from an unreadable or invalid source.

## Scenarios

- `SCSH-SCENARIO-001`: Given a zero-byte process-manager file and valid session JSONL, when
  session-cost runs, then token accounting is available and session metadata selects the worktree.
- `SCSH-SCENARIO-002`: Given malformed JSON, when session-cost runs, then the result is returned
  with `process_manager.status=degraded` and `reason_code=invalid_json`.
- `SCSH-SCENARIO-003`: Given a valid array without the selected session, when session-cost runs,
  then `process_manager.status=unavailable` and `reason_code=session_not_found`.
- `SCSH-SCENARIO-004`: Given a valid matching entry, when session-cost runs, then the entry cwd
  outranks a different `session_meta.cwd`.

## Verification

- `SCSH-VERIFY-001`: Focused unit fixtures cover missing, empty, malformed, non-array, unmatched,
  and matching process-manager states.
- `SCSH-VERIFY-002`: Existing session-efficiency audit and CLI tests remain green.
