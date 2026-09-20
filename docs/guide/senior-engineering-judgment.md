# Senior Engineering Judgment

`vibepro judgment evaluate` turns senior engineering reasoning into an inspectable directed acyclic graph (DAG). It is advisory decision support: it helps choose what kind of work should happen next and records why, but it does not approve or merge a PR.

Use it when a change is material, hard to reverse, spans several components, or when the team needs to decide whether to add capability, simplify accumulated machinery, or validate an uncertain constraint first.

観測から仮説や選択肢を作る初期段階には、[`専門判断ノード`](./expert-judgment-nodes.md)を任意の入力として `judgment prepare --expert-input` から取り込めます。`judgment suggest` による単独実行も残ります。Storyへ接続した専門判断は `prepare` のプレビューと `evaluate` の結果に現れますが、候補を自動採用しません。

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
  --summary "専門観測を確認した" \
  --json
vibepro judgment evaluate . \
  --id story-example \
  --input .vibepro/reviews/story-example/senior-judgment/input-draft.json \
  --json
```

上のパスは標準配置の例です。実際には `prepare` の `artifact` を使い、`evaluate` には `input adopt` が返す `adoption.adopted_input` を指定します。採択前に問題設定・選択肢と専門観測を確認してください。`prepare` だけでは問題設定は未確定のままで、専門観測を加えても自動で計画の実行可能状態にはなりません。

`prepare` の結果には `expert_judgment` のプレビューが含まれ、入力ドラフトの `input.expert_input` に観測が埋め込まれます。`input adopt` はこの埋め込みを含む入力バイト列を既存手順で採択します。`evaluate` は採択済みの埋め込み観測から専門判断を再評価し、結果と development DAGへ反映します。

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

専門判断を含む場合、`expert_judgment` はsenior judgmentの結果とprojectionに保持され、development DAGには `expert:<node-id>` の8ノードと依存関係が追加されます。専門ノードの状態はすべて `proposed` で、条件付きの分岐を採択済みとは扱いません。`next_actions` の `review_expert_judgment` は、人が次の作業で確認する候補です。運用上のStory planにも確認候補として渡りますが、実行許可や完了判定にはなりません。

`--expert-input` を付けない `prepare` と、`expert_input` を持たない従来の採択入力は従来互換です。専門判断の接続がない場合、既存のmode・推奨・権限の結果だけが生成されます。

## Authority boundary

Every result has `advisory: true` and `authority: human_ci_repository_rules`. The judgment DAG never emits `ready_for_pr_create`, `gate_status`, or `merge_allowed`, and it does not mutate verification, review status, or PR readiness. Humans, CI, and repository rules retain final authority.

専門判断ノードもこの境界を継承し、`proposed` の候補として記録されます。`VALUE` / `SIMPLIFY` / `VALIDATE` のmode、seniorの推奨、採択権限を専門判断が変更することはありません。

This distinction keeps the current minimal-core promise intact: the feature is a transparent reasoning aid, not a restored Gate DAG.
