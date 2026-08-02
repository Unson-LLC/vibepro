---
story_id: story-vibepro-uiux-intake-gate-pr-summary-surfaces
title: gate:uiux_intake_judgment を人間向けPRサマリー表面に表示する
status: active
area: pr-readiness
reason: |
  Alternatives: (1) render all non-verification gate nodes generically from gate_dag.nodes instead of curated label lists — rejected because both surfaces are deliberately curated, ordered human digests and a generic dump would change every existing PR summary; (2) wait until the gate-defining branch merges and fix there — rejected because the label lists live in this file's stable sections and the id-based lookup is safe to land independently.
  Compatibility: both surfaces look nodes up by id and drop missing nodes (filter(Boolean) / null guard), so repos and branches whose gate_dag has no gate:uiux_intake_judgment node render byte-for-byte identical output as before.
  Rollback: revert the two list entries and the test; no data, schema, or artifact format changes.
  Boundary: display-only change to renderPrGateSummary and buildHumanEvidenceDigest in src/pr-manager.js; gate evaluation, DAG wiring, and readiness logic are untouched.
---

# gate:uiux_intake_judgment を人間向けPRサマリー表面に表示する

## Problem

`gate:uiux_intake_judgment`（story-vibepro-uiux-intake-judgment-gate で追加）は gate_dag.nodes と gate_status には現れるが、人間向けPRサマリーの2表面 — `renderPrGateSummary` の routeGates 一覧と `buildHumanEvidenceDigest` のラベル一覧 — に含まれていない。

現時点の到達性は2表面で異なる: `buildHumanEvidenceDigest` は `renderHumanDecisionGraph` 経由で生成PR本文の人間向けダイジェストに実際に到達するライブ表面であり、そこからこのゲートの状態が見えないのが実害。一方 `renderPrGateSummary` は過去のcommitで唯一の呼び出し元が削除され、現在productionコードからは未参照（テストのみが参照）。本Storyはライブ表面の修正に加え、未参照側のcuratedリストも同じ内容に揃えることで、再配線されたときにゲートが欠落しない状態を保つ（未参照表面の変更に現時点のユーザー可視の効果はない）。

## Acceptance Criteria

- `renderPrGateSummary` は gate_dag に `gate:uiux_intake_judgment` ノードが存在するとき、そのラベル・status・required を1行として出力する。
- `buildHumanEvidenceDigest` は同ノードが存在するとき、そのラベルと状態をダイジェストに含める。
- 同ノードが存在しない gate_dag に対しては、両表面の出力は従来と同一（ゲート行が現れない）。

## Out of Scope

- `gate:uiux_intake_judgment` の評価ロジック・DAG配線そのもの（story-vibepro-uiux-intake-judgment-gate の担当）。
- 他の未掲載ゲート（deploy_verification 等）の表示追加。
