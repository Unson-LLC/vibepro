---
story_id: story-vibepro-task-plan-overlap-refs
title: task-plan 0.2.0 に overlap_refs を追加する
status: active
view: dev
period: 2026-10
started_at: 2026-10-17
owner_repository: vibepro
brainbase_task_short_id: 8785f0ff
follow_on_task_short_id: 53a39f78
spec_docs:
  - .vibepro/spec/story-vibepro-task-plan-overlap-refs/spec.json
---

# task-plan 0.2.0 に overlap_refs を追加する

## Storyと利用者成果

Brainbase タスク T3（8785f0ff）に対応する。vibepro の task-plan `0.2.0` に plan レベルの `overlap_refs` を追加し、重なる Task が共有する完了契約を、契約本文ではなく `completion_contract_ref`（`id@version`）だけで表す。

`completion_contract` の本文は Brainbase 側に置く。task-plan は参照のみを持つ。後続 T4（53a39f78）は Story から task-plan を出力する分解器で、この形を使う。

## 受入条件（Brainbase 完了契約 criteria 原文）

- **draft-pr:** Unson-LLC/vibeproにtask-plan 0.2.0へoverlap_refsを追加する境界テスト付きdraft PRがある
- **behavior:** completion_contractはBrainbase側に置き、task-planは参照のみ持つことがスキーマ/テストで示される
- **ci-inspector:** 当該PRのCIが緑で、Inspectorが合格または条件付き合格を出す（Inspector は廃止済みのため Maintainer が同等のレビューを行う）
- **visibility:** project_codesにbrainbaseとvibeproの両方があり、brainbase絞り込みのタスク一覧に見える — **本 criterion は Brainbase タスク台帳側で満たされている（vibepro 実装スコープ外）**

## スコープメモ

- `overlap_refs` の `task_ids` は同一 plan 内に限定する（別 repository の Task を束ねる形は対象外）。
- `overlap_refs` は start / verify / integrate を止めない。

## トレーサビリティ

- 実装: `src/task-plan.js`（`validateTaskPlan` / `normalizeOverlapRefs`）、`src/task-authority.js`（bind・accepted read）
- 検証: `test/task-plan.test.js`、`test/task-authority.test.js`（S-001 境界 11 件）

## 対象外

- T4 分解器の実装、Brainbase API、task-plan `schema_version` の 0.3.0 化、cross-repo の `overlap_refs` 拡張
