---
story_id: story-vibepro-pr-prepare-authorization-scoring
title: VibePro PR Prepare Authorization Scoring Architecture
---

# Architecture

## Decision

Compute `authorization_scoring` inside `prepareForPr` in `src/pr-manager.js`, immediately after `buildPrContext` (so `pr_context.story_source` is available) and before the `preparation` object is assembled. Embed the result as a sibling field of `gate_status` on the returned preparation; the field flows automatically into `pr-prepare.json` via the existing serializer.

## Boundaries

- `pr-manager.js` owns: invocation of `classifyChangeRisk` + `scoreAuthorization`, embedding in `preparation`.
- `change-risk-classifier.js` owns: risk profile derivation (unchanged).
- `authorization-scoring.js` owns: level derivation + matrix lookup (unchanged).
- HTML / Markdown renderers are NOT touched in this story.

## Inputs and call order

```
fileGroups, storySource ──► classifyChangeRisk ──► riskProfile
                                                       │
storySource, decisions ───────────────────────────────►├──► scoreAuthorization ──► authorizationScoring
                                                       │                              │
                                                       └── embedded as ──► preparation.authorization_scoring
                                                                              ├── risk_profile (whole classifier output)
                                                                              ├── authorization_level
                                                                              ├── signals
                                                                              ├── review_outcome_recommendation
                                                                              └── matrix_cell
```

## Failure Modes

- `decisionRecords === null` → treat as `decisions: []`, scoring still succeeds.
- Story is transient (no path) → `storySource` is still provided by `buildPrContext`, so scoring sees whatever acceptance criteria exist; result may be `unknown` if none.
- `classifyChangeRisk` returns a profile not in the matrix → `scoreAuthorization` already handles this by falling through to `require_human_review` (see authorization-scoring spec).

## Reasoning

The scoring module exists but isn't yet visible to humans inspecting `pr-prepare.json`. Embedding it at the same level as `gate_status` matches the existing convention for advisory PR metadata (e.g., `scope`, `split_plan`) and avoids any need to invent a new artifact file.
