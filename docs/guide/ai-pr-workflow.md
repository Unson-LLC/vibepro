# AI PR Workflow

Run VibePro before the PR body becomes the only source of truth.

```bash
vibepro story list .
vibepro check pr-readiness . --story-id <story-id> --base main
vibepro pr prepare . --story-id <story-id> --summary-json
```

`pr prepare` collects:

- Story, Spec, and Architecture context.
- Changed files and risk surfaces.
- Graphify context when `.vibepro/graphify/graph.json` exists.
- `codebase-memory-mcp` topology context when the command is available and the repository is indexed.
- Verification, review, and decision records.
- Gate DAG and human-readable review artifacts.

The generated GitHub PR body should be a self-contained judgment brief: Story interpretation, origin, root cause, solution, review focus, and final verification first. Detailed evidence belongs in `.vibepro/pr/<story-id>/`, especially `pr-prepare.json`, `gate-dag.html`, `review-cockpit.html`, and `split-plan.html`.

When `gate_status` is ready, use `vibepro pr create`; after CI, use `verify import-ci`, refresh `pr prepare` / `pr create`, and finish with `vibepro execute merge`. See the [Control Loop](/guide/control-loop) for the complete sequence.

If `code_topology_context.available=false`, inspect the `reason`. It may simply mean the provider is not installed, the repository is clean, or no changed files matched the indexed project.

## Autopilot Preflight

`vibepro pr autopilot` runs a deterministic preflight phase before anything
else. Each registered recipe detects a known evidence-shape pitfall from
on-disk state (no network, no LLM) and either applies an `auto_fix` whose
artifacts are schema-identical to the manual commands operators previously
ran, or emits an exact `next_command` to run. Preflight never creates or
mutates gate verdicts, waivers, review lifecycles, or decision records.

The six initial recipes:

| Recipe | Action | Pitfall it closes |
|---|---|---|
| `verify-status-artifact` | auto_fix | A passing verify record without a durable status artifact stays `supporting`; the generated status JSON promotes it to `strong` |
| `generic-token-clause-binding` | next_command | Generic-token records (e.g. `unit_regression`) only match when the record text binds a contract clause ID |
| `architecture-reason-frontmatter` | next_command | The architecture gate's ADR-not-needed declaration lives in the story frontmatter `reason:` key |
| `followup-decision-artifact` | next_command | Followup decisions need both `--reason` and `--artifact` to count as accepted |
| `design-diagrams-final-spec` | next_command | Required diagrams are read only from the final spec's `diagrams[]`, not spec doc sections |
| `story-catalog-registration` | auto_fix | Hand-written stories resolve in `story diagnose` only after registration in `.vibepro/config.json` `brainbase.stories[]` |

Results appear in the autopilot report's machine-readable
`preflight.results[]` (recipe_id, detected, action, action_taken, artifacts,
next_command) and in the `## Preflight` section of the default CLI output,
where each detected recipe renders as a bullet with its reason and an
indented `next:` command line. In `--dry-run` mode auto-fixes report
`planned` and write nothing. A recipe failure reports `action_taken:
"failed"` and never aborts the run.
