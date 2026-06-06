---
story_id: story-vibepro-story-contract-dag
title: VibePro Story Contract DAG Architecture
---

# Architecture

## Decision

Implement Story Contract inside the existing Story Catalog pipeline, not as a separate command. `buildDerivedStory` is the correct boundary because it already has story definition, source paths, docs, planning questions, business context, and meaning evidence in one place.

`story-manager` consumes the resulting `derived.story_contract` and raises unresolved contract checks into planning score, source alignment findings, and task candidates.

## Data Flow

```
docs/code/repo profile
        │
        ▼
story derive ──► buildDerivedStory ──► story_definition
                                      ├── meaning
                                      ├── planning.open_questions
                                      └── story_contract
                                               ├── story_type
                                               ├── source_role_integrity
                                               ├── developer_boundary
                                               ├── risk_surface
                                               └── verification_strategy
        │
        ▼
story-catalog.json / story-map.md
        │
        ▼
story plan ──► priority score
             ├── source_alignment_findings
             ├── questions
             └── task_candidates
```

## Boundaries

- `src/story-catalog-generator.js` owns contract derivation and Story Map rendering.
- `src/story-manager.js` owns plan prioritization, findings, and task candidates.
- `test/vibepro-cli.test.js` owns regression coverage for document-only product story ambiguity.

## Failure Mode Covered

The concrete failure this design targets is a developer-tool repo containing docs about "authorization scoring". That phrase is not automatically a user-facing auth/account-access product requirement. In a non-web/library repo with document-only evidence and no explicit preset, VibePro should not silently treat that as aligned product intent. It should keep the story if document evidence exists, but mark `source_role_integrity` as needing clarification and ask whether the document is really a product requirement or an internal VibePro capability.

## Reasoning

Business stakeholders can state outcomes, but cannot reliably state architecture boundaries, affected code surfaces, regression physics, or verification strategy. VibePro therefore needs a contract layer between business input and implementation. This is close to Engineering Judgment DAG: it converts incomplete intent into explicit hypotheses, then makes unresolved hypotheses visible before AI agents implement.
