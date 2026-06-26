---
story_id: story-vibepro-canonical-audit-cost-accounting
title: Canonical Audit Cost Accounting Inputs
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: vibepro-value-audit-cost-accounting-gap
parent_design: vibepro-canonical-audit-cost-accounting
architecture_docs:
  - docs/architecture/vibepro-canonical-audit-cost-accounting.md
spec_docs:
  - docs/specs/vibepro-canonical-audit-cost-accounting.md
created_at: 2026-06-27
updated_at: 2026-06-27
---

# Story

Canonical audit cost summaries currently preserve changed-line evidence, but token and elapsed-time
accounting stay `unavailable` even when upstream merge/session data can provide those values. This
keeps value audits from measuring actual agent cost against the product change, and it makes
follow-up implementation cost look permanently unmeasured.

VibePro should accept token/time accounting supplied by merge/session inputs, normalize it without
fabricating missing values, and persist it in canonical audit artifacts and compact decision
summaries.

## Acceptance Criteria

- [ ] `CACOST-AC-001`: Canonical evidence cost summaries accept token accounting with total, input,
  output, cached-input, source, and window metadata.
- [ ] `CACOST-AC-002`: Canonical evidence cost summaries accept elapsed-time accounting with
  elapsed_ms, started_at, finished_at, source, and window metadata.
- [ ] `CACOST-AC-003`: Missing or invalid token/time inputs remain `unavailable` or `partial` with a
  reason; unknown values are never converted to zero.
- [ ] `CACOST-AC-004`: `promoteCanonicalAuditArtifacts` forwards cost accounting from merge/session
  result shapes into canonical cost summaries.
- [ ] `CACOST-AC-005`: Compact canonical decision summaries render token/time accounting status so
  auditors can distinguish measured cost from unavailable cost.
- [ ] `CACOST-AC-006`: Regression tests cover available token/time inputs, inferred elapsed time, and
  unavailable fallback behavior.

## Non Goals

- Discovering Codex or Claude Code session logs directly from canonical audit promotion.
- Rewriting historical audit bundles.
- Treating missing token/time data as a merge blocker.
