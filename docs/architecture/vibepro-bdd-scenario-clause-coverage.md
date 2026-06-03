---
story_id: story-vibepro-bdd-scenario-clause-coverage
title: BDD scenario clause coverage Architecture
status: active
created_at: 2026-06-03
updated_at: 2026-06-03
---

# BDD scenario clause coverage Architecture

## Intent

BDD support in VibePro strengthens the existing Story -> Architecture -> Spec -> TestCode -> Code chain. It does not add a new workflow phase, external BDD runner, scheduler, worker, queue, daemon, or job infrastructure.

The Architecture role is to provide information architecture, route-flow, state, and boundary evidence that can shape scenario clauses. The Spec role remains the machine-checkable authority for behavior.

## Boundary

| Area | Responsibility | Must Not Do |
|---|---|---|
| Story | Defines user value and acceptance criteria | Carry executable behavior details alone |
| Architecture / IA | Describes screens, navigation, route-flow, state, dependencies, and boundaries | Replace Spec as behavioral authority |
| Spec | Stores invariant, scenario, contract, and SLA clauses with traceable origins | Store free-form Gherkin documents |
| TestCode | Marks coverage with `AC-<n>`, `S-<n>`, or equivalent markers and executable assertions | Treat comments without assertions as coverage |
| Gate DAG | Blocks missing scenario or acceptance coverage when the change requires it | Make every docs-only or light change workflow-heavy |

## Data Flow

```text
Story acceptance criteria
Architecture / IA / route-flow / state / boundary evidence
Code fingerprint
Test fingerprint
        |
        v
spec fingerprint with architecture_fingerprint
        |
        v
AI-authored Spec clauses
        |
        v
Spec validator verifies origins and patterns
        |
        v
PR prepare checks acceptance and scenario coverage
```

## Job Infrastructure

This story has no runtime job infrastructure. It changes CLI analysis, Spec validation, prompt instructions, and PR Gate evidence only. No worker, queue, cron, server-side scheduler, container, daemon, or external BDD runner is introduced.

## IA And Scenario Boundary

Information architecture and UI flow evidence may explain the path: current screen, navigation target, state, and dependency. Scenario clauses must still express verifiable behavior: starting state, action or event, and expected result.

If Story and Architecture imply a path but the expected result is ambiguous, the AI must emit a blocker open question instead of inventing behavior.
