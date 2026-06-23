---
story_id: story-vibepro-evidence-cost-budget
title: Evidence Cost Budget Spec
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Story["Story + changed files + risk profile"] --> Budget["evidence budget planner"]
        Budget --> Summary["summary depth: decision index only"]
        Budget --> Standard["standard depth: gate/review/verification summaries"]
        Budget --> Full["full depth: targeted raw/deep evidence"]
        Summary --> AuditIndex["audit-index / decision-summary"]
        Standard --> AuditIndex
        Full --> DeepRefs["deep evidence refs + digests"]
        AuditIndex --> Report["usage report / value audit"]
        DeepRefs --> Report
        Report --> Escalate["read full evidence only on red flags"]
---

# Spec

## Contracts

- `ECB-CONTRACT-001`: VibePro MUST choose an `evidence_depth` of `summary`, `standard`, or `full` before expensive evidence generation.
- `ECB-CONTRACT-002`: `summary` depth MUST NOT generate HTML reports, raw provider logs, raw transcripts, full review lifecycle dumps, or full Gate DAG dumps.
- `ECB-CONTRACT-003`: `standard` depth MUST generate a machine-readable decision index containing gate status, review conclusions, verification results, traceability counts, artifact digests, and unresolved references.
- `ECB-CONTRACT-004`: `full` depth MUST be triggered only by explicit risk signals or an explicit operator request.
- `ECB-CONTRACT-005`: Every `full` depth artifact MUST record `why_full_evidence_required`, `trigger_signal`, `expected_consumer`, and `budget_reason`.
- `ECB-CONTRACT-006`: Missing or stale evidence MUST be represented as `missing_evidence`, `unverified`, `stale`, or `handoff_blocked`; it MUST NOT be converted to `pass`.
- `ECB-CONTRACT-007`: VibePro MUST reuse existing summary/index artifacts inside the same PR lifecycle before regenerating equivalent LLM-readable evidence.
- `ECB-CONTRACT-008`: Canonical audit persistence MUST prefer compact summary/index/hash/reference artifacts over full raw artifact copies.
- `ECB-CONTRACT-009`: Canonical audit persistence MUST enforce a configurable artifact budget using changed lines and artifact/code ratio.
- `ECB-CONTRACT-010`: Value audit output MUST include cost decomposition for `src`, `test`, story/spec/architecture docs, and audit artifacts.
- `ECB-CONTRACT-011`: Token and elapsed-time accounting MUST be reported when session logs or explicit review metrics are available; unavailable data MUST be shown as `未確認`.
- `ECB-CONTRACT-012`: Evidence cost controls MUST NOT suppress Engineering Judgment risk detection, required review gates, traceability checks, or verification status.

## Default Depth Rules

- `ECB-DEPTH-001`: Low-risk doc-only or small code changes default to `summary`.
- `ECB-DEPTH-002`: Normal product/code changes default to `standard`.
- `ECB-DEPTH-003`: Workflow-heavy, security, network, release, production path, or migration-risk changes default to `full` or targeted full evidence for the affected risk surface.
- `ECB-DEPTH-004`: Any accepted waiver, unresolved reference, missing evidence, stale review, or traceability gap upgrades the affected surface to `full`.
- `ECB-DEPTH-005`: Operator-provided `--evidence-depth full` MAY force full depth, but the artifact MUST record that the depth was manually requested.

## Budget Rules

- `ECB-BUDGET-001`: Normal Story canonical audit artifacts SHOULD stay under 500 changed lines.
- `ECB-BUDGET-002`: High-risk Story canonical audit artifacts SHOULD stay under 1500 changed lines unless an explicit waiver records why more is necessary.
- `ECB-BUDGET-003`: Normal Story artifact/code changed-line ratio SHOULD stay at or below 1:1.
- `ECB-BUDGET-004`: High-risk Story artifact/code changed-line ratio SHOULD stay at or below 3:1.
- `ECB-BUDGET-005`: Budget overflow MUST produce a fake-value warning and switch canonical persistence to summary/index/hash/reference unless explicitly overridden.

## Invariants

- `ECB-INV-001`: Judgment quality is more important than artifact volume.
- `ECB-INV-002`: Reducing generation cost MUST NOT reduce risk sensitivity.
- `ECB-INV-003`: A future engineer must be able to reconstruct the merge decision from compact canonical artifacts and referenced raw evidence.
- `ECB-INV-004`: Full raw evidence is a targeted escalation path, not the default unit of work.

## Scenarios

- `ECB-SCENARIO-001`: Given a low-risk Story with no warnings, when `pr prepare` runs, then VibePro generates a compact decision index and does not generate full HTML/raw lifecycle evidence.
- `ECB-SCENARIO-002`: Given a Story with a traceability gap, when `pr prepare` runs, then the affected traceability surface escalates to targeted full evidence and records the trigger.
- `ECB-SCENARIO-003`: Given a merge whose canonical artifact diff would exceed budget, when `execute merge` persists audit evidence, then it stores summary/index/hash/reference and emits a fake-value warning.
- `ECB-SCENARIO-004`: Given a value audit run, when summary/index artifacts are available and clean, then the audit does not read full raw artifacts.
- `ECB-SCENARIO-005`: Given a missing raw artifact required by a red-flagged summary, when value audit runs, then it reports `未確認` or `handoff_blocked`, not `pass`.

## Verification

- `ECB-VERIFY-001`: Unit coverage asserts default `evidence_depth` selection for low-risk, normal, and high-risk changes.
- `ECB-VERIFY-002`: Unit coverage asserts budget overflow switches canonical persistence from full copy to summary/index/hash/reference.
- `ECB-VERIFY-003`: CLI coverage asserts `usage report` shows cost decomposition and preserves `未確認` when token/time logs are unavailable.
- `ECB-VERIFY-004`: Regression coverage asserts Engineering Judgment risk signals still appear when evidence depth is `summary`.
- `ECB-VERIFY-005`: Regression coverage asserts full evidence is generated only once per reusable evidence key within a PR lifecycle.
