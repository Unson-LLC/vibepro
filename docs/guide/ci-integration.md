# CI Integration

This URL is retained for older links. The former `vibepro gate check` and Gate DAG CI workflow are retired from the minimal core; do not add them to a new pipeline.

For a current repository, let its own CI run the checks appropriate to the change. VibePro can record the result and prepare context for ordinary PR review:

```bash
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
vibepro pr prepare /path/to/repo --story-id story-example --base main --json
```

Use `vibepro verify record` when the result was produced by an external CI system. Inspect the generated `.vibepro/pr/<story-id>/pr-prepare.json` and `pr-body.md`; they are a handoff summary, not a CI gate, safety certification, or merge decision.

Continue with the repository's normal GitHub workflow and authorized human review. See the [Feature Map](/guide/feature-map) and [Control Loop](/guide/control-loop) for the current product surface.
