---
story_id: story-vibepro-journey-curate-command
title: "journey curate コマンドで curated Journey 作成を生 JSON 手書きから卒業する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "needs_curated_journey の解消手段が .vibepro/journeys/ への生 JSON 手書きしかない"
related_stories:
  - story-vibepro-journey-ai-handoff-context
  - story-vibepro-story-journey-diagnose
  - story-vibepro-patton-journey-map
parent_design: vibepro-journey-curate-command
architecture_docs:
  - docs/architecture/vibepro-journey-curate-command.md
spec_docs:
  - docs/specs/story-vibepro-journey-curate-command.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

`journey derive` は machine-derived context pack を、`journey handoff` は AI 可読 markdown を生成するが、その先の curated Journey は `.vibepro/journeys/<journey-id>.json` を人間が生 JSON で手書きするしかない。さらに curated artifact が machine context の conflicts / open questions を解消しているかの検証も存在しない。ここが Journey フローの断絶点であり、`needs_curated_journey` から先へ進む標準手段を用意する。

## User Story

**As a** UI/Journey Story を進める VibePro ユーザー<br>
**I want** `vibepro journey curate` が最新の handoff context から curated Journey のドラフトを生成し、判断が必要な箇所（conflicts / open questions / next slice）だけを入力として受け取ること<br>
**So that** スキーマを暗記して生 JSON を書かずに、判断内容だけを書けば valid な curated Journey が完成する

## Scope

- `vibepro journey curate [repo]`: 最新の machine-derived context pack を読み、curated Journey のドラフト（walking skeleton・segments は機械側から引き継ぎ）を生成する。
- 判断入力は `--input <json|yaml>` ファイルで受け取る（conflicts への裁定、open questions への回答または明示的な defer、next slice の選択）。
- ドラフト検証: machine context の各 conflict / open question が resolved か explicitly deferred のいずれかであることを curate 時に検証し、未処理があれば書き込まずに一覧を返す。
- 書き込み先は既存の `.vibepro/journeys/<journey-id>.json` とし、`journey status` が curated として認識するスキーマに準拠する。
- `story diagnose` の journey_context 次アクション表示に `vibepro journey curate .` を追加する。

## Acceptance Criteria

- [ ] JCC-S-1: `journey derive` 済みのリポジトリで `journey curate` に全 conflict / open question を処理した入力を与えると、`.vibepro/journeys/<journey-id>.json` が生成され `journey status` が curated を返す。
- [ ] JCC-S-2: 未処理の conflict または open question が残る入力では curated Journey を書き込まず、未処理項目の一覧と修正方法を返す。
- [ ] JCC-S-3: explicitly deferred とした open question は curated artifact に defer 理由つきで残り、検証を通過する。
- [ ] JCC-S-4: machine-derived context pack が存在しない状態で curate を実行すると、`vibepro journey derive .` を next command として案内して終了する。
- [ ] JCC-S-5: `story diagnose` の journey 状態が `machine_derived` のとき、次アクションに `vibepro journey curate .` が表示される。
- [ ] JCC-S-6: テストで full-resolution / partial-resolution 拒否 / defer / derive 未実行の各状態を固定する。

## 既存挙動（inherited behavior）

- Manually authored curated Journey JSON at `.vibepro/journeys/<journey-id>.json` remains valid and is unchanged.
- `journey derive` and `journey handoff` output formats are unchanged.
- `gate:journey_context` activation in the PR Gate DAG is unchanged.

## Non Goals

- 対話式 TUI / GUI エディタの提供（ファイル入力ベースで完結させる）。
- Journey スキーマ自体の変更。
- design brief への変換（story-vibepro-journey-design-brief-handoff など後続で扱う）。
