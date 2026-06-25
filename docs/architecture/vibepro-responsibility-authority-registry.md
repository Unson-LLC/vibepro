---
title: VibePro Responsibility Authority Registry Architecture
status: draft
created_at: 2026-06-25
updated_at: 2026-06-25
related_stories:
  - story-vibepro-responsibility-authority-registry
---

# VibePro Responsibility Authority Registry Architecture

## Decision

Add a Responsibility Authority Registry as the repo-level index for design authority. The registry answers: for this responsibility, which Story, Architecture, Spec, Policy, or Domain Contract is authoritative, which code surfaces it owns, and what current-head evidence is required.

This is not a single global design document. A single document would become stale and would still require humans to infer which clause applies. VibePro needs a machine-readable registry that can project relevant authority into the Gate DAG for the current PR.

## Authority Model

VibePro keeps the existing authority stack:

- Story: user value and intended change scope
- Architecture: boundaries, ownership, and compatibility decisions
- Spec: Story-local behavior, invariants, scenarios, anti-patterns, and verification
- current code: observed implementation reality
- verification evidence: current-head proof
- Agent Review records: inspected review provenance
- Gate DAG: readiness decision projection

The new layer adds:

- Responsibility Authority Registry: maps a responsibility ID to primary authority, supporting authority, owned surfaces, and required evidence.
- Domain Contract: machine-readable contract clauses for cross-story invariants such as state transitions, cleanup/recovery, worker behavior, permissions, billing, and sending.
- VibePro self-contract: `responsibility-authority.json` registers `vibepro.gate_dag.responsibility_authority`, and `docs/contracts/vibepro-responsibility-authority.json` defines the Gate DAG placement and execute-state blocker behavior for this feature itself.

Gate DAG remains the readiness projection. It is not the contract source of truth.

## Data Flow

```text
Story / PR diff / changed files / symbols / Graphify context
        |
        v
responsibility resolver
        |
        v
Responsibility Authority Registry
        |                  \
        |                   -> no_registered_authority finding
        v
Domain Contract clauses
        |
        v
current-head evidence binding
        |
        v
Gate DAG contract nodes
        |
        v
PR body / review cockpit / pr-prepare.json
```

## Registry Shape

The registry should support entries like:

```yaml
id: generation.cleanup.cancellation_policy
primary_authority:
  kind: domain_contract
  ref: contracts/generation-state.yaml#GEN-STATE-001
supporting_authority:
  - docs/architecture/generation-workflow.md
  - docs/specs/form-production-generation.md
owned_surfaces:
  symbols:
    - GenerationTask.status
    - metadata.awaitingProductionGenerationStart
    - formSubmissionPhase
  paths:
    - "**/cleanup*"
    - "**/recovery*"
    - "**/workers/**"
required_evidence:
  - unit_regression
  - cleanup_recovery_replay
  - current_head_verification
unknown_policy: block_or_review
```

## Gate Placement

`gate:responsibility_authority` should sit after path/surface discovery and before Requirement Gate. Requirement Gate then receives both Story-local sources and resolved cross-story authority.

The gate should report:

- matched responsibilities
- matched Domain Contract clauses
- missing current-head evidence
- stale evidence
- unknown or unregistered responsibilities
- non-applicability reasons

For high-risk surfaces such as state transitions, cleanup/recovery, queue workers, permissions, billing, or outbound sends, missing authority or missing evidence should block PR readiness unless an explicit waiver/decision record is present.

The VibePro-native placement is:

```text
gate:path_surface_matrix -> gate:journey_context? -> gate:responsibility_authority -> gate:requirement
```

`execute state` reads standalone Gate DAG artifacts as well, so it must include `responsibility_authority_gate` in unresolved-gate and critical-blocker classification.

## Relationship To Existing Systems

`requirements-ssot` remains the lane for Story / Spec / Architecture / Policy consistency. It should consume resolved responsibility authorities rather than trying to infer all cross-story contracts from documents each time.

Engineering Judgment axes remain risk classification and evidence selection. The registry gives those axes concrete authority and clause references.

Regression Guard becomes promotable. A Story-local regression guard can become a Domain Contract clause when the same invariant must survive future unrelated Stories.

Design System is the closest existing precedent: VibePro-native DS artifacts are authority; external DESIGN.md or generated visuals are reference evidence. Responsibility Authority Registry follows the same boundary: registry and domain contracts are authoritative; free-form design notes are supporting evidence.

## Failure Modes

- If a responsibility has no registry entry, VibePro must not invent an authority. It emits `no_registered_authority`.
- If a Domain Contract exists but no current-head evidence is bound, the contract gate is `needs_evidence`.
- If evidence exists for a different HEAD, branch, or stale artifact, the contract gate is `stale`.
- If Story-local Spec conflicts with a Domain Contract, the gate reports a contradiction and requires an explicit Architecture or decision update.

## Non-Goals

- Do not replace Story, Architecture, or Spec documents.
- Do not make Graphify mandatory.
- Do not require every repo to model every responsibility before first use.
- Do not treat Markdown-only global design docs as sufficient machine authority.
- Do not automatically promote every Regression Guard into a global contract.
