---
story_id: story-vibepro-bdd-scenario-clause-coverage
title: BDD scenario clause coverage Spec
status: active
created_at: 2026-06-03
updated_at: 2026-06-03
related_architecture:
  - ../architecture/vibepro-bdd-scenario-clause-coverage.md
---

# BDD scenario clause coverage Spec

## Invariants

- `INV-BDD-1`: BDD support must be represented as VibePro `scenario` clauses and coverage evidence, not as a required external BDD runner.
- `INV-BDD-2`: Spec clause origins may cite Architecture / IA evidence through `origin.architecture_refs[]`.
- `INV-BDD-3`: IA and route-flow evidence must not replace verifiable Spec behavior; scenario clauses still need a concrete state, action or event, and expected result.
- `INV-BDD-4`: Missing scenario coverage must not make docs-only or light changes workflow-heavy by itself.

## Contracts

- `C-BDD-1`: `spec fingerprint` output includes `architecture_fingerprint` with related Architecture / IA / flow / state / boundary snippets and `inputs_digest.architecture_sha`.
- `C-BDD-2`: `spec-schema.json` and `spec-validator.js` accept `origin.architecture_refs[]` and validate referenced files.
- `C-BDD-3`: `pr prepare` exposes scenario clause coverage in `acceptance_e2e_coverage.scenario_e2e_coverage`.
- `C-BDD-4`: E2E scenario coverage requires an executable test block containing a scenario marker such as `S-001` and an assertion tied to the scenario statement.

## Scenarios

- `S-BDD-1`: Given a Story acceptance criterion and Architecture UI flow evidence, when `spec fingerprint --include-instructions` is generated, then the calling AI receives guidance to synthesize a `type: "scenario"` clause with Story and Architecture origins.
- `S-BDD-2`: Given a scenario clause exists for a Story, when `pr prepare` finds no matching executable E2E/TestCode marker, then the E2E coverage evidence lists the scenario as missing.
- `S-BDD-3`: Given a matching `S-<n>` marker and assertion exist in a story-scoped E2E spec, when `pr prepare` runs, then `scenario_e2e_coverage.status` is `passed`.

## Verification

- `V-BDD-1`: `test/spec-pipeline.test.js` verifies Architecture fingerprint extraction and `architecture_refs` validation.
- `V-BDD-2`: `test/vibepro-cli.test.js` verifies missing and passing scenario clause E2E coverage.
- `V-BDD-3`: `test/risk-adaptive-gate.test.js` keeps workflow-heavy release confidence tied to scenario coverage.
- `V-BDD-4`: `npm test` passes.
- `V-BDD-5`: `npm run typecheck` passes.
