---
story_id: story-vibepro-session-efficiency-audit
title: Session Worktree Efficiency Audit Architecture
---

# Architecture

## Decision

Add a separate `audit session-cost` command instead of overloading canonical audit replay. Replay
answers whether persisted canonical artifacts can reconstruct a merged decision. Session-cost
answers a different question: what did the active VibePro-managed session spend, which worktree did
it actually modify, and how does that cost divide across product code, tests, docs, and audit
evidence?

## Boundaries

- `session-efficiency-audit` owns local Codex evidence discovery and active worktree cost
  accounting.
- `canonical-audit` remains the merge-time persistence and replay boundary.
- `evidence-cost-budget` remains the shared changed-path classifier and numstat parser.
- The command reads local evidence only; it does not create PRs, merge branches, or rewrite
  artifacts.

## Flow

```mermaid
flowchart TD
  Command["vibepro audit session-cost"] --> CodexHome["resolve CODEX_HOME"]
  CodexHome --> PM["process_manager/chat_processes.json"]
  CodexHome --> Session["sessions/**/*.jsonl"]
  PM --> Root["observed worktree"]
  Session --> Token["token delta"]
  Session --> Time["elapsed time"]
  Root --> Vibepro[".vibepro/pr/<story> inventory"]
  Root --> Git["git numstat buckets"]
  Token --> Table["cost_breakdown"]
  Git --> Table
  Vibepro --> Report["session efficiency audit"]
  Table --> Report
```

## Invariants

- Active process manager cwd outranks session metadata cwd and CLI repo path.
- Unknown token/time values remain `unavailable`; they are never coerced to zero.
- Full-session accounting is labelled as full-session, not implied to be story-only.
- Bounded windows are caller-supplied and explicit.
- Staged and unstaged worktree diffs are included by default because active sessions may not have a
  merged PR yet.
