---
story_id: story-vibepro-code-topology-judgment-evidence
title: Code Topology Judgment Evidence Architecture
---

# Architecture

Code topology is an optional code-structure lens for Engineering Judgment. It describes adjacent code reality such as related files, symbols, routes, callers, callees, and risk hints. It does not describe product intent and it does not prove runtime correctness.

VibePro already has `graph_context` for Graphify artifact impact scope. This story adds a provider-neutral adjacent context, `code_topology_context`, populated from codebase-memory-mcp when the binary is available.

The integration is deliberately asymmetric:

- Missing codebase-memory-mcp is not a failure.
- Available code topology is useful because it can reveal related files, routes, symbols, and blast radius that changed-file names hide.
- Code topology evidence is advisory for first scan, axis activation, scope reviewability, and verification candidate discovery.
- Code topology evidence is not accepted as proof of runtime behavior, security correctness, rollback safety, UX correctness, or release readiness.

`pr prepare` builds `code_topology_context` once for the current changed files. The context is passed to Engineering Judgment classification and the common judgment spine. The same shape is also stored in `pr_context` for human auditability.

## Provider Boundary

The first provider is `codebase-memory-mcp` through its CLI interface:

```text
codebase-memory-mcp cli detect_changes {"repo_path": "<repo>"}
```

VibePro does not install, update, or configure the MCP. It only detects the command on `PATH`, runs a read-only query with a short timeout, normalizes best-effort fields, and records unavailable/error states.

## Evidence Mapping

`code_topology_context` contributes:

- `code_topology:related_files` to `scope_reviewability`
- `code_topology:routes` to `public_contract`
- `code_topology:call_paths` to `execution_topology`
- `code_topology:security` to `security_boundary`
- `code_topology:data_state` to `data_state`

The common judgment spine renders `code_topology_impact_scope` as optional supporting evidence. It never closes missing runtime, flow, negative-path, migration, or replay evidence.

## Freshness

The context records the current git head SHA when available. If the provider returns its own head or indexed freshness metadata in the future, VibePro can mark stale results as unavailable or advisory-only. The first implementation treats all normalized provider results as `binding_status=derived`.
