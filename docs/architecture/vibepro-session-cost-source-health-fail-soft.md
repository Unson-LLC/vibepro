---
story_id: story-vibepro-session-cost-source-health-fail-soft
title: Session Cost Source Health Fail-Soft Architecture
parent_design: story-vibepro-session-cost-source-health-fail-soft
---

# Architecture

## Decision

Treat process-manager metadata as an independently fallible evidence source. Its reader returns an
entry plus structured health instead of throwing for expected local-state failures. Session JSONL
and repository evidence collection continue independently.

## Flow

```mermaid
flowchart TD
  PM["process_manager/chat_processes.json"] --> Reader["source-local reader"]
  Reader -->|"valid matching entry"| Priority["process-manager cwd"]
  Reader -->|"missing, empty, malformed, wrong shape"| Health["degraded source health"]
  Health --> Session["session_meta.cwd fallback"]
  Session --> Repo["CLI repo fallback"]
  Priority --> Audit["session-cost result"]
  Repo --> Audit
  Health --> Audit
```

## Invariants

- A valid matching process-manager entry remains the highest-priority cwd source.
- Corrupt optional metadata cannot suppress valid session token or attribution evidence.
- Diagnostics identify the failed source and category without embedding local file contents.
- The reader never repairs or rewrites Codex runtime state.
