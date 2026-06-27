# Version History

The authoritative package version is `package.json`. This page summarizes manual-visible changes.

## Current Package Version

| Item | Value |
| --- | --- |
| `package.json` | `0.1.0-beta.0` |
| Check | `vibepro version` or `vibepro --version` |

## Manual Updates After `0.1.0-beta.0`

- Restored the VitePress manual source under `docs/` so the Cloudflare Pages site can be rebuilt from `main`.
- Documented optional `codebase-memory-mcp` topology support for `vibepro pr prepare`.
- Clarified that Graphify and code topology are optional impact lenses, not correctness gates.
- Added `pr_context.code_topology_context` and `code_topology_impact_scope` to the artifact map.

## Initial Public Preparation

`0.1.0-alpha.0` introduced the OSS-ready package shape, phase checkpoints, Story/Spec review flow, and public discovery documentation.
