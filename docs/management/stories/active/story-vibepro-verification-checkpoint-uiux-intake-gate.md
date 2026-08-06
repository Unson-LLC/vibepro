---
story_id: story-vibepro-verification-checkpoint-uiux-intake-gate
title: verification checkpoint の curated gate list に gate:uiux_intake_judgment を追加する
status: active
area: pr-readiness
view: dev
period: 2026-08
reason: |
  Alternatives: (1) verification checkpoint を curated list から gate_ids: null（全required gate）に
  変える — 却下。curated list は checkpoint 段階ごとに「この段階で解決済みであるべき gate」を
  意図的に絞る設計であり、null 化は verification と pr checkpoint の区別を消す。
  (2) gate:uiux_intake_judgment を定義する branch（story-vibepro-uiux-intake-judgment-gate,
  claude/sweet-chatelet-c1b354）側で checkpoint list も直す — 却下。PR #416
  （story-vibepro-uiux-intake-gate-pr-summary-surfaces）が確立した先行landing パターンに従う:
  checkpoint の lookup は `.map(find).filter(Boolean)` で欠損 node を落とすため、gate 未定義の
  現行 DAG では no-op で安全に独立 land でき、gate branch merge 時の欠落を防げる。
  Compatibility: gate_dag に gate:uiux_intake_judgment node が存在しない限り
  collectCheckpointGateFindings の lookup は該当 id を単に skip する。node が存在しても
  required !== false のフィルタがあるため、not required な story では block しない。
  既存の checkpoint 出力（findings / required_gate_ids 以外）は不変。
  Rollback: verification.gate_ids の1要素とテスト1ファイルを外すだけ。データ・schema・
  artifact 形式の変更なし。
  Boundary: src/checkpoint-manager.js の CHECKPOINTS.verification.gate_ids のみ。
  gate:uiux_intake_judgment の評価ロジック・DAG 配線・decision type は
  story-vibepro-uiux-intake-judgment-gate の担当で本 Story の対象外。他 checkpoint 段階
  （story / implementation-start / test-plan / implementation-complete）への追加も対象外
  （intake 判断は decision record でいつでも閉じられるため、PR handoff 直前の verification が
  兄弟 route/policy gate 群と同じ最初の blocking 点として妥当）。
---

# verification checkpoint の curated gate list に gate:uiux_intake_judgment を追加する

## Problem

`src/checkpoint-manager.js` の `verification` checkpoint は curated な `gate_ids` list で
PR handoff を block する。この list は `gate:uiux_intake_judgment` の兄弟にあたる
route/policy gate 群（`gate:pr_route_classification`, `gate:pr_body_contract`,
`gate:mirror_source_traceability`, `gate:ci_status_or_waiver`,
`gate:vibepro_artifact_policy`, `gate:split_resolution`）をすべて含むが、
`gate:uiux_intake_judgment`（story-vibepro-uiux-intake-judgment-gate で追加。gate DAG に
**常に required で含まれる**設計）を含まない。

このまま gate 定義 branch が merge されると、`vibepro checkpoint verification` は
intake 判断が未記録の story でも "passed" を返し、最終 `pr` checkpoint（全 required gate）で
初めて block が発覚する — 中間 checkpoint の意味（早期発見）を損なう誤ったシグナルになる。
PR #416 は同じ gate について人間向けサマリー表面の欠落を先行修正しており、本 Story は
checkpoint blocking list 側の同型の欠落を同じ先行landing パターンで塞ぐ。

## Acceptance Criteria

- `listCheckpointStages()` が返す `verification` stage の `gate_ids` に
  `gate:uiux_intake_judgment` が含まれ、`gate:pr_route_classification` の直後
  （兄弟 route/policy gate 群と同じ位置）に並ぶ。
- `verification` 以外の checkpoint stage（story / implementation-start / test-plan /
  implementation-complete / pr）の `gate_ids` は変更前と同一である
  （pr stage は `gate_ids: null` の全 required gate 委譲を維持する）。

## Out of Scope

- `gate:uiux_intake_judgment` の評価ロジック・gate DAG 配線・`intake_not_applicable`
  decision type（story-vibepro-uiux-intake-judgment-gate の担当）。
- 他の checkpoint 段階への追加。
- 人間向け PR サマリー表面（story-vibepro-uiux-intake-gate-pr-summary-surfaces で対応済み）。
