---
story_id: story-vibepro-workspace-status-derive-only
title: Derive-only Workspace Status Spec
parent_design: vibepro-workspace-status-derive-only
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        Checkout["Any repository checkout"] --> List["git worktree list --porcelain"]
        List --> Inspect["Inspect each linked worktree independently"]
        Inspect --> Bind["Compare pr-prepare artifact HEAD to worktree HEAD"]
        Bind --> Output["Human or JSON readiness output"]
        Canonical["Canonical worktree"] --> Health["Dirty and upstream health only"]
    rationale: The command derives repository-wide readiness without a persisted registry.
  - kind: threat_model
    mermaid: |
      flowchart LR
        Artifact["Untrusted local pr-prepare artifact"] --> Parse["Parse and validate exact HEAD binding"]
        Parse -->|current| Readiness["ready or blocked"]
        Parse -->|stale or malformed| Unknown["stale_artifact or unknown"]
        Missing["Missing or prunable worktree"] --> Unknown
        Command["workspace status"] --> ReadOnly["No fetch and no filesystem writes"]
    rationale: Local artifacts and missing paths fail closed without hiding other worktrees or mutating repository state.
---

# Spec

## Invariants

- `INV-WS-1`: The command never writes files or runs `git fetch`.
- `INV-WS-2`: `active_ready` requires both current readiness gates and exact
  artifact-HEAD equality with the containing worktree HEAD.
- `INV-WS-2A`: Canonical worktree artifacts are historical evidence and are not
  classified as active work; canonical contributes repository health only.
- `INV-WS-3`: Canonical dirty/upstream state is presentation metadata only and
  cannot alter another worktree's story classification.
- `INV-WS-4`: Unparseable legacy evidence remains visible as `unknown`; absence
  of evidence is not converted into a passing or blocked claim.
- `INV-WS-5`: The read-only workspace-status exemption is path- and
  content-scoped. An unresolved responsibility, a missing primary authority
  reference, or an unsupported authority kind remains a fail-closed authority
  error and is never hidden by the exemption.

## Scenarios

- `S-001`: Two linked worktrees with current ready artifacts are both returned
  as `active_ready` from either checkout.
- `S-002`: An artifact bound to an earlier HEAD is `stale_artifact`.
- `S-003`: A current artifact with unresolved gates is `active_blocked`.
- `S-004`: A worktree without artifacts and a malformed artifact are visible as
  `unknown` with distinct reasons.
- `S-005`: Dirty canonical state does not change a ready linked worktree result,
  and command execution creates no filesystem or Git-status delta.

## References

- Code: `src/workspace-status.js` (`collectWorkspaceStatus`)
- CLI: `src/cli.js` (`workspace status` dispatch)
- Tests: `test/workspace-status.test.js`
- Authority boundary tests: `test/responsibility-authority.test.js`
