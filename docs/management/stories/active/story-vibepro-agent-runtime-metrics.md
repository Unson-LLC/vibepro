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
