# Senior Engineering Judgment

`vibepro judgment evaluate` turns senior engineering reasoning into an inspectable directed acyclic graph (DAG). It is advisory decision support: it helps choose what kind of work should happen next and records why, but it does not approve or merge a PR.

Use it when a change is material, hard to reverse, spans several components, or when the team needs to decide whether to add capability, simplify accumulated machinery, or validate an uncertain constraint first.

## Frame the questions and gather evidence first

Before evaluation, the team may still need to discover what must be decided. `judgment investigate` prepares a `model_request` for the AI host from the request's goal, scope, and constraints, supporting questions, options, and recommendations that can be revised through investigation. Skip this optional investigation when observations are already sufficient.

```text
Request and expected outcome
  -> AI host frames questions, hypotheses, and evidence needs
  -> Inspect existing Graphify artifacts, source, and other evidence
  -> Reinterpret questions, options, and recommendations with new evidence
  -> Carry candidates into an input draft with prepare --investigation
  -> Explicit adoption -> evaluate -> next checks and Story planning
```

This is not a fixed one-way sequence: inspecting structure first can change the questions. Newly acquired evidence invalidates earlier interpretations and recommendations and requires reinterpretation. Missing information is not treated as absence; it remains `unknown`, `partial`, or `unavailable`.

Eight expert nodes cover outcome and scope, human/AI responsibility, change ownership, information sharing, execution and dependencies, structural simplification, runtime reachability, and the value of the next check. They contribute premises, candidates, and unresolved issues without replacing the existing development modes or adoption authority. See the [expert judgment DAG details (Japanese)](/guide/expert-judgment-nodes) for the nodes and a two-round example.

### AI-host and CLI responsibilities

- The AI host interprets evidence and creates questions, hypotheses, options, and recommendations, then supplies its response to the CLI.
- The CLI reads explicitly supplied existing Graphify artifacts and bounded source excerpts, validates response schemas and reference consistency, and retains the state needed for reconsideration.
- The CLI does not autonomously call models, generate Graphify artifacts, fetch evidence through external connectors, or execute commands. Graph edges are structural candidates, not proof of matching contracts, runtime success, or user value.
- People, CI, and repository rules retain adoption and execution authority. Even `candidate_ready` remains `advisory: true` / `blocking: false`, not adopted or ready to execute.

### Connect investigation to evaluation

Provide `case_id`, `goal`, `scope.files`, and `constraints` in `raw-goal.json`. To connect a Story, make `case_id` match the Story ID. The detail page above provides the input format.

```bash
vibepro judgment investigate . --input raw-goal.json --json > round-1.json
# The AI host reads model_request and its response schema, then responds using actual evidence.
vibepro judgment investigate . --input round-1.json --response model-response.json --json > round-2.json
# After any necessary investigation and reinterpretation, supply the latest result.
vibepro judgment prepare . --id story-example --investigation round-2.json --json
```

`prepare` only attaches candidates and unresolved questions to an input draft. Read its `artifact`, inspect the problem frame, observations, and options, then explicitly adopt with `judgment input adopt`. Pass the returned `adoption.adopted_input` to `evaluate`. Attaching investigation results does not adopt, execute, or merge anything.

For observations that are already organized, `judgment suggest` provides standalone advice and `judgment prepare --expert-input` provides optional integration. Expert nodes remain `proposed`; unresolved issues become next-check candidates such as `review_expert_judgment`.

## Decision order

Every evaluation follows the same top-level order:

1. Fix the goal and observable success criteria.
2. Inspect adopted development batches since the latest verified external outcome or simplification baseline.
3. Record contradictions and validate the problem frame.
4. Select one development mode: `VALUE`, `SIMPLIFY`, or `VALIDATE`.
5. Set the decision depth from materiality, reversibility, blast radius, and contradictions.
6. Traverse only the relevant engineering axes and test hypotheses against current evidence.
7. Prune options that conflict with the selected mode or an invariant.
8. Produce an advisory recommendation, unknowns, and next actions.

When expert input is present, the embedded observations are evaluated again on every `evaluate` run. The result adds expert judgment and `review_expert_judgment` next-action candidates while leaving the existing development mode, recommendation, and authority contract unchanged.

The internal fan-in only combines branches reached by this one evaluation. It is not a cross-PR merge coordinator and does not require parallel PRs to wait for one another.

## Development modes

