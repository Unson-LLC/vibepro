# シニアエンジニア判断

`vibepro judgment evaluate` は、シニアエンジニアの思考を確認可能な有向非巡回グラフ（DAG）にします。これは助言型の意思決定支援です。次にどの種類の仕事を行うべきかと、その理由を記録しますが、PRを承認・mergeする機能ではありません。

変更の重要度が高い、元に戻しにくい、複数componentにまたがる場合や、機能を加えるべきか、累積した仕組みを小さくすべきか、不確かな制約を先に検証すべきかを判断したい場合に使います。

## 判断の順番

各評価は、同じ最上位順序で進みます。

1. ゴールと観測可能な成功条件を固定する。
2. 直近の外部成果確認または簡素化baseline以後に採用した開発batchを確認する。
3. 違和感を記録し、問題設定が正しいかを判定する。
4. `VALUE`、`SIMPLIFY`、`VALIDATE` の開発モードを一つ選ぶ。
5. 重要度、可逆性、影響範囲、矛盾から判断深度を決める。
6. 関係する技術判断軸だけを通り、現在の証拠で仮説を検証する。
7. 選択モードまたは不変条件と矛盾する選択肢を除く。
8. 助言としての推薦、未知、次の行動を出す。

内部のfan-inは、一回の評価で到達した枝を集約するだけです。複数PRを統合するmerge coordinatorではなく、並列PR同士を待たせる仕組みでもありません。

## 開発モード

| モード | 選択条件 | 許可するoption action |
| --- | --- | --- |
| `VALUE` | 価値制約が確認済みで判断証拠が十分、かつ履歴によるoverrideがない | `build`, `fix`, `delete`, `consolidate`, `redesign`, `retire` |
| `SIMPLIFY` | 構造的過剰と十分な判断証拠がある、または採用済みの構造加算後に外部成果が不変・悪化した | `delete`, `consolidate`, `redesign`, `retire` |
| `VALIDATE` | 問題、成果、または介入を選ぶための証拠が十分に確認できていない | `measure`, `experiment` |

「3回加算したら停止」のような固定閾値は使いません。複数Storyを並列開発したbatchも、一つの採用判断単位です。batch内の高速並列開発は維持でき、次の評価で観測した外部成果からbatch全体を判定します。

現在制約では、問題が確認済みか（`status`）、価値制約か構造的過剰か（`kind`）、介入を選べる証拠が十分か（`decision_evidence.status`）を分けます。問題が確認済みでも、解決方向まで分かっているとは限りません。

開発モード選択では、提案側の `change_kind` や `directly_addresses_constraint` を読みません。入力に残っていても判断に使わないメタデータです。候補actionはモードを選んだ後に初めて評価します。

## 評価を実行する

リポジトリを初期化し、schema `0.3.0` の入力を用意して実行します。

```bash
vibepro init .
vibepro judgment evaluate . \
  --id story-example \
  --input judgment-input.json \
  --json
```

入力には次を記録します。

- ゴール、観測、違和感、現在の問題設定
- 因果的な履歴境界、その後に採用したbatch、現在制約の種別と判断証拠、提案batch
- 重要度、可逆性、影響範囲
- 9つの標準軸: `public_contract`, `rollback_sensitive`, `security_boundary`, `data_state`, `execution_topology`, `ux_surface`, `performance_semantic`, `scope_reviewability`, `release_ops`
- 仮説、予測、現在の証拠、制約、候補option

関係しない標準軸は `inactive` とし、理由を残します。activeな軸では、明示した予測と現在の証拠から、リスク確認、仮説反証、未確定を区別します。

## 結果と改訂

コマンドは現在の投影と上書きしない実行履歴を次へ保存します。

```text
.vibepro/reviews/<story-id>/senior-judgment.json
.vibepro/reviews/<story-id>/senior-judgment.md
.vibepro/reviews/<story-id>/senior-judgment/runs/<run-id>.json
.vibepro/reviews/<story-id>/senior-judgment/runs/<run-id>.md
```

新しい証拠で判断を変えるときは、新しい `run_id` を使い、`parent_run_id` で直前のrunを参照します。VibeProは前のrunを残し、判断差分を出します。

## 権限境界

結果には必ず `advisory: true` と `authority: human_ci_repository_rules` が入ります。判断DAGは `ready_for_pr_create`、`gate_status`、`merge_allowed` を出力せず、verification、review status、PR readinessも変更しません。最終権限は人間、CI、対象リポジトリのruleに残ります。

この区別により、現行の最小コア境界は維持されます。この機能は透明な思考支援であり、廃止したGate DAGの復活ではありません。
