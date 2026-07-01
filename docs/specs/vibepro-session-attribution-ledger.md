---
story_id: story-vibepro-session-attribution-ledger
title: Session Attribution Ledger Spec
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
parent_design: vibepro-session-attribution-ledger
---

# Session Attribution Ledger Spec

## Invariants

- `INV-SAL-1`: Missing Codex session attribution MUST be represented as `not_collected_in_pr_prepare`.
- `INV-SAL-2`: Explicit session attribution MUST preserve session id, repo/cwd, story id, confidence, tokens, and elapsed time when supplied.
- `INV-SAL-3`: Daily value audit MUST NOT treat text mentions of a story as clean downstream adoption without attribution evidence.

## Verification

- `V-SAL-1`: Evidence reuse tests verify the missing-attribution status is emitted and reported.
- `V-SAL-2`: Senior-gap tests verify the status is visible in current state and decision card.
