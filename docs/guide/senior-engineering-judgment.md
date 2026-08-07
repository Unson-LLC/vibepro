# Senior Engineering Judgment

`vibepro judgment evaluate` turns senior engineering reasoning into an inspectable directed acyclic graph (DAG). It is advisory decision support: it helps choose what kind of work should happen next and records why, but it does not approve or merge a PR.

Use it when a change is material, hard to reverse, spans several components, or when the team needs to decide whether to add capability, simplify accumulated machinery, or validate an uncertain constraint first.

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

The internal fan-in only combines branches reached by this one evaluation. It is not a cross-PR merge coordinator and does not require parallel PRs to wait for one another.

## Development modes

| Mode | Selected when | Permitted option actions |
| --- | --- | --- |
| `VALUE` | A verified constraint is directly addressed and no stronger simplification or validation condition applies | `build`, `fix`, `delete`, `consolidate`, `redesign`, `retire` |
| `SIMPLIFY` | The proposed batch simplifies, or an adopted structural addition left the external outcome unchanged or worse | `delete`, `consolidate`, `redesign`, `retire` |
| `VALIDATE` | The constraint or outcome is still uncertain, or the proposal is explicitly a validation batch | `measure`, `experiment` |

There is no fixed "three additions" threshold. One adopted batch is one decision unit even if it contains several Stories developed in parallel. Parallel development can continue inside a batch; the next evaluation judges the batch from its observed external outcome.

## Run an evaluation

Initialize the repository, prepare an input file using schema `0.2.0`, and run:

```bash
vibepro init .
vibepro judgment evaluate . \
  --id story-example \
  --input judgment-input.json \
  --json
```

The input records:

- the goal, observations, contradictions, and current problem frame;
- a causal history boundary, adopted batches after that boundary, the current constraint, and the proposed batch;
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

## Authority boundary

Every result has `advisory: true` and `authority: human_ci_repository_rules`. The judgment DAG never emits `ready_for_pr_create`, `gate_status`, or `merge_allowed`, and it does not mutate verification, review status, or PR readiness. Humans, CI, and repository rules retain final authority.

This distinction keeps the current minimal-core promise intact: the feature is a transparent reasoning aid, not a restored Gate DAG.
