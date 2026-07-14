---
story_id: story-vibepro-judgment-dag-adjudication
title: Judgment DAG Adjudication Architecture
parent_design: vibepro-judgment-dag-adjudication
---

# アーキテクチャ

## 判断

VibeProの判断系ゲート（Common Judgment Spine・Judgment Axes・Failure Mode Coverage）は、項目ごとの問いを良質なproseとして持ちながら、消化条件がすべて証拠テキストのトークン照合になっている。「シニアエンジニアの判断」を名乗る場所に判断が存在せず、正直な文章でも嘘の文章でも同一に通過する。これはevidence adjudication gate（PR#324）がAC clauseについて塞いだ穴の、判断DAG側の残存である。

対策は#324パターンの一般化であり、3原則を引き継ぐ。**独立性**: 裁定は実装エージェントと別のfresh context subagentが行い、記録はprovenance必須。**意図アクセス**: judgeには項目の問い原文（axesの `decision_question`、spineのsubcheck定義、failure modeの候補理由）と変更差分・現在の証拠を渡し、「機械的消化はこの変更の実体に照らして妥当か」を反証の立場で検討させる。**正直な語彙**: `judged_unsound`（トークンは揃うが判断不成立）と `needs_human_judgment`（LLMで判断不能）を用意し、人間判断はdecision recordへ明示ルートで接続する。

#324からの差分は2点。**checkpoint一括裁定**: 項目ごとの個別dispatchではなく、judgeが1セッションで全アクティブ項目のチェックリストを歩く（clause裁定のコミット毎再裁定コストを3 Story導入の実運用で確認済みのため、往復回数を抑える）。**既存ゲートは非接触**: トークン照合は削除せず残す。既存照合が「どの項目がこの変更に関係するか」を決め（ルーティング）、裁定ゲートが「その消化は判断として成立しているか」を検定する（監査）。裁定ゲートを必須criticalで重ねることで、トークン照合単独では消化にならない状態を作る——これが「降格」の実装であり、既存ゲートのロジック書き換えという高リスク変更を避ける。

アクティブ項目の定義にはrouteスコープを含める: 判断DAGがrelease判断を担う `agent_workflow` route / `workflow_heavy` profileのときのみ項目を収集し、それ以外のroute（fast lane・general等）はアクティブ項目0件の明示 `not_applicable` とする（判断が要求されていない変更に裁定往復を課さない）。

項目収集は最新の `pr prepare` 成果物（pr-prepare.json のgate_dag）を一次入力とする。pr prepareが判断DAGを構成した後でなければ「何が判断対象か」は存在しないため、成果物なしの裁定準備は明示エラーとする（anti-vacuum: 対象不明のまま裁定済み扱いにしない）。

## 入力

- 最新 `pr-prepare.json` の gate_dag: `gate:common_judgment_spine` のsubchecks（id・surface・required_evidence_kind・matched/missing evidence）、`gate:judgment_axis_*` ノード（axis id・decision_question・blockers・status）、`gate:failure_mode_coverage` のmodes（id・reason・keywords・status・evidence）
- 変更差分の要約: pr prepare時のchanged files一覧
- `vibepro adjudicate record --judgment` のCLI引数（--item / --verdict / --reason / --agent-system / --agent-id / --session-ref）と記録時のcurrent HEAD
- `.vibepro/config.json` の `judgment_adjudication.enabled`（既定 true）
- decision record（source `gate:judgment_dag_adjudication:<item-id>`、accepted + reason + artifact）

## 出力

- `.vibepro/adjudication/<story-id>/judgment-adjudication-request.md`: 全アクティブ項目のチェックリスト（問い原文＋機械的消化状態＋証拠＋変更ファイル）と裁定者指示
- `.vibepro/adjudication/<story-id>/judgment-adjudication.json`: 項目ごとの `{ item_id, verdict, reason, provenance, head_commit, recorded_at }`（clause裁定のadjudication.jsonとは別ファイル）
- `pr prepare` gate_dagへの `gate:judgment_dag_adjudication` ノード:
  - 裁定なし / stale HEAD / 項目不足 → `needs_evidence`（不足item id列挙）
  - いずれかが `judged_unsound` → `failed`（judge理由をreasonへ）
  - `needs_human_judgment` はdecision record（accepted+reason+artifact）でのみ解決
  - 全項目解決 → `passed`、アクティブ項目0件 → 明示 `not_applicable`
- unresolved-required集計（overall_status / ready_for_pr_create）とcritical判定への登録

## 境界

- 既存のspine/axes/failure modesのトークン照合ロジックは変更しない（ルーティング+防御層として残置。撤去は採用実績を見た後続Story）
- clause裁定（evidence_adjudication）とは独立したゲート・成果物（役割が異なる: clauseは「成果の実証」、judgmentは「判断の成立」）
- path surface / responsibility authority系は対象外（同じ収集・裁定機構で後続展開可能な形にする）
- VibePro自身はLLMを呼ばない（依頼書生成・記録・強制のみ）
- 裁定はcheckpoint単位の一括セッション。HEADが動けば全項目再裁定（clause裁定と同じHEAD厳密バインド。fail-closed: head_commit欠落・HEAD不明はstale扱い、record時のHEAD解決不能は拒否）
- `judgment_adjudication.enabled: false` で明示オプトアウト。成果物なしの既存リポジトリでも `pr prepare` はクラッシュしない
