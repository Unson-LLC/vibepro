---
name: vibepro-codebase-memory
description: Use when VibePro work needs codebase-memory-mcp impact context for changed files, call paths, routes, symbols, or risk hints without treating topology as correctness evidence.
---

# VibePro Codebase Memory

## Purpose

Use `codebase-memory-mcp` as an optional impact lens inside VibePro's Story / Gate DAG / PR evidence workflow. The tool helps identify related files, symbols, routes, call paths, and risk hints before deciding tests, review roles, and split boundaries. It is not product intent and it is not proof that a change works.

## When to Use

Use this Skill when a VibePro task involves broad source changes, `src/pr-manager.js`, Gate DAG behavior, Agent Review, evidence lifecycle, workflow orchestration, API routes, auth/security, data/state handling, release operations, or any change where the affected code path is not obvious from the diff alone.

Also use it when `vibepro pr prepare` reports `pr_context.code_topology_context.available=true`, when the user asks about `codebase-memory-mcp`, or when Graphify alone is too coarse for changed-file impact analysis.

Do not force it for tiny prose-only edits where no code path, reviewer scope, or test selection is in question. If the binary is missing or the repository is not indexed, record that as unavailable and continue with normal VibePro evidence.

## Operating Order

1. Confirm the current repository, branch, base ref, and Story ID.
2. Check provider availability:
   - `command -v codebase-memory-mcp`
   - `codebase-memory-mcp --version`
   - `codebase-memory-mcp cli list_projects '{}'`
3. If the current repository is missing from `list_projects`, index it before impact-sensitive work:
   - `codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'","mode":"moderate"}'`
4. For changed-file impact, prefer the same provider path VibePro uses:
   - Run `vibepro pr prepare <repo> --story-id <story-id> --base <base-ref>` after changes.
   - Read `.vibepro/pr/<story-id>/pr-prepare.json` `pr_context.code_topology_context`.
   - If direct exploration is needed before code changes, run `codebase-memory-mcp cli detect_changes '{"repo_path":"'"$(pwd)"'"}'`.
5. For symbol or path questions, use graph queries before broad file reads:
   - `search_graph` to discover exact function, class, route, or file names.
   - `trace_path` after exact names are known.
   - `get_code_snippet` for focused source inspection.
   - `query_graph` only when edge-level inspection is needed and the 200-row cap is acceptable.
6. Map the result back into VibePro:
   - Related files become investigation scope, not automatic diff scope.
   - `code_topology:*` signals may activate Engineering Judgment axes.
   - `code_topology_impact_scope` is optional supporting evidence in the common judgment spine.
   - Required verification still comes from tests, flow replay, artifact replay, current CI, or review evidence.
7. When `codebase-memory-mcp` changes the implementation plan, mention the concrete affected file, symbol, route, or call path in the task notes, PR preparation, or review prompt.
8. After implementation, rerun `vibepro pr prepare` so the final `code_topology_context` is bound to the current head and changed files.

## Common Rationalizations

- "codebase-memory-mcp is installed, so the impact analysis is done." Reject this; installation and indexing only make the provider available. The current `pr prepare` artifact must show whether changed files matched.
- "The topology says no related files, so no tests are needed." Reject this; absence of topology evidence is not evidence of no risk.
- "The call path is visible, so correctness is proven." Reject this; call path evidence narrows where to test but does not verify behavior.
- "Graphify and codebase-memory-mcp are duplicates." Reject this; Graphify is an explicit artifact lens, while codebase-memory-mcp is a changed-file topology provider that can return symbols, routes, call paths, and risk hints.
- "The provider failed, so VibePro is blocked." Reject this unless the Story explicitly makes topology evidence mandatory. Missing or failing codebase-memory-mcp is recorded as unavailable and normal Gate evidence still decides readiness.

## Red Flags

- `pr_context.code_topology_context.available=false` is presented as proof that there is no impact.
- `code_topology_impact_scope` is used to satisfy runtime, security, rollback, UX, or release-readiness evidence by itself.
- A risky workflow/auth/data/API change is implemented without checking either Graphify artifacts or codebase-memory impact context.
- Direct `grep` or full-file reading is used for broad structural exploration while an indexed codebase-memory project is available.
- The repository was reindexed on an unrelated checkout or stale branch, then used to justify current-head PR readiness.
- A review prompt cites "codebase-memory" without naming the concrete files, symbols, routes, call paths, or risk hints it found.

## Verification

Before saying codebase-memory informed the VibePro decision, cite the exact command or artifact inspected:

- `codebase-memory-mcp cli list_projects '{}'` shows the target repository is indexed.
- `codebase-memory-mcp cli detect_changes ...` returns changed-file impact, or `.vibepro/pr/<story-id>/pr-prepare.json` contains `pr_context.code_topology_context`.
- The cited context is bound to the current repository and current changed files.
- Required VibePro gates still use current verification evidence; topology context is supporting evidence only.

For VibePro repository changes, run `vibepro skills lint .` after editing bundled skills and run the targeted CLI test that covers `skills list/install/verify`.
