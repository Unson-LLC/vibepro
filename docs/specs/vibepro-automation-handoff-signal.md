---
story_id: story-vibepro-automation-handoff-signal
title: Automation Handoff Signal Spec
status: active
created_at: 2026-06-30
updated_at: 2026-06-30
---

# Automation Handoff Signal Spec

## Invariants

- `INV-AHS-1`: `audit-index.json` MUST preserve handoff replay status independent of whether artifacts are persisted full or compact.
- `INV-AHS-2`: `automation_value_audit.value_signal_inputs` MUST expose handoff replay status and unresolved reference count.
- `INV-AHS-3`: When handoff replay is blocked, `automation_value_audit.findings` MUST contain a stable machine-readable finding id.

## Acceptance Proof

- `AP-AHS-1`: A canonical bundle with one missing referenced artifact reports `handoff_replay_status=blocked`.
- `AP-AHS-2`: The resulting `audit-index.json` reports `handoff_replay_unresolved_reference_count=1`.
- `AP-AHS-3`: `automation_value_audit.findings` contains `canonical_handoff_replay_blocked`.

## Verification

- `V-AHS-1`: `test/canonical-audit-self-contained.test.js` covers blocked handoff propagation into audit index and automation findings.
