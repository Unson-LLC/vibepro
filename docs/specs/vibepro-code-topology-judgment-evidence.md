---
story_id: story-vibepro-code-topology-judgment-evidence
title: Code Topology Judgment Evidence Spec
parent_design: vibepro-code-topology-judgment-evidence
diagrams:
  - kind: flow
    mermaid: |
      flowchart TD
        Prepare["pr prepare"] --> Provider["best-effort codebase-memory-mcp query"]
        Provider --> Context["code_topology_context"]
        Context --> Axes["Engineering Judgment axis activation"]
        Context --> Spine["Common judgment spine optional evidence"]
        Axes --> Gate["Gate DAG"]
        Spine --> Gate
        Gate --> PR["PR readiness decision"]
---

# Spec

## Invariants

- `CTJ-INV-1`: `vibepro pr prepare` MUST expose `pr_context.code_topology_context`.
- `CTJ-INV-2`: Missing, unavailable, or failing codebase-memory-mcp MUST NOT block PR readiness by itself.
- `CTJ-INV-3`: Existing `pr_context.graph_context` and `graph_impact_scope` behavior MUST remain backward compatible.
- `CTJ-INV-4`: `code_topology_impact_scope` MUST be supporting evidence only and MUST NOT satisfy required runtime, security, rollback, UX, or release-readiness evidence by itself.

## Contracts

- `CTJ-CONTRACT-1`: `code_topology_context` MUST include `available`, `provider`, `reason`, `matched_file_count`, `related_file_count`, `symbol_count`, `route_count`, `call_path_count`, `risk_count`, `investigation_files`, `impact_by_file`, and `signals`.
- `CTJ-CONTRACT-2`: When code topology is available and maps to the current changed files, Engineering Judgment axis activation MUST consider its signals as non-text corroboration.
- `CTJ-CONTRACT-3`: `gate:common_judgment_spine.subchecks[]` MUST include `code_topology_impact_scope` as optional matched evidence for impact-sensitive subchecks when code topology has matched files.
- `CTJ-CONTRACT-4`: Provider execution MUST be best-effort and read-only; VibePro MUST NOT install or configure codebase-memory-mcp during `pr prepare`.

## Scenarios

- `CTJ-S-1`: Given `codebase-memory-mcp` is not on `PATH`, when `pr prepare` runs, then `pr_context.code_topology_context.available=false` and Engineering Judgment continues.
- `CTJ-S-2`: Given a provider result contains related files, routes, call paths, and risk hints for changed files, when `pr prepare` runs, then `code_topology_impact_scope` appears as optional evidence and relevant axes receive `code_topology:*` activation candidates.
- `CTJ-S-3`: Given code topology evidence is present but no current verification exists for a high-risk runtime/workflow change, when the common judgment spine evaluates required evidence, then required runtime or flow evidence remains missing.

## Anti-patterns

- `CTJ-AP-1`: Do not make codebase-memory-mcp a package dependency or bundled binary in this story.
- `CTJ-AP-2`: Do not treat code topology as product intent.
- `CTJ-AP-3`: Do not treat code topology as a correctness proof.
- `CTJ-AP-4`: Do not remove Graphify support or rename existing `graph_context` fields.

## Verification

- `CTJ-V-1`: Regression tests cover unavailable provider behavior.
- `CTJ-V-2`: Regression tests cover available provider normalization, axis activation, and optional spine evidence.
- `CTJ-V-3`: Focused tests use clause IDs in test names.
