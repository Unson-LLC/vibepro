---
story_id: story-vibepro-agent-review-policy-config
title: VibePro Agent Review Policy Config Spec
---

# Spec

## Required Behavior

- VibePro treats built-in Agent Review roles as defaults, not as hard-coded-only policy.
- `.vibepro/config.json` may define `agent_reviews.stages.<stage>.roles` to override the roles prepared and summarized for a stage.
- `.vibepro/config.json` may define `agent_reviews.roles.<role>.mode` as `required`, `optional`, or `disabled`.
- Required PR Agent Review policy excludes `optional` and `disabled` roles.
- `.vibepro/config.json` may define `agent_reviews.roles.<role>.when_changed` path patterns; required PR Agent Review policy only activates that role when a changed file matches.
- `.vibepro/config.json` may define `agent_reviews.defaults.timeout_ms` and role-level `timeout_ms`; lifecycle start guidance and default lifecycle entries use configured timeout values.
- Custom roles listed in stage config can be prepared, recorded, summarized, and used in review artifacts.

## Invariants

- `INV-ARP-1`: If no config is present, built-in Agent Review behavior is unchanged.
- `INV-ARP-2`: A disabled role must not be required by PR readiness.
- `INV-ARP-3`: An optional role may appear in review preparation but must not block PR readiness by itself.
- `INV-ARP-4`: Path activation must be based on changed files, not on repository-wide file presence.
- `INV-ARP-5`: VibePro still records review results; it does not execute subagents.

## Non Goals

- VibePro does not provide a plugin system for arbitrary reviewer code.
- VibePro does not infer role prompts from external services.
