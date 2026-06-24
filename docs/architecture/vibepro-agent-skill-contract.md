---
title: VibePro Agent Skill Contract Architecture
status: draft
created_at: 2026-06-24
updated_at: 2026-06-24
related_stories:
  - story-vibepro-agent-skill-contract
---

# VibePro Agent Skill Contract Architecture

VibePro Agent Skill Contract is a native contract layer for bundled skills, Agent Review prompts, agent-harness checks, and PR Gate DAG completion semantics.

The design absorbs the useful parts of process-oriented skill systems without changing VibePro's authority model. Skills tell an agent how to operate, but Story, Architecture, Spec, current code, verification evidence, Agent Review records, and Gate DAG remain the readiness source of truth.

## Contract Surfaces

1. Bundled Skill files expose operational process:
   - frontmatter `name` and `description`
   - `When to Use`
   - workflow/process sections
   - `Common Rationalizations`
   - `Red Flags`
   - `Verification`
2. `vibepro skills lint` validates bundled skills before install or agent-harness checks.
3. Agent Review prompts include the same discipline as runtime instructions: reject common rationalizations, treat red flags as findings, and name inspected evidence.
4. `gate:definition_of_done` verifies that a source-changing PR has current-head verification evidence and cannot call itself done while required agent review remains unresolved.
5. `vibepro check agent-harness` reports skill contract drift alongside installed skill drift.

## Authority Boundary

The Skill Contract is behavioral guidance for agents. It cannot override:

- Story acceptance criteria
- Architecture boundaries
- Spec invariants
- current repository code
- recorded verification evidence
- Agent Review provenance and lifecycle requirements
- Gate DAG readiness

If a skill conflicts with those sources, the VibePro source of truth wins and the conflict should become a finding or gate issue.

## Gate Placement

`gate:definition_of_done` sits after `gate:review_inspection_required` and before `gate:artifact_consistency`. This keeps it late enough to see verification and review state, while still requiring stale-artifact repair before final PR readiness.

The gate is required for source or test changes. It is not required for docs-only changes. For required changes it checks:

- current-head passing verification evidence exists
- unresolved required Agent Review is not being bypassed
- changed behavior is not being approved only by common rationalizations

## Decision Quality

### Public Contract

- Alternatives considered: copy agent-skills directly, add persona routers, or implement a VibePro-native contract. The native contract is selected because it preserves VibePro's Gate and evidence model.
- Compatibility impact: existing Skill install/verify behavior remains. A new lint command and an additional PR DAG gate are additive.
- Rollback plan: remove the lint command, the prompt discipline block, and `gate:definition_of_done`. Existing installed skills and PR artifacts remain readable.
- Boundary: the contract improves agent behavior and review instructions; it does not replace verification evidence or review provenance.

### Scope Reviewability

- Boundary: this story touches bundled Skill structure, skills CLI, agent-harness scanner, Agent Review prompts, and PR Gate DAG completion semantics.
- Accepted followups: richer external Skill import/adaptation and per-skill runtime telemetry are deferred.
