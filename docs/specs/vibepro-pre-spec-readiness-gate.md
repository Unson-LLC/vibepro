---
story_id: story-vibepro-pre-spec-readiness-gate
title: Pre-Spec Readiness Gate Spec
parent_design: vibepro-pre-spec-readiness-gate
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        A["Agent writes final Spec"] --> B["Pre-Spec Readiness check"]
        B --> C{"Story, Graphify, diagnosis, architecture check, Engineering Judgment ready?"}
        C -->|yes| D["final spec.json can be written"]
        C -->|no| E["final write blocked; draft remains available"]
        F["Responsibility Authority evidence"] --> G{"clean verify-record git_context and clause evidence?"}
        G -->|yes| H["contract evidence can satisfy Gate"]
        G -->|no| I["Gate remains unresolved"]
        J["Malformed authority registry"] --> I
    rationale: Final Spec promotion and Responsibility Authority evidence both affect VibePro gate authority; stale or malformed evidence must fail closed before PR creation.
---

# Spec

## Commands

```bash
vibepro spec readiness <repo> --id <story-id> [--base <ref>] [--json]
vibepro spec write <repo> --id <story-id> --draft
vibepro spec write <repo> --id <story-id> --final
```

## Contract

- `PSR-CONTRACT-001`: `spec readiness` MUST write `.vibepro/spec/<story-id>/pre-spec-readiness.json`.
- `PSR-CONTRACT-002`: readiness MUST include checks for Story, Graphify, Story diagnosis, Architecture check, and Engineering Judgment.
- `PSR-CONTRACT-003`: `spec write --final` MUST fail when readiness is missing, blocked, or stale for the current git HEAD.
- `PSR-CONTRACT-004`: `spec write --draft` MUST validate the input and write `draft.json` without updating final `spec.json`.
- `PSR-CONTRACT-005`: final `spec.json` remains the only Spec read by `spec show`, `spec drift`, and PR Gate contexts.
- `PSR-CONTRACT-006`: Responsibility Authority evidence matching MUST treat a passing `verify record` command with clean `git_context.head_sha` / `dirty=false` as current evidence, and MUST include `observation.values` in the evidence search surface.
- `PSR-CONTRACT-007`: Responsibility Authority registry validation MUST fail closed when `primary_authority.ref` is missing or `primary_authority.kind` is outside the accepted authority kinds.

## Scenarios

- `PSR-SCENARIO-001`: Given readiness is missing, when an agent runs `spec write --final`, then the command exits non-zero and tells the agent to run `spec readiness`.
- `PSR-SCENARIO-002`: Given readiness is blocked, when an agent runs `spec write --draft`, then the command writes a draft and does not update final Spec.
- `PSR-SCENARIO-003`: Given readiness is ready for the current HEAD, when an agent runs `spec write --final`, then final `spec.json` is written and the response includes the readiness artifact reference.
- `PSR-SCENARIO-004`: Given Responsibility Authority evidence was recorded by `verify record` with clean `git_context` and required observations in `observation.values`, when `pr prepare` resolves responsibility contracts, then the matching contract can pass as current-head evidence.
- `PSR-SCENARIO-005`: Given a responsibility registry entry omits `primary_authority.ref` or uses an unsupported authority kind, when Responsibility Authority validation runs, then the entry remains invalid instead of silently becoming trusted authority.

## Verification

- Unit/CLI coverage asserts final Spec writes are blocked by blocked readiness.
- Unit/CLI coverage asserts draft writes remain possible without final readiness.
- Existing Spec pipeline coverage continues to assert final `spec show` reads from `spec.json`.
- Responsibility Authority coverage asserts clean `verify record` git context and `observation.values` satisfy current evidence, while malformed primary authority metadata fails closed.
