---
story_id: story-vibepro-senior-engineering-judgment-dag
title: Senior Engineering Judgment DAG Spec
parent_design: vibepro-senior-engineering-judgment-dag
status: proposed
---

# Senior Engineering Judgment DAG Spec

## 1. コマンド

```bash
vibepro judgment evaluate <repo> --id <story-id> --input <input.json> [--json]
```

コマンドは入力を評価し、review artifact配下へ次を保存する。

- `senior-judgment.json`: 判断DAG、到達経路、状態、推薦の機械可読正本
- `senior-judgment.md`: 人間レビュー用の投影
- `senior-judgment/runs/<run-id>.json|md`: 上書きしない実行履歴

このコマンドはPRを作成せず、既存のreview status、verification、PR readinessを変更しない。

## 2. 入力契約

入力schema versionは `0.1.0` とする。

```json
{
  "schema_version": "0.1.0",
  "story_id": "story-example",
  "run_id": "judgment-001",
  "parent_run_id": null,
  "goal": {
    "statement": "達成したい状態",
    "success_criteria": ["観測可能な成功条件"]
  },
  "observations": [
    {
      "id": "obs-1",
      "statement": "確認済みの事実",
      "source_ref": "path-or-command",
      "freshness": "current"
    }
  ],
  "contradictions": [
    {
      "id": "con-1",
      "statement": "説明と事実が合わない点",
      "observation_refs": ["obs-1"]
    }
  ],
  "problem_frame": {
    "status": "valid",
    "statement": "解くべき問題",
    "reason": "この問題設定を採用する理由"
  },
  "decision_profile": {
    "materiality": "high",
    "reversibility": "costly",
    "blast_radius": "multi_component"
  },
  "axes": [
    {
      "id": "data_state",
      "activation": "active",
      "activation_reason": "永続データの移行を含む",
      "hypotheses": [
        {
          "id": "h-data-loss",
          "claim": "移行が既存データを失う",
          "predictions": [
            { "id": "p-row-loss", "statement": "移行後の件数が減る" }
          ],
          "evidence": [
            {
              "id": "ev-migration-test",
              "prediction_id": "p-row-loss",
              "relation": "refutes",
              "source_ref": "test/migration.test.js#case",
              "freshness": "current",
              "summary": "代表fixtureで件数と識別子が維持された"
            }
          ]
        }
      ]
    }
  ],
  "constraints": [
    { "id": "inv-no-loss", "kind": "invariant", "statement": "既存データを失わない" }
  ],
  "options": [
    {
      "id": "option-a",
      "summary": "段階移行する",
      "addresses": ["h-data-loss"],
      "violates": [],
      "residual_risk": "low"
    }
  ]
}
```

### 列挙値

- `problem_frame.status`: `valid | invalid | uncertain`
- `decision_profile.materiality`: `low | medium | high`
- `decision_profile.reversibility`: `easy | costly | irreversible`
- `decision_profile.blast_radius`: `local | multi_component | systemic`
- `axis.activation`: `active | inactive`
- `evidence.relation`: `supports | refutes | non_discriminating`
- `evidence.freshness`: `current | stale | unknown`
- `constraint.kind`: `invariant | preference`
- `option.residual_risk`: `low | medium | high | unknown`

例ではactiveな軸だけを詳述しているが、実入力の `axes` は次の標準9軸を必ず一度ずつ含める。

`public_contract | rollback_sensitive | security_boundary | data_state | execution_topology | ux_surface |
performance_semantic | scope_reviewability | release_ops`

関係しない軸は `activation=inactive` と判断理由を残し、仮説を空配列にできる。追加軸は許可する。
全IDは同じ入力内で一意でなければならない。標準軸の欠落、参照先の無いobservation、prediction、
hypothesis、constraintは入力エラーとする。`story_id` はCLIの `--id` と一致しなければならない。

## 3. 固定共通スパイン

| 順序 | node_id | 責務 |
|---:|---|---|
| 1 | `input_integrity` | schema、必須値、ID、参照整合性を確認する |
| 2 | `goal_contract` | ゴールと成功条件を固定する |
| 3 | `contradiction_scan` | 観測と違和感を判断入力として残す |
| 4 | `problem_frame` | 問題設定を `valid / invalid / uncertain` に分岐する |
| 5 | `decision_profile` | 重大度、可逆性、影響範囲を確定する |
| 6 | `depth_route` | 判断深度を導出する |
| 7 | `active_branch_fan_in` | 到達した仮説枝だけを集約する |
| 8 | `option_pruning` | 不変条件に違反する選択肢を除外する |
| 9 | `recommendation` | 非権威的な推薦と理由を作る |

`problem_frame=invalid` は `recommendation=revise_problem` へ短絡する。
`problem_frame=uncertain` は `recommendation=human_decision_required` へ短絡する。どちらも判断軸を到達不能にする。

## 4. 判断深度

次のいずれかなら `deep`、それ以外は `light` とする。

- `materiality=high`
- `reversibility=irreversible`
- `blast_radius=systemic`
- contradictionが1件以上ある

