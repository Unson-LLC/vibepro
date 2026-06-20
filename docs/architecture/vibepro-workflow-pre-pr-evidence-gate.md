---
story_id: story-vibepro-workflow-pre-pr-evidence-gate
title: Workflow Pre-PR Evidence Gate Architecture
---

# Architecture

## Decision

Separate pre-PR workflow replay readiness from post-PR hosted preview validation.

`workflow_heavy` changes still need release-risk and runtime/network review before PR creation, but `preview_smoke` is not made PR-final because it normally depends on a hosted preview created after PR creation. Preview smoke remains available as a later review concern; UI changes keep pre-PR human-usability review instead.

## Evidence Model

Pre-PR workflow replay can be satisfied by either:

- current Flow Verification with at least one passing runtime probe, or
- current E2E verification evidence with structured observations that explicitly mention `flow_replay` and `scenario_clause_e2e`, target an existing E2E spec/test file under an `e2e` path, and use a command containing that full target path.

Zero-probe Flow Verification is not evidence. It is a configuration gap, so the Gate DAG returns concrete next actions for adding `flow_design.runtime_probes[]` or recording explicit E2E replay evidence.

Route files, arbitrary repo files, missing targets, and basename-only command matches are not accepted as workflow replay proof. Those paths can describe implementation surface, but they do not prove that a replaying E2E scenario exists.

Flow Verification may run through Basic Auth, but the architecture keeps secret material out of evidence. The evidence records whether Basic Auth was enabled and which environment variable source was used; it must not persist the password.

## Boundary

This does not create hosted previews. It only prevents pre-PR gates from depending on post-PR preview availability, while keeping workflow-heavy replay strict enough to reject marker-only tests.
