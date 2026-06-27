---
story_id: story-vibepro-codebase-memory-skill
title: Codebase Memory Skill Spec
parent_design: vibepro-codebase-memory-skill
diagrams:
  - kind: state
    title: Codebase memory skill evidence state
    mermaid: |
      stateDiagram-v2
        [*] --> ProviderMissing
        ProviderMissing --> SkillInstalled: codebase-memory-mcp install
        SkillInstalled --> RepoIndexed: index_repository
        RepoIndexed --> ImpactContextAvailable: detect_changes or pr prepare
        ImpactContextAvailable --> VibeProEvidenceMapped: map to Story / Gate DAG / PR evidence
        VibeProEvidenceMapped --> Verified: tests and review evidence pass
        ImpactContextAvailable --> ProviderMissing: provider unavailable, treat as optional context
    rationale: "State diagram for optional codebase-memory provider availability and the boundary between topology context and VibePro verification evidence."
  - kind: flow
    title: VibePro codebase-memory skill flow
    mermaid: |
      flowchart TD
        Upstream["codebase-memory-mcp skill"] --> Native["vibepro-codebase-memory"]
        Native --> Skills["vibepro skills list/install/verify/lint"]
        Native --> Workflow["vibepro-workflow Operating Order"]
        Workflow --> Prepare["vibepro pr prepare"]
        Prepare --> Context["pr_context.code_topology_context"]
        Context --> Gate["Gate DAG optional evidence"]
        Gate --> Review["tests / review / split decision"]
    rationale: "Flow diagram for how upstream topology instructions become a VibePro-native bundled skill and supporting PR evidence."
---

# Spec

## Invariants

- `CBMS-INV-1`: VibePro MUST NOT vendor the upstream `codebase-memory` skill verbatim.
- `CBMS-INV-2`: The bundled VibePro skill MUST describe how topology results map to VibePro Story, Gate DAG, PR evidence, and review scope.
- `CBMS-INV-3`: Missing or failing `codebase-memory-mcp` MUST NOT make VibePro skills lint, install, or verify fail.
- `CBMS-INV-4`: The skill MUST state that `code_topology_impact_scope` is supporting evidence only and not correctness evidence.

## Contracts

- `CBMS-CONTRACT-1`: `vibepro-codebase-memory` MUST include frontmatter `name` and `description`.
- `CBMS-CONTRACT-2`: `vibepro-codebase-memory` MUST include `When to Use`, a process section, `Common Rationalizations`, `Red Flags`, and `Verification`.
- `CBMS-CONTRACT-3`: `vibepro-workflow` MUST refer to `vibepro-codebase-memory` for impact-sensitive work when the provider is installed and indexed.
- `CBMS-CONTRACT-4`: Public docs MUST mention the bundled skill as the agent-facing way to use code topology context consistently.

## Scenarios

- `CBMS-S-1`: Given bundled skills are listed, when `vibepro skills list` runs, then `vibepro-codebase-memory` appears.
- `CBMS-S-2`: Given an empty target repo, when `vibepro skills install <repo>` runs, then `.claude/skills/vibepro-codebase-memory/SKILL.md` is installed.
- `CBMS-S-3`: Given the bundled skills are linted, when `vibepro skills lint <repo>` runs, then the new skill passes the Agent Skill Contract.
- `CBMS-S-4`: Given a VibePro agent is about to change broad core workflow code, when the workflow skill is read, then it points to `vibepro-codebase-memory` in addition to Graphify.

## Anti-patterns

- `CBMS-AP-1`: Do not make `codebase-memory-mcp` a package dependency or bundled binary.
- `CBMS-AP-2`: Do not copy upstream tool instructions without VibePro Gate evidence boundaries.
- `CBMS-AP-3`: Do not treat topology evidence as a substitute for tests, flow replay, artifact replay, CI, or review evidence.

## Verification

- `CBMS-V-1`: Focused CLI test covers skills list/install/verify behavior for `vibepro-codebase-memory`.
- `CBMS-V-2`: `vibepro skills lint . --json` passes with five bundled skills.
- `CBMS-V-3`: `npm run docs:build` validates the public manual pages that mention the skill.
