---
story_id: story-vibepro-agent-runtime-metrics
title: "usage report separates wall-clock and agent-specific runtime metrics"
status: active
---

# Story: usage report separates wall-clock and agent-specific runtime metrics

## Problem

VibePro value audits currently reconstruct time efficiency from session logs and review artifacts after the fact. That makes reports easy to misread: one subagent window can be mistaken for the parent thread runtime, and parallel subagent minutes can be mistaken for wall-clock elapsed time.

## User Story

As a VibePro operator,
I want `usage report --subagent-roi` to expose wall-clock runtime, summed agent consumption, and agent-system-specific token coverage separately,
so that Codex, Claude Code, and future agent runtimes can be compared without hiding missing telemetry or double-counting parallel work.

## Acceptance Criteria

- [ ] `usage report --subagent-roi --json` exposes `subagent_roi.time_efficiency.wall_clock_elapsed_ms` from merged lifecycle intervals.
- [ ] `usage report --subagent-roi --json` keeps summed concurrent work as `agent_consumption_elapsed_ms` instead of overloading wall-clock time.
- [ ] `usage report --subagent-roi --json` exposes `by_agent_system[]` with per-agent-system review counts, wall-clock minutes, summed agent minutes, token totals, and missing-token counts.
- [ ] Text output labels `wall_clock_minutes`, `agent_consumption_minutes`, and agent-system rows distinctly.
- [ ] Missing lifecycle intervals or token data remain explicit instead of being converted to zero wall-clock or zero-token evidence.

## Runtime Evidence

- current_reality: The implementation changes only `src/usage-report.js` reporting aggregation plus focused tests and docs. It does not add a scheduler, worker, database write, external send, deployment path, or new command surface.
- failure_modes: Missing lifecycle intervals must remain `null`/`unknown`, missing token totals must remain `null`/`unknown` with missing counters, and concurrent review intervals must not be double-counted as wall-clock time.
- done_evidence: `node --test test/traceability-usage-report.test.js`, the targeted `test/vibepro-cli.test.js` ROI test, and `npm run typecheck` are the required verification evidence. VibePro verification records bind these checks to the current HEAD.

## Architecture Decision

ADR-unnecessary: This story stays inside the existing `usage report --subagent-roi` reporting architecture. No new persistence model, runtime topology, workflow state machine, production job infrastructure, network boundary, or public mutation path is introduced.

## Responsibility Authority

no_registered_authority: Responsibility Authority Registry is not required for this story because the change is read-only reporting metric semantics over existing review lifecycle and token fields. It does not change ownership of secrets, credentials, external sends, database state, deployment authority, or user data.

## Scope Reviewability

scope_reviewed: The PR is intentionally one story-scoped change. The follow-up commit only resolves the gate_evidence reviewer finding by changing missing agent-system token totals from fake `0` to `null` and updating tests.
review_owner_map: One reviewer can evaluate the story through `src/usage-report.js`, `test/traceability-usage-report.test.js`, `test/vibepro-cli.test.js`, this Story, and `docs/specs/vibepro-agent-runtime-metrics.md`.
graph_impact_scope: The impact is limited to VibePro usage-report audit output and does not alter graph, journey, design, workflow execution, or merge orchestration behavior.
