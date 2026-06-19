---
story_id: story-vibepro-subagent-roi-decision-signal
title: Subagent ROI Decision Signal Architecture
---

# Architecture

## Decision

`usage report --subagent-roi` should support review-policy pruning and evidence improvement decisions, not merely prove that subagents ran.

## Classification Model

The report classifies each review by decision impact. Accepted or resolved findings are high-value candidates because they changed or protected merge judgment. Pass-only reviews without findings, disposition, or judgment delta are waste candidates because they consumed review capacity without producing a reusable decision signal. Findings without disposition remain unresolved value, not success.

## Output Shape

The machine-readable report emits per-review signals and story-level role recommendations. The human-readable report groups by continue, reduce, and needs-evidence categories so the next operational decision is visible without reverse-engineering numeric scores.

## Boundary

This story does not make ROI a blocking gate and does not require historical token/cost backfill. Missing cost is represented explicitly so reports cannot accidentally imply that subagent review was free.

## Implementation Note

The implementation treats ROI as an operational classification layer. Reviews with accepted or resolved findings become high-value candidates; pass-only reviews without decision signal become reduction candidates; missing token/cost evidence becomes an evidence-quality issue.
