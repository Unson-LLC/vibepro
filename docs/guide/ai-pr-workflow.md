# AI PR Workflow

Use VibePro to keep the reason for a change visible while an AI agent works. It prepares review material for the normal Git workflow; it does not approve or merge code.

## Suggested flow

Initialize the workspace and write the Story document first, as described in [One Change Through PR Preparation](/guide/control-loop). The commands below are an outline, not a script to run without authoring the inputs and performing the review.

```bash
vibepro story list /path/to/repo
vibepro story diagnose /path/to/repo --id story-example
vibepro spec write /path/to/repo --id story-example --draft --input /path/to/spec.json
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
vibepro review prepare /path/to/repo --id story-example --role reviewer
vibepro pr prepare /path/to/repo --story-id story-example --base main --json
```

The draft Spec in this outline is not included by `pr prepare`. To include it, satisfy Graphify, Story diagnosis, and readiness prerequisites and write an accepted Spec with `spec write --final`, following the [full workflow](/guide/control-loop). Likewise, `review prepare` does not perform a review; inspect the change and record the actual findings.

The flow keeps these boundaries explicit:

- **Story** records why the change exists and the intended outcome.
- **Spec** records testable behavior and references to the relevant files.
- **Verification** records a command that was actually run, or an external result recorded with `verify record`.
- **Review** records what a human or reviewer agent inspected and any findings.
- **PR preparation** writes a summary and body under `.vibepro/pr/<story-id>/` for handoff.

`pr prepare` can summarize partial evidence; its successful output is not proof that the work is complete, correct, safe to merge, or approved. Reference checks establish that declared files and supported anchors exist, not that the implementation satisfies the behavior. Optional Graphify or code-topology context can narrow what to inspect, but it is not correctness proof.

After reading `pr-prepare.json` and `pr-body.md`, use the repository's ordinary GitHub workflow: inspect the diff, push the branch, open or update the PR, and have the authorized humans review and merge it. `vibepro pr create` is an optional GitHub CLI handoff; VibePro remains outside merge authority.

For the complete command sequence, see the [Control Loop](/guide/control-loop). For the current feature boundary, see the [Feature Map](/guide/feature-map).
