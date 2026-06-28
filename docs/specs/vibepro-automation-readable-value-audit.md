---
story_id: story-vibepro-automation-readable-value-audit
title: Automation Readable Value Audit Evidence Spec
parent_design: vibepro-automation-readable-value-audit
---

# Spec

## Contracts

- `AVA-CONTRACT-001`: Canonical audit artifacts MUST expose `automation_value_audit` with
  `artifact_kind=vibepro_automation_value_audit`.
- `AVA-CONTRACT-002`: `automation_value_audit.status` MUST be one of `ready`, `partial`,
  `needs_evidence`, or `not_merged`.
- `AVA-CONTRACT-003`: The allocation section MUST expose implementation changed lines and
  audit-evidence changed lines using the same path buckets as `cost_summary.changed_lines`.
- `AVA-CONTRACT-004`: Ratio fields MUST be numeric when the denominator is known and positive, and
  `null` otherwise.
- `AVA-CONTRACT-005`: Session cost fields MUST preserve token/time status and measured values from
  `cost_summary` without inventing values.
- `AVA-CONTRACT-006`: Findings MUST use stable IDs so daily automation can aggregate them across
  runs.
- `AVA-CONTRACT-007`: `usage report` MUST preserve the compact contract in JSON and render a concise
  story row for human audit debugging.

## Scenarios

- `AVA-SCENARIO-001`: Given canonical audit promotion with diff stats and no session accounting,
  automation sees changed-line allocation plus `session_cost_unavailable`.
- `AVA-SCENARIO-002`: Given compact canonical audit promotion with token/time accounting, automation
  sees the measured cost values in `automation_value_audit.session_cost`.
- `AVA-SCENARIO-003`: Given a canonical audit bundle with over-budget evidence, usage report exposes
  automation value status, implementation lines, audit evidence lines, ratio, and finding IDs.

## Verification

- `AVA-VERIFY-001`: `test/canonical-audit-self-contained.test.js` asserts full and compact
  canonical artifacts include the contract.
- `AVA-VERIFY-002`: `test/traceability-usage-report.test.js` asserts `usage report` JSON and text
  expose the automation value audit contract.
