---
story_id: story-vibepro-architecture-readiness-gate
title: Architecture Readiness Gate Spec
parent_design: vibepro-architecture-readiness-gate
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        A["Agent writes Architecture"] --> B{"draft or final?"}
        B -->|draft| C["Write .vibepro/architecture/<story-id>/draft.md"]
        B -->|final| D["Architecture Readiness check"]
        D --> E{"Story, Graphify, diagnosis, architecture check, Engineering Judgment ready and current?"}
        E -->|yes| F["Write final docs/architecture artifact"]
        E -->|no| G["Block final promotion; draft remains available"]
        F --> H["Spec can be derived from authoritative Architecture"]
    rationale: Final Architecture promotion affects downstream Spec and implementation authority, so missing or stale evidence must fail closed before the document becomes authoritative.
---

# Spec

## Commands

```bash
vibepro architecture readiness <repo> --id <story-id> [--base <ref>] [--json]
vibepro architecture write <repo> --id <story-id> [--input <file>|--from-stdin] [--caller <name>] [--output <path>] --draft
vibepro architecture write <repo> --id <story-id> [--input <file>|--from-stdin] [--caller <name>] [--output <path>] --final
```

## Contract

- `AR-CONTRACT-001`: `architecture readiness` MUST write `.vibepro/architecture/<story-id>/architecture-readiness.json`.
- `AR-CONTRACT-002`: readiness MUST include checks for Story, Graphify, Story diagnosis, Architecture check, and Engineering Judgment.
- `AR-CONTRACT-003`: `architecture write --final` MUST fail when readiness is missing, blocked, or stale for the current git `HEAD`.
- `AR-CONTRACT-004`: `architecture write --draft` MUST write `.vibepro/architecture/<story-id>/draft.md` without requiring readiness.
- `AR-CONTRACT-005`: final Architecture output MUST default to `docs/architecture/<story-id>.md` and MAY be overridden with repository-relative `--output`.
- `AR-CONTRACT-006`: absolute `--output` paths MUST be rejected.
- `AR-CONTRACT-007`: README and README.ja MUST show Architecture readiness before final Architecture promotion and before Spec readiness.

## Scenarios

- `AR-SCENARIO-001`: Given readiness is missing, when an agent runs `architecture write --final`, then the command exits non-zero and tells the agent to run `architecture readiness`.
- `AR-SCENARIO-002`: Given readiness is blocked, when an agent runs `architecture write --draft`, then the command writes the draft and does not create or update final Architecture.
- `AR-SCENARIO-003`: Given readiness is ready for the current `HEAD`, when an agent runs `architecture write --final`, then the final markdown file is written and the response includes the readiness artifact reference.
- `AR-SCENARIO-004`: Given readiness was recorded for a different `HEAD`, when an agent runs `architecture write --final`, then the command blocks with `current_head=stale`.
- `AR-SCENARIO-005`: Given prerequisite artifacts exist, when an agent runs `architecture readiness`, then the artifact records the same pre-architecture evidence surfaces that humans expect before Architecture finalization.

## Verification

- CLI tests cover missing readiness blocking final write.
- CLI tests cover blocked readiness while draft write succeeds.
- CLI tests cover stale `HEAD` readiness.
- CLI tests cover readiness artifact generation from Story, Graphify, diagnosis, Architecture check, and Engineering Judgment evidence.
- CLI tests cover successful final Architecture write after ready evidence.
