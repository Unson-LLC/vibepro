# One Change Through PR Preparation

Start after [initializing a repository](/guide/getting-started). The examples use `story-example` and `/path/to/repo`; replace them with your own values. These steps explain how to prepare review material, not an automatic approval pipeline.

## 1. Story

`init` registers a Story ID but does not write its Story document. With the default configuration, create `docs/management/stories/active/story-example.md` inside the target repository. Write the need and acceptance criteria, for example:

```markdown
# Filtered CSV export

Users need to export the same rows they are viewing after applying filters.

## Acceptance Criteria
- CSV export includes only rows matching the selected filters.
```

If you configured a different Story directory, use that directory instead. Then inspect the Story:

```bash
vibepro story diagnose /path/to/repo --id story-example
```

Use a Story to state the intended user outcome and acceptance criteria. For example: “CSV export includes only rows matching the selected filters.” The diagnosis is a review aid, not proof that the Story is correct. Graphify analysis is optional; add `--run-graphify` only when you want to use that integration.

## 2. Spec

```bash
vibepro spec write /path/to/repo --id story-example --draft --input /path/to/spec.json
```

A Spec carries expected behavior and its references. Create a JSON file before running the command above and replace `/path/to/spec.json` with its absolute path. Relative input paths resolve from the command's working directory, not the target repository. This small example refers to the first acceptance criterion in your Story; replace the ID, statement, and references with your actual change:

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-example",
  "clauses": [{
    "id": "INV-EXAMPLE-1",
    "type": "invariant",
    "statement": "CSV export includes only rows matching the selected filters.",
    "origin": {
      "story_refs": [{ "kind": "acceptance_criteria", "index": 0 }]
    }
  }]
}
```

This is a starting draft, not evidence of implementation or test coverage. Add references to your real code and tests as you implement the change. `--draft` explicitly saves a draft; it does not finalize the Spec.

Finalization is a separate path: `spec readiness` requires a registered Story, Graphify nodes and edges, a Story diagnosis, and readiness matching the current HEAD. Run `vibepro spec readiness /path/to/repo --id story-example --base origin/main`, inspect the result, and use `spec write --final` only after satisfying those conditions. Graphify is therefore optional for this draft-based walkthrough, but required by the current finalization checks.

**To include the Spec in the PR summary, you must finalize it.** `pr prepare` reads only the accepted `spec.json`; a draft alone appears as `no accepted spec found`. After preparing Graphify context and diagnosing the Story, use:

```bash
vibepro spec readiness /path/to/repo --id story-example --base origin/main
vibepro spec write /path/to/repo --id story-example --final --input /path/to/spec.json
vibepro spec show /path/to/repo --id story-example
```

Do not continue finalization if readiness reports missing prerequisites. See [Graphify Impact Context](/guide/graphify-impact) for that setup.

After writing a draft, open `.vibepro/spec/story-example/draft.json` in the target repository to inspect it. `spec show` reads the accepted `spec.json`, not the draft, so use it only after finalization.

Reference validation checks that declared files and supported anchors exist. It does not establish that the code satisfies the written behavior. Implement the change and maintain the references using your normal editor or coding agent.

## 3. Verification

```bash
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test
```

Replace `npm test` with the test command relevant to your change. `verify run` executes that command and records its result. A passing command is not proof of all acceptance criteria; inspect what the tests actually cover. `verify record` is available for evidence produced elsewhere; the source remains distinguishable.

## 4. Review and decisions

Prepare the review context, then actually inspect the Story, Spec, changed code, and test results. The following `pass` example is only appropriate after that review finds no issue. Replace the summary and inspection path with what you really checked; record `needs_changes` or `block` when there are concrete findings.

```bash
vibepro review prepare /path/to/repo --id story-example --role reviewer
vibepro review record /path/to/repo --id story-example --role reviewer \
  --status pass --summary "Reviewed the Story, Spec, and changed surface" \
  --inspection-input src/example.js
vibepro review status /path/to/repo --id story-example
vibepro decision status /path/to/repo --id story-example
```

These commands preserve a lightweight review record. Use decision records when a change requires an explicit choice; creating a separate decision is not an instruction to invent one for every change.

## 5. PR handoff

```bash
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

Inspect `.vibepro/pr/story-example/pr-prepare.json` and `pr-body.md` in the same directory. Check that the summary explains the intended behavior, relevant checks, and remaining unknowns before using it in your normal PR workflow. Story text, Spec, verification, and review records are not all required for this command to generate output; missing records are not completed work. Even with concrete `needs_changes` or `block` findings, `pr prepare` writes the blocking status and reasons to its summary and exits successfully. `pr create` does not create a PR from a blocked preparation and stops until the findings are resolved. Preparing this material does not mean the change is approved or safe to merge. `pr create` is an optional GitHub CLI handoff, not a safety certification.
