---
story_id: story-vibepro-agent-review-policy-config
title: VibePro Agent Review Policy Config Architecture
---

# Architecture

## Decision

Keep the current built-in Agent Review stage map as the default policy, then layer `.vibepro/config.json` overrides on top of it at read time.

The config surface is:

```json
{
  "agent_reviews": {
    "defaults": {
      "timeout_ms": 600000
    },
    "stages": {
      "gate": {
        "roles": ["gate_evidence", "release_risk"]
      }
    },
    "roles": {
      "release_risk": {
        "mode": "optional",
        "timeout_ms": 900000,
        "when_changed": ["src/**"]
      }
    }
  }
}
```

## Boundaries

- Agent Review owns policy normalization, role validation, review preparation, lifecycle timeout defaults, and PR required-review derivation.
- PR preparation passes changed-file groups into Agent Review policy evaluation.
- Config does not alter the meaning of recorded review result provenance.

## State

No new workspace artifact is required. The source of truth is `.vibepro/config.json`, and generated review artifacts include the resolved stage policy for auditability.
