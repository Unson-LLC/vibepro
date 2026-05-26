---
title: "VibePro Check Packs Spec"
status: draft
created_at: 2026-05-16
updated_at: 2026-05-16
related_architecture:
  - ../architecture/vibepro-check-packs-architecture.md
related_stories:
  - story-vibepro-check-packs
---

# VibePro Check Packs Spec

## CLI

```bash
vibepro check list
vibepro check ui <repo> [--json]
vibepro check security <repo> [--json]
vibepro check oss-readiness <repo> [--json]
vibepro check performance <repo> [--measure] [--json]
vibepro check architecture <repo> [--json]
vibepro check pr-readiness <repo> --base <ref> [--story-id <id>] [--json]
vibepro check launch-readiness <repo> [--json]
vibepro check all <repo> [--json]
```

## Output

`--json` output:

```json
{
  "schema_version": "0.1.0",
  "run_id": "...",
  "pack_id": "security",
  "title": "Security boundary check",
  "status": "needs_review",
  "checks": [
    {
      "id": "api_boundary",
      "label": "API Boundary",
      "status": "needs_review",
      "summary": "3 routes; 1 risk hints"
    }
  ],
  "evidence": {}
}
```

## Pack Mapping

| Pack | Required Checks |
|------|-----------------|
| `ui` | `component_style`, `flow_design`, `terminal_link_contracts` |
| `security` | `static_site`, `api_boundary`, `code_quality` |
| `oss-readiness` | `oss_readiness` |
| `performance` | `database_access`, `local_dev`, `code_quality`; optional `performance_measurement` when `--measure` |
| `architecture` | `architecture_profile`, `code_quality`, `api_boundary`, `database_access` |
| `pr-readiness` | `pr_prepare`; requires `--base` or `--head` |
| `launch-readiness` | `static_site`, `api_boundary`, `component_style`, `flow_design`, `database_access`, `local_dev`, `code_quality` |
| `all` | all implemented static check groups |

## Acceptance Rules

- Unknown pack must fail with a message listing available packs
- `check list` must be non-mutating
- Each check run must write `check.json` and `check.md`
- Manifest must record latest check run by pack
- Pack status must aggregate child check status using: `fail > needs_setup > needs_review > pass`
- `performance --measure` may run commands/HTTP probes, but plain `performance` must remain static and safe
