---
story_id: story-vibepro-automation-readable-value-audit
title: Automation Readable Value Audit Evidence
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: vibepro-daily-automation-value-cost-contract
parent_design: vibepro-automation-readable-value-audit
architecture_docs:
  - docs/architecture/vibepro-automation-readable-value-audit.md
spec_docs:
  - docs/specs/vibepro-automation-readable-value-audit.md
created_at: 2026-06-28
updated_at: 2026-06-28
---

# Story

Daily Codex automation audits VibePro to check whether VibePro is improving product value or
spending too much time and token budget on process, gates, review evidence, and audit artifacts.
That automation should not need to infer this from scattered PR JSON, replay bundles, and human
summaries.

VibePro should persist a compact, machine-readable `automation_value_audit` contract in canonical
audit artifacts. The contract is not a final value judgment. It is the stable evidence input that
automation can use to compare implementation effort, test/docs/audit effort, token/time availability,
gate/review signal, and residual risk across daily runs.

## Acceptance Criteria

- [x] `AVA-AC-001`: Canonical audit promotion writes `automation_value_audit` into compact
  `audit-index.json` and `audit-bundle.json`.
- [x] `AVA-AC-002`: Full canonical audit bundles also expose the same `automation_value_audit`
  summary at top level.
- [x] `AVA-AC-003`: The contract separates `src`, `test`, story/spec/architecture docs,
  audit-artifacts, and other changed lines, and reports evidence-to-src ratios.
- [x] `AVA-AC-004`: The contract keeps token/time availability explicit without fabricating
  values, and records stable finding IDs such as `session_cost_unavailable` and
  `artifact_budget_exceeded`.
- [x] `AVA-AC-005`: `usage report --json` and the rendered usage report surface the same
  automation value audit summary for daily automation and human debugging.

## Non Goals

- Making `execute merge` decide whether VibePro produced enough value.
- Automatically resolving Codex or Claude Code session windows.
- Blocking merge on value-audit findings.