深度は軸の合否を変えない。追加すべき予測・証拠の粒度をレビュー時に示すメタ判断である。

## 5. 動的枝

各軸は、claim、prediction、evidence、hypothesis verdict、axis fan-inの順に展開する。inactive軸とその子は
`not_reached` であり、全体fan-inに含めない。

currentな証拠だけが仮説verdictに使える。

1. 一つでもcleanな `refutes` があれば `hypothesis_refuted`
2. 全predictionに一つ以上の `supports` があり、`refutes` が無ければ `risk_confirmed`
3. それ以外は `inconclusive`

`non_discriminating`、`stale`、`unknown` は履歴へ残すが、支持または反証として数えない。反証された仮説に
対して不足predictionを要求しない。

ただし、同じpredictionをcurrentな証拠が支持も反証もしている場合、そのpredictionはcleanな反証として
扱わず `conflicting_predictions` に残す。他のpredictionによるcleanな反証が無ければ枝は `inconclusive`
とし、矛盾する証拠の解消を次アクションにする。

複数の到達枝をfan-inするときは `inconclusive`、`risk_confirmed`、`safe_to_defer`、`satisfied` の順で
未解決性を保持する。別枝にconfirmed riskがあっても、未確定の枝を集約表示から消してはならない。

## 6. 制約と選択肢

- `invariant` のIDを `violates` に持つ選択肢は除外する。
- `preference` 違反は除外せず、trade-offとして残す。
- confirmed hypothesisは、そのIDを `addresses` に含む残存選択肢がある場合だけ「対策候補あり」とする。
- optionの存在はリスクが消えたことを意味しない。`residual_risk` を推薦へ残す。

## 7. 推薦規則

優先順位の高い順に適用する。

| 条件 | recommendation |
|---|---|
| problem frameがinvalid | `revise_problem` |
| problem frameがuncertain | `human_decision_required` |
| inconclusiveがあり、low + easy + localではない | `needs_investigation` |
| confirmed riskに対する残存選択肢のresidual riskがunknown | `needs_investigation` |
| confirmed riskに、それをaddressするlow / medium residual riskの残存選択肢が無い | `do_not_proceed` |
| confirmed riskにlow / medium residual riskの残存選択肢がある | `proceed_with_followup` |
| inconclusiveがあるがlow + easy + local | `proceed_with_followup` (`safe_to_defer`) |
| active仮説が全てrefuted、またはactive軸が無い | `proceed` |

推薦は `advisory: true` を必ず持つ。`ready_for_pr_create`、`gate_status`、`merge_allowed` を出力してはならない。

## 8. ノード状態

`not_reached | candidate | active | satisfied | hypothesis_refuted | risk_confirmed | inconclusive |
safe_to_defer | reframe_required | human_decision_required`

edgeは `from`、`to`、`condition`、`traversed` を持つ。DAG生成後にtopological validationを行い、cycle、
dangling edge、duplicate node IDがあれば成果物を書かない。

## 9. 改訂

- `run_id` はstory内で一意とする。
- 新しい証拠で判断を変える場合は、新しい `run_id` と直前の `parent_run_id` を使う。
- 一つのrunのDAGと入力を上書き更新しない。
- 親がある場合、投影はframe、判断深度、軸の活性化、仮説verdict、推薦の差分を `decision_delta` として示す。

## 10. 成果物契約

`senior-judgment.json` は最低限次を持つ。

- `schema_version`, `model`, `story_id`, `run_id`, `parent_run_id`
- `analysis_depth`
- `nodes[]`, `edges[]`, `topological_order[]`
- `active_axes[]`, `inactive_axes[]`, `unreachable_axes[]`
- `hypothesis_outcomes[]`
- `viable_options[]`, `pruned_options[]`
- `recommendation`, `reasons[]`, `unknowns[]`, `next_actions[]`
- 入力した観測、問題設定、軸、仮説、予測、証拠、制約、選択肢を保持する `decision_context`
- `advisory: true`, `authority: human_ci_repository_rules`

Markdown投影は、結論、問題設定、深度、到達した軸、仮説と証拠、除外した選択肢、未知、次の判断を表示する。

## 11. 受け入れ基準対応テスト

- `SEJ-001`: invalid frameは軸を到達不能にし、`revise_problem` を返す
- `SEJ-002`: inactiveまたは未到達軸のinconclusiveはfan-inと推薦に影響しない
- `SEJ-003`: currentな反証証拠は仮説枝を閉じ、同じ枝の不足predictionを残さない
- `SEJ-003b`: 同じpredictionへのcurrentな支持・反証の競合を隠さず `inconclusive` にする
- `SEJ-004`: 証拠不足は高リスクなら `needs_investigation`、低リスクで可逆なら `safe_to_defer` として扱う
- `SEJ-004b`: confirmedとinconclusiveが併存するfan-inは未解決性を保持する
- `SEJ-005`: invariant違反の選択肢を除外し、confirmed riskをaddressできなければ `do_not_proceed` を助言する
- `SEJ-006`: duplicate ID、dangling ref、cycleを拒否し、成果物を作らない
