---
story_id: story-vibepro-review-dispatch-preflight-dag
title: VibePro should block wasteful Agent Review dispatch before review loops start
architecture_docs:
  reason: Existing Agent Review DAG/lifecycle surfaces are extended; no new runner architecture is introduced.
spec_docs:
  - docs/specs/vibepro-review-dispatch-preflight-dag.md
---

# Story: VibePro should block wasteful Agent Review dispatch before review loops start

## Context

Agent Review improves PR judgment only when the right role reviews are dispatched once, against the current git state, and with recoverable lifecycle evidence. Recent dogfood audits showed review loops become low-value when a coordinator dispatches another reviewer while a same-role reviewer is still running, when stale review results are redispatched without noticing the HEAD/fingerprint mismatch, or when a timed-out/manual_shutdown subagent has no replacement trail.

## User Story

As a VibePro coordinator, I want the PR Gate DAG to show Agent Review dispatch preflight failures before `review prepare` and role review nodes, so I can avoid duplicate, stale, or unrecoverable review loops and hand off the current state to another engineer/agent.

## Acceptance Criteria

- [ ] Gate DAG contains a stage-level `agent_review_dispatch_batch_gate` before `review:prepare:<stage>`.
- [ ] Gate DAG contains per-role `agent_review_dispatch_preflight_gate` nodes for stale git evidence, running duplicate lifecycle, timeout/manual shutdown recovery, current pass dedupe, and missing-role readiness.
- [ ] DAG edges force `dispatch_batch -> preflight -> prepare -> role -> record -> join`, preserving serial stage barriers.
- [ ] Timed-out and manually shut down Agent Review lifecycle entries produce concrete recovery actions in review status artifacts.
- [ ] Existing Agent Review Gate semantics remain unchanged: required reviews still need verified parallel subagent provenance and closed lifecycle evidence.

## Non-goals

- This story does not make VibePro spawn subagents itself.
- This story does not replace Agent Review role policy selection.
- This story does not weaken stale evidence or provenance validation.
