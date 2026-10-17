---
story_id: story-vibepro-task-plan-decomposer
title: Storyからtask-planを作る
status: active
view: dev
period: 2026-10
started_at: 2026-10-17
owner_repository: vibepro
brainbase_task_short_id: 53a39f78
spec_docs:
  - .vibepro/spec/story-vibepro-task-plan-decomposer/spec.json
---

# Storyからtask-planを作る

## Storyと利用者成果

Brainbase タスク T4（53a39f78）に対応する。vibepro の利用者が、いまの Story markdown を渡すと、task-plan `0.2.0`（`plan_version` 付き）が返る。重なりを書くときは T3（8785f0ff）の `overlap_refs` 形だけを使い、完了契約の本文は載せない。

この計画で使う CLI は、ブランチ `cursor/task-plan-overlap-refs-3fc2` の commit `345ed354bc53ca5dfdd968923d35e0ac3f881638`（`node bin/vibepro.js`、package `0.2.0-beta.33`）である。

## 受入条件（Brainbase 完了契約 criteria 原文）

- **draft-pr:** Unson-LLC/vibeproに境界テスト付きdraft PRがある(前提:T3のoverlap_refs形)
- **behavior:** Story入力からtask-plan(plan_version付き)を生成する境界がテストで示される
- **ci-inspector:** 当該PRのCIが緑で、Inspectorが合格または条件付き合格を出す（Inspector は廃止済みのため Maintainer が同等のレビューを行う）
- **visibility:** project_codesにbrainbaseとvibeproの両方があり、brainbase絞り込みのタスク一覧に見える — **本 criterion は Brainbase タスク台帳側で満たされている（vibepro 実装スコープ外）**

## 方針

分解は LLM もネットワークも使わない。同じ Story テキストと同じ repository 指定は、同じ task-plan（同じ `plan_version`）になる。

入力は `docs/management/stories/active/*.md` と同じ Story markdown である。frontmatter は既存のスカラー `key: value` だけを読む。受入条件の箇条書きは `extractMarkdownAcceptanceCriteria` が既に認識する見出し（`受入条件` を含む）から取る。診断由来の `story-task-generator`（schema `0.1.0`）や Brainbase のタスク JSON は入力にしない。

出力は `validateTaskPlan` が受理する task-plan `0.2.0` である。`schema_version` は `0.2.0` のままにする。`plan_version` は、正規化結果から `plan_version` を除いた JSON の SHA-256 先頭 12 桁を `plan-` に付けた文字列である。

Task は受入条件 1 件につき 1 件である。`task_id` はその抽出 id（明示の `AC-...` か、無ければ `AC-1` からの連番）である。`purpose` と `acceptance_criteria` は箇条書きの原文である。`allowed_paths` は `## allowed_paths` の箇条書きを全 Task で共有する。`intent.delegated_scope` は `## 委任範囲` または `## delegated_scope` の箇条書きである。`## スコープメモ` は委任範囲にしない。`intent.purpose` は H1、`intent.priority` と `integration.conflict_owner` は frontmatter の `priority` と `conflict_owner` である。`dependencies` は空である。前提・接続・重複の依存種別は推論しない。

`overlap_refs` は `## overlap_refs` が無いときフィールドごと出さない。あるときは箇条書き `- <id@version>: <task_id>, <task_id>` だけを T3 の形へ写す。契約本文（`completion_contract`、`description`、`body`、`criteria`）が節にあるときは plan を作らず拒否する。パスが同じでも参照は作らない。`overlap_refs` は start / verify / integrate を止めない。

欠けた必須入力（`story_id`、`repository`、H1、`priority`、受入条件、`allowed_paths`、委任範囲、`conflict_owner`）は名前を列挙して拒否する。パス、優先度、競合担当、契約 id は補わない。

CLI は `vibepro task plan decompose [repo] --story <path> [--repository <name>] [--json]` である。標準出力へ plan を出し、ファイルも受理済み authority も書かない。`--repository` は frontmatter の `owner_repository` より優先する。

## トレーサビリティ

- 実装予定: `src/task-plan-decomposer.js`（`decomposeStoryToTaskPlan`）、`src/cli.js`（`task plan decompose`）
- 再利用: `src/task-plan.js`（`validateTaskPlan` / `normalizeOverlapRefs`）、`src/markdown-acceptance-criteria.js`（`extractMarkdownAcceptanceCriteria`）
- 検証予定: `test/task-plan-decomposer.test.js`

## 対象外

- LLM による分割、依存種別の推論、`task bind`、Brainbase API、task-plan `schema_version` の 0.3.0 化、cross-repo の `overlap_refs`、診断タスク（schema `0.1.0`）への接続