| Mode | Selected when | Permitted option actions |
| --- | --- | --- |
| `VALUE` | A value constraint is verified, decision evidence is sufficient, and no adopted history overrides the mode | `build`, `fix`, `delete`, `consolidate`, `redesign`, `retire` |
| `SIMPLIFY` | Structural excess is verified with sufficient decision evidence, or adopted structural growth left the external outcome unchanged or worse | `delete`, `consolidate`, `redesign`, `retire` |
| `VALIDATE` | The problem, outcome, or evidence needed to select an intervention is not sufficiently established | `measure`, `experiment` |

There is no fixed "three additions" threshold. One adopted batch is one decision unit even if it contains several Stories developed in parallel. Parallel development can continue inside a batch; the next evaluation judges the batch from its observed external outcome.

The current constraint separates three questions: whether the problem is verified (`status`), whether it is a value constraint or structural excess (`kind`), and whether the evidence is sufficient to choose an intervention (`decision_evidence.status`). A verified problem does not automatically mean the solution direction is known.

Mode selection never reads proposal labels such as `change_kind` or `directly_addresses_constraint`. If present, those fields are inert metadata. Candidate actions are considered only after the mode has been selected.

## Run an evaluation

Initialize the repository and prepare an input file using schema `0.3.0`. The expert input is optional. When supplied, its `case_id` must exactly equal the Story ID passed to `--id`.

```bash
vibepro init .
vibepro judgment prepare . --id story-example --expert-input observations.json --json
vibepro judgment input adopt . \
  --id story-example \
  --input .vibepro/reviews/story-example/senior-judgment/input-draft.json \
  --reviewed-by <actor> \
  --authority <source> \
  --summary "Reviewed expert observations" \
  --json
vibepro judgment evaluate . \
  --id story-example \
  --input .vibepro/reviews/story-example/senior-judgment/input-draft.json \
  --json
```

The paths above illustrate the default layout. Use the actual `artifact` from `prepare` and pass `adoption.adopted_input` returned by `input adopt` to `evaluate`. Review the problem frame, options, and expert observations before adoption. Preparation alone leaves the problem frame unconfirmed; adding observations does not make the plan executable.

`prepare` includes an `expert_judgment` preview and embeds observations in `input.expert_input`. Adoption includes those input bytes. Evaluation recomputes expert judgment from the adopted observations and includes it in the result and development DAG.

The input records:

- the goal, observations, contradictions, and current problem frame;
- a causal history boundary, adopted batches after that boundary, the current constraint kind and decision evidence, and the proposed batch;
- materiality, reversibility, and blast radius;
- all nine standard axes: `public_contract`, `rollback_sensitive`, `security_boundary`, `data_state`, `execution_topology`, `ux_surface`, `performance_semantic`, `scope_reviewability`, and `release_ops`;
- hypotheses, predictions, current evidence, constraints, and candidate options.

Mark an irrelevant standard axis as `inactive` and explain why. Active axes use explicit predictions and current evidence to distinguish a confirmed risk, a refuted hypothesis, and an inconclusive branch.

## Results and revisions

The command writes the current projection and immutable run history below:

```text
.vibepro/reviews/<story-id>/senior-judgment.json
.vibepro/reviews/<story-id>/senior-judgment.md
.vibepro/reviews/<story-id>/senior-judgment/runs/<run-id>.json
.vibepro/reviews/<story-id>/senior-judgment/runs/<run-id>.md
```

When new evidence changes the decision, use a new `run_id` and reference the previous run with `parent_run_id`. VibePro preserves the earlier run and reports the decision delta.

When expert judgment is present, the result retains `expert_judgment` and adds eight `expert:<node-id>` nodes and their dependencies to the development DAG. All remain `proposed`; conditional branches are not adopted decisions. `review_expert_judgment` next actions can enter Story planning as checks to consider, not execution permission or completion verdicts.

Preparation without `--expert-input` and older adopted inputs without `expert_input` remain compatible. Without this integration, the existing mode, recommendation, and authority results remain unchanged.

## Authority boundary

Every result has `advisory: true` and `authority: human_ci_repository_rules`. The judgment DAG never emits `ready_for_pr_create`, `gate_status`, or `merge_allowed`, and it does not mutate verification, review status, or PR readiness. Humans, CI, and repository rules retain final authority.

Expert nodes inherit this boundary as `proposed` candidates. They do not replace the `VALUE` / `SIMPLIFY` / `VALIDATE` mode, senior recommendation, or adoption authority.

This distinction keeps the current minimal-core promise intact: the feature is a transparent reasoning aid, not a restored Gate DAG.
