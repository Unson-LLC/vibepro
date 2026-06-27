---
story_id: story-vibepro-session-efficiency-audit
title: Session Worktree Efficiency Audit Spec
parent_design: vibepro-session-efficiency-audit
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        CLI["audit session-cost"] --> PM["process_manager chat_processes.json"]
        CLI --> JSONL["Codex session JSONL"]
        PM --> Worktree["observed worktree"]
        JSONL --> Cost["token/time accounting"]
        Worktree --> Artifacts[".vibepro/pr/<story> artifacts"]
        Worktree --> Diff["git numstat buckets"]
        Cost --> Breakdown["changed-line token allocation"]
        Artifacts --> Breakdown
        Diff --> Breakdown
---

# Spec

## Contracts

- `SESS-AUDIT-CONTRACT-001`: `vibepro audit session-cost <repo> --story-id <id> --session-id <id>`
  MUST return JSON when `--json` is provided and human-readable summary otherwise.
- `SESS-AUDIT-CONTRACT-002`: The command MUST accept `--codex-home`; when omitted it MUST use
  `$CODEX_HOME` or `~/.codex`.
- `SESS-AUDIT-CONTRACT-003`: If process manager metadata contains entries whose
  `conversationId` equals the session id, the newest `updatedAtMs` entry's `cwd` MUST be used as
  `observed_worktree`.
- `SESS-AUDIT-CONTRACT-004`: If no process manager entry exists, session metadata `cwd` MAY be used;
  otherwise the CLI repo path is the fallback and the readiness result MUST identify the missing
  process metadata.
- `SESS-AUDIT-CONTRACT-005`: Codex JSONL discovery MUST look under `$CODEX_HOME/sessions` for a
  `.jsonl` filename containing the session id.
- `SESS-AUDIT-CONTRACT-006`: Token accounting MUST subtract the first selected cumulative
  `token_count.info.total_token_usage` from the last selected cumulative usage.
- `SESS-AUDIT-CONTRACT-007`: `--window-start` and `--window-end` MUST bound selected JSONL events
  by timestamp. Without bounds, the command reports `scope=full_session`.
- `SESS-AUDIT-CONTRACT-008`: Elapsed time MUST be reported as `available` when a final answer or
  explicit window end exists, `partial` when the command falls back to the last observed event, and
  `unavailable` when usable timestamps are absent.
- `SESS-AUDIT-CONTRACT-009`: Changed lines MUST be collected from committed `--base...--head`
  numstat plus staged and unstaged worktree diffs unless `--no-worktree-diff` is provided.
- `SESS-AUDIT-CONTRACT-010`: Token allocation MUST use changed-line ratios and MUST leave token
  estimates null when token totals or changed lines are unavailable.

## Scenarios

- `SESS-AUDIT-SCENARIO-001`: Given a session id with process manager metadata pointing at an active
  worktree, when the command runs, then the audit reads `.vibepro` artifacts from that worktree, not
  from the canonical repo argument.
- `SESS-AUDIT-SCENARIO-002`: Given two selected cumulative token events with totals 120 and 370,
  when the command runs, then total token delta is 250.
- `SESS-AUDIT-SCENARIO-003`: Given no final answer and no explicit window end, when the command
  computes elapsed time, then status is `partial` and the reason says the last observed event was
  used.
- `SESS-AUDIT-SCENARIO-004`: Given missing JSONL, when the command runs, then token/time status is
  `unavailable`, not zero.

## Verification

- `SESS-AUDIT-VERIFY-001`: Unit test covers process-manager worktree precedence and JSONL token
  delta.
- `SESS-AUDIT-VERIFY-002`: CLI test covers `audit session-cost --json` and help text exposure.
