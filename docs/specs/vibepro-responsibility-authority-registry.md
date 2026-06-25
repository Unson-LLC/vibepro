---
title: VibePro Responsibility Authority Registry Spec
status: draft
created_at: 2026-06-25
updated_at: 2026-06-25
related_stories:
  - story-vibepro-responsibility-authority-registry
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        A["PR diff touches responsibility surface"] --> B["Responsibility resolver"]
        B --> C{"Registered authority?"}
        C -->|yes| D["Domain Contract / Architecture / Spec authority"]
        C -->|no| E["no_registered_authority finding"]
        D --> F{"Current-head evidence bound?"}
        F -->|yes| G["contract gate can pass"]
        F -->|no| H["needs_evidence blocks readiness"]
        E --> I["review or waiver required"]
        H --> I
    rationale: Responsibility authority resolution affects permission, state, worker, and side-effect contracts; missing or invented authority is the threat being modeled.
---

# VibePro Responsibility Authority Registry Spec

## Invariants

- `RAR-INV-001`: For any changed responsibility surface, VibePro MUST either resolve a registered authority or emit `no_registered_authority`. It MUST NOT silently infer a primary authority from keyword matches alone.
- `RAR-INV-002`: Gate DAG readiness remains derived from evidence and gate status. The registry supplies authority references; it does not mark readiness by itself.
- `RAR-INV-003`: Domain Contract clauses MUST be machine-readable and stable enough to be referenced by Gate DAG nodes, PR body, traceability, and tests.
- `RAR-INV-004`: Current-head evidence is required for matched blocking contracts. Evidence from old branches, stale artifacts, or generic test passes MUST NOT satisfy a contract clause.
- `RAR-INV-005`: Story-local Spec may add or refine behavior, but it MUST NOT override an existing Domain Contract without an explicit Architecture/decision update.
- `RAR-INV-006`: Missing Graphify context MUST NOT block by itself; path/symbol/risk-surface matching still produces best-effort authority resolution.

## Contracts

- `RAR-CONTRACT-001`: A registry entry MUST include `id`, `primary_authority`, `owned_surfaces`, `required_evidence`, and `unknown_policy`.
- `RAR-CONTRACT-002`: `primary_authority` MUST reference one of `domain_contract`, `architecture`, `spec`, `policy`, or `story`.
- `RAR-CONTRACT-003`: `owned_surfaces` MUST support path patterns and SHOULD support symbols when available.
- `RAR-CONTRACT-004`: A Domain Contract clause MUST include stable `id`, `domain`, `statement`, `applies_to`, `forbidden_patterns` or `allowed_state_matrix` when relevant, and `evidence_requirements`.
- `RAR-CONTRACT-005`: `pr prepare` MUST include matched responsibilities and contract clauses in machine-readable artifacts.
- `RAR-CONTRACT-006`: `requirements-ssot` MUST include resolved responsibility authority in its review context when any matched responsibility exists.
- `RAR-CONTRACT-007`: VibePro MUST register its own `gate:responsibility_authority` orchestration as a Domain Contract so changes to the resolver, PR Gate DAG placement, or execute-state blocker classification are covered by the same mechanism.

## Scenarios

- `RAR-S-001`: Given a PR changes a cleanup/recovery file and a registry entry owns that path, when `pr prepare` runs, then Gate DAG includes a responsibility authority gate for the matched contract.
- `RAR-S-002`: Given a matched Domain Contract has no current-head evidence, when readiness is calculated, then the PR is not `ready_for_review`.
- `RAR-S-003`: Given a matched Domain Contract has current-head unit and replay evidence bound to its clause IDs, when readiness is calculated, then the responsibility authority gate can pass.
- `RAR-S-004`: Given a changed state/status surface has no registry entry, when `pr prepare` runs, then PR artifacts show `no_registered_authority` rather than treating Story-local text as sufficient authority.
- `RAR-S-005`: Given a Story-local Regression Guard protects a cross-story invariant, when it is promoted, then VibePro writes or proposes a Domain Contract clause with stable clause ID and evidence requirements.
- `RAR-S-006`: Given Story Spec contradicts an existing Domain Contract, when Requirement Gate runs, then the contradiction is visible and PR readiness requires an Architecture/decision update or explicit waiver.
- `RAR-S-007`: Given a workflow-heavy PR changes Responsibility Authority Gate DAG placement or execute-state blocker classification, when `pr prepare` evaluates readiness, then current E2E replay evidence must show the flow transition from path/surface discovery through `gate:responsibility_authority` to Requirement Gate and through execute-state blocker reporting.

## Anti-patterns

- `RAR-AP-001`: A single free-form global design document is treated as the only source of truth for every responsibility.
- `RAR-AP-002`: Keyword matching picks a primary authority without surfacing confidence, evidence, or unknown status.
- `RAR-AP-003`: Generic `npm test` success satisfies a specific contract clause without clause-specific binding.
- `RAR-AP-004`: Regression Guard remains natural language only, so future changes cannot trigger required verification.
- `RAR-AP-005`: Graphify absence is reported as quiet success instead of a lower-confidence authority resolution.

## Verification

- `RAR-V-001`: Unit tests cover registry parsing, required fields, and stable clause IDs.
- `RAR-V-002`: Unit tests cover changed path/symbol matching from PR diff to responsibility entries.
- `RAR-V-003`: PR prepare tests cover `gate:responsibility_authority` status for matched contract with missing evidence, current-head evidence, stale evidence, and no registered authority.
- `RAR-V-004`: Requirement Gate tests cover Story Spec versus Domain Contract contradiction.
- `RAR-V-005`: Traceability tests cover contract clause IDs appearing in PR artifacts and evidence binding.
- `RAR-V-006`: A SalesTailor STR-121-style fixture covers cleanup/recovery touching a protected pending-production-start state contract.
- `RAR-V-007`: E2E replay evidence covers the Responsibility Authority workflow state transition, artifact replay, and scenario-clause observation markers expected by workflow-heavy PR readiness.

## Non-goals

- Implementing every domain contract in the first slice.
- Replacing human Architecture review.
- Making Graphify a hard runtime dependency.
- Automatically deleting or rewriting Story-local Regression Guards.
