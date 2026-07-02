---
story_id: story-vibepro-agent-review-minimal-recovery-plan
title: Agent Review Minimal Recovery Plan Architecture
status: active
---

# Agent Review Minimal Recovery Plan Architecture

## Decision

`gate:agent_review` adds a read-only `minimal_recovery_plan` to its gate output when
required reviews are missing, stale, running, timed out, or blocking. The field is
diagnostic guidance for recovery; it does not relax Agent Review Gate readiness and
does not replace `review prepare`, `review start`, `review close`, or
`review record` lifecycle evidence.

The plan is omitted for passed and not-required states so existing consumers that
only need the final gate status keep the same contract.

## Public Output Contract

The new field is additive JSON on the Agent Review Gate node and in the PR first-look
gate status summary. Consumers can rely on:

- `schema_version`, `story_id`, `status`, blocker counts, and `rerun_command`
- `first_command` as the next single command to unblock the current state
- `current_stage` and `current_stage_work` for work that can be acted on now
- `later_stages_blocked` for serial-stage work that must wait
- timed-out lifecycle details with exact `agent_id`, `lifecycle_id`,
  `close_command`, and `replacement_command`

The plan groups duplicate blockers by review artifact identity (`stage:role`) before
rendering recovery work. Multiple symptoms for the same review, such as a stale
result and a timed-out lifecycle, remain visible in `details` but produce one current
work item.

## Execution Topology

The topology stays inside the existing PR preparation path:

```text
pr prepare
  -> collect Agent Review status and lifecycle artifacts
  -> build gate:agent_review
  -> derive minimal_recovery_plan from unmet blockers
  -> render Gate DAG JSON, first-look text, pr-prepare HTML, and gate_status mirror
```

The plan is derived from existing Agent Review summary data and does not start,
close, or record agents. Recovery commands remain explicit user/coordinator actions,
and `later_stages_blocked` preserves the existing serial stage barrier.

## Compatibility

Existing output remains backward-compatible because the change only adds a nullable
field. Passing and not-required gates continue to omit the plan, and readiness is
still driven by gate status, recorded review provenance, and current-head evidence.
