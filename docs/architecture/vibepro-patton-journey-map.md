---
story_id: story-vibepro-patton-journey-map
title: Patton-style Journey Map Architecture
status: draft
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Patton-style Journey Map Architecture

## Intent

VibePro must preserve its current role as a Story / Architecture / Spec / Gate control plane while adding a Patton-style Journey Map layer that answers: "What is the latest user journey represented by the active Stories?"

The Journey Map is not a replacement for VibePro Story records. Stories remain the unit of change, evidence, implementation, and PR readiness. The Journey Map is a synthesized snapshot that organizes those Stories into user activities, release slices, walking skeleton coverage, and journey conflicts.

## Boundary

| Component | Responsibility | Must Not Do |
|----------|----------------|-------------|
| Story Evidence Map | Show Story coverage, source evidence, Graphify coverage, and missing Story candidates | Pretend category/coverage output is a Patton-style user journey |
| Journey Map | Organize active Stories into user activity order, release slices, walking skeleton, conflicts, and open questions | Replace Story, Spec, Architecture, or Gate DAG as implementation authority |
| Gate DAG | Decide whether a PR has enough evidence to proceed | Infer user journey silently without exposing source Stories and confidence |
| Split Plan | Suggest reviewable PR slices | Split only by technical files when the change is workflow-heavy and affects a user journey |

## Data Flow

```text
active Story docs
story-catalog.json
Spec clauses
Graphify coverage
PR / Gate evidence
        |
        v
journey derive
        |
        +--> .vibepro/journey/latest-journey.json
        +--> .vibepro/journey/latest-journey.md
        +--> .vibepro/journey/history/<timestamp>.json
```

## Journey Classification

Product or user-facing Stories should be placed on the Journey backbone when there is enough evidence for user activity order. Architecture, security, ops, quality, and docs Stories should usually attach as enablers or cross-cutting controls unless the Story explicitly describes a user-visible workflow.

Journey order should use, in priority order:

- explicit Story/Spec journey metadata
- existing `workflowPositionFor` hints
- route/API transition evidence
- Graphify adjacency and affected surfaces
- Story title/body user-story fields
- created/updated timestamps only as weak tie-breakers

## Output Policy

`latest-journey.json` is the machine-readable source of truth. `latest-journey.md` is the human review surface. If the Journey Map cannot confidently place a Story, it must keep the Story visible as unplaced rather than forcing it into an activity.

## PR Readiness Integration

For workflow-heavy or product-facing changes, `pr prepare` should include Journey Map status in PR evidence. Missing Journey Map evidence should not break existing VibePro workflows by default, but unresolved walking skeleton gaps or journey conflicts should be visible when they affect a changed Story.
