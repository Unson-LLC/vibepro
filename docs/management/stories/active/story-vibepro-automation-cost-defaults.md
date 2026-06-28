---
story_id: story-vibepro-automation-cost-defaults
vibepro_story_id: story-vibepro-runtime-cost-gap-closure
title: Automation Cost Defaults
parent_design: vibepro-runtime-cost-gap-closure
status: active
---

# Story

Daily VibePro value audits should not depend on a human remembering every cost
flag at merge time. When the automation runtime already exports the current
session id or automation memory path, VibePro should use those public defaults
instead of leaving merge cost collection as `not_requested`.

## Acceptance Criteria

- [x] `ACD-AC-001`: `audit session-cost` reads `VIBEPRO_SESSION_ID`, `CODEX_SESSION_ID`, or
  `CLAUDE_SESSION_ID` when `--session-id` is omitted.
- [x] `ACD-AC-002`: `audit session-cost` and `execute merge` read
  `VIBEPRO_AUTOMATION_MEMORY` when `--automation-memory` is omitted.
- [x] `ACD-AC-003`: `execute merge` forwards the same defaults into merge-time
  cost collection without fabricating zero token/time values.
- [x] `ACD-AC-004`: CLI help exposes the automation-safe command surface.

## Verification

- `test/session-efficiency-audit.test.js`
- `test/vibepro-cli.test.js`
