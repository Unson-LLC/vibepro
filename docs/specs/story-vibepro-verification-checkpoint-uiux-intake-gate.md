---
story_id: story-vibepro-verification-checkpoint-uiux-intake-gate
title: Verification checkpoint gate list — gate:uiux_intake_judgment Spec
status: active
parent_design: vibepro-verification-checkpoint-uiux-intake-gate
last_reviewed_root_hash: 12ac908c430a0e6aaf9338b88646de10841317f5c665760f4d41c121a8ba965e
---

# Verification checkpoint gate list — gate:uiux_intake_judgment Spec

正本のSpec artifactは `.vibepro/spec/story-vibepro-verification-checkpoint-uiux-intake-gate/spec.json`（clauses: INV-001 / INV-002）。本ファイルはDesign SSOTのlineage束縛用spec pointerであり、公開契約の旧/新対比を記録する。Storyの受け入れ基準は `docs/management/stories/active/story-vibepro-verification-checkpoint-uiux-intake-gate.md` を参照する。

## Contract Summary

- INV-001: `src/checkpoint-manager.js` の `verification` checkpoint policy は `gate_ids` に `gate:uiux_intake_judgment` を `gate:pr_route_classification` の直後に含む。
- INV-002: `verification` 以外の checkpoint stage は `gate:uiux_intake_judgment` を含まず、`pr` stage は `gate_ids: null`（全 required gate 委譲）を維持する。

## Public Contract: 旧/新対比

変更対象は `vibepro checkpoint verification` の blocking 対象 gate 集合（`listCheckpointStages()` の `verification.gate_ids` と `runCheckpoint` の findings 収集）。

| 観点 | 旧契約 | 新契約 |
|------|--------|--------|
| `verification.gate_ids` | `gate:pr_route_classification`, `gate:pr_body_contract`, `gate:mirror_source_traceability`, `gate:ci_status_or_waiver`, `gate:vibepro_artifact_policy`, `gate:split_resolution`, `gate:network_contract`, `gate:unit`, `gate:integration`, `gate:e2e`, `gate:visual_qa` | 同一集合 + `gate:uiux_intake_judgment`（`gate:pr_route_classification` 直後） |
| gate_dag に `gate:uiux_intake_judgment` node が無い場合の checkpoint 出力 | passed/blocked 判定・findings とも従来どおり | **同一**（lookup が欠損 id を drop するため後方互換） |
| node が存在し `required: false` の場合 | n/a | block しない（`required !== false` フィルタ維持） |
| node が存在し required かつ未解決の場合 | verification checkpoint は passed（見逃し） | verification checkpoint が block（`gate_unresolved` finding） |
| 他 stage（story / implementation-start / test-plan / implementation-complete / pr）の `gate_ids` | 従来どおり | **変更なし**（pr は `null` 維持） |
| checkpoint 出力 schema（`schema_version: 0.1.0`, findings 形式） | 従来どおり | 変更なし |

互換性: 現行の gate DAG builder は `gate:uiux_intake_judgment` node を生成しないため、本変更は gate 定義 branch（story-vibepro-uiux-intake-judgment-gate）が merge されるまで観測可能な挙動差を持たない。
