# Impact Context Integrations

VibePro can read optional code-structure context before PR preparation. The two supported lenses have different roles.

| Lens | How it is read | What it is good for | Boundary |
| --- | --- | --- | --- |
| Graphify | Run explicitly with `vibepro graph . --run-graphify` or import artifacts with `vibepro graph . --from <graphify-out>` | Existing graph artifacts, visual inspection, broad dependency reading | Not automatic and not bundled |
| codebase-memory-mcp | Read automatically by `vibepro pr prepare` when `codebase-memory-mcp` is on `PATH` | Related files, symbols, routes, call paths, changed-file blast radius | Optional and never a correctness proof |

## Graphify

```bash
PATH="$HOME/.local/bin:$PATH" vibepro graph . --run-graphify
vibepro graph . --from graphify-out
```

Imported files are stored under:

```text
.vibepro/graphify/
  graph.json
  graph.html
  GRAPH_REPORT.md
```

## codebase-memory-mcp

After installation and indexing, `pr prepare` runs a read-only `detect_changes` query and records the normalized result in `pr_context.code_topology_context`.

```bash
export PATH="$HOME/.local/bin:$PATH"
codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'"}'
vibepro pr prepare . --id <story-id>
```

VibePro passes both `repo_path` and the derived project name to the provider for compatibility with current `codebase-memory-mcp` CLI behavior.

The normalized context includes availability, reason, matched files, related files, symbols, routes, call paths, risk hints, investigation files, and `code_topology:*` signals. When matched files exist, VibePro may render `code_topology_impact_scope` as optional matched evidence in the common judgment spine.

Install bundled VibePro skills if agents should use this context consistently:

```bash
vibepro skills install .
```

The `vibepro-codebase-memory` skill explains when to use `list_projects`, `index_repository`, `detect_changes`, `search_graph`, `trace_path`, and `get_code_snippet`, and how to map results back to VibePro Gate evidence.

Do not use either lens as proof that the change works. Use them to decide which files, paths, tests, and reviewers matter.
