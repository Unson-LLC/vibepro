---
story_id: story-vibepro-oss-engineering-judgment-pr-message
title: OSS Engineering Judgment PR Message Spec
---

# OSS Engineering Judgment PR Message Spec

## Invariants

- `INV-OEJ-1`: `vibepro pr prepare` MUST render an Engineering Judgment reasoning trace near the top of the PR body when `engineering_judgment` exists.
- `INV-OEJ-2`: The reasoning trace MUST include separate sections for judged inputs, judgment signals, selected-DAG checks, and evidence/merge boundary.
- `INV-OEJ-3`: The reasoning trace MUST translate classifier signals into reviewer-facing reasons; route labels alone are insufficient.
- `INV-OEJ-4`: The reasoning trace MUST use the existing Gate DAG as its source of evidence status and MUST NOT create a second readiness decision.
- `INV-OEJ-5`: Existing decision graph and audit log sections MUST remain available after the reasoning trace.

## Scenarios

- `S-OEJ-1`: For an `agent_workflow` change, PR body shows the `surface:agent_or_gate_workflow` signal, route-specific agent workflow gates, and evidence lifecycle status.
- `S-OEJ-2`: If all required gates are closed, the merge boundary says required gates are closed and asks the reviewer to validate the DAG assumptions against the diff.
- `S-OEJ-3`: If required gates are unresolved, the merge boundary names those gates and defers merge judgment until evidence or waiver exists.

## Anti-Patterns

- `AP-OEJ-1`: Do not render only `route_type / route_dag / confidence` as the Engineering Judgment explanation.
- `AP-OEJ-2`: Do not personalize the message for someone who already knows VibePro internals.
- `AP-OEJ-3`: Do not hide Gate DAG details behind the digest; the digest is the first read, not the audit record.

## Verification

- `V-OEJ-1`: E2E `pr prepare` test asserts the PR body includes Engineering Judgment reasoning trace headings, translated signals, route-specific checks, evidence status, and the existing decision graph.
- `V-OEJ-2`: `node --check src/pr-manager.js` passes.
