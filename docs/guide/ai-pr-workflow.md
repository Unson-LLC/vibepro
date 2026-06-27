# AI PR Workflow

Run VibePro before the PR body becomes the only source of truth.

```bash
vibepro story list .
vibepro check pr-readiness . --story-id <story-id> --base main
vibepro pr prepare . --id <story-id>
```

`pr prepare` collects:

- Story, Spec, and Architecture context.
- Changed files and risk surfaces.
- Graphify context when `.vibepro/graphify/graph.json` exists.
- `codebase-memory-mcp` topology context when the command is available and the repository is indexed.
- Verification, review, and decision records.
- Gate DAG and human-readable review artifacts.

The generated GitHub PR body should stay concise. Detailed evidence belongs in `.vibepro/pr/<story-id>/`, especially `pr-prepare.json`, `gate-dag.html`, `review-cockpit.html`, and `split-plan.html`.

If `code_topology_context.available=false`, inspect the `reason`. It may simply mean the provider is not installed, the repository is clean, or no changed files matched the indexed project.
