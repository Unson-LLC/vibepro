# Impact Context Integrations

The following tools can help investigate code structure before PR preparation. Their connections to VibePro differ.

| Lens | How it is read | What it is good for | Boundary |
| --- | --- | --- | --- |
| Graphify | Run explicitly with `vibepro graph . --run-graphify` or import artifacts with `vibepro graph . --from <graphify-out>` | Existing graph artifacts, visual inspection, broad dependency reading | Not automatic and not bundled |
| codebase-memory-mcp | Use its external CLI or MCP tools manually after indexing | Related files, symbols, routes, call paths, changed-file blast radius | Optional external context; VibePro does not invoke it automatically or treat it as proof |

## Graphify

```bash
PATH="$HOME/.local/bin:$PATH" vibepro graph . --run-graphify
vibepro graph . --from graphify-out
```

Imported files are stored under:

```text
.vibepro/graphify/
  graph.json
  GRAPH_REPORT.md
  graph.html  (when supplied by Graphify)
```

## codebase-memory-mcp

`codebase-memory-mcp` is an optional external tool. VibePro does not invoke it from `pr prepare` or automatically write its results into `pr_context`. If it is available in your environment, index and query the repository manually, then use the returned files, symbols, routes, and call paths as context for human or AI review.

```bash
export PATH="$HOME/.local/bin:$PATH"
codebase-memory-mcp cli index_repository '{"repo_path":"'"$(pwd)"'"}'
# Run the provider's queries manually and inspect their results.
```

Do not use either lens as proof that the change works. Use them to decide which files, paths, tests, and reviewers matter.
