---
story_id: vp-self-model-20260930-01
title: 既存概念モデルで自分たちの仕組みも観測・改善する
status: active
view: dev
architecture_ref: docs/architecture/development-judgment-dag.md
spec_ref: docs/specs/vp-self-model-20260930-01.md
---

# Story: 既存概念モデルで自分たちの仕組みも観測・改善する

## 目的

Brainbaseが何を・なぜ・どこまで改善するかを決め、VibeProがどう実現するかを判断する際、対象に外部環境だけでなく自分たちの役割・ルール・能力・接続も含める。チャット上の合意だけでなく、既存正本と実際の作業入口から同じ参照関係を辿れるようにする。

## 受け入れ条件

- [ ] 哲学を横断原則、Objectiveを望ましい状態と評価基準、World Modelを目標と独立した観測・事実・仮説として区別し、自分たちの仕組みを後者の対象に含める。
- [ ] StoryはObjectiveを複製せず版付き参照する。問題選択、専門判断、変更、技術評価、成果評価、学習候補・採択・影響確認の参照契約と具体例が辿れる。VibePro向けGraph候補のID/revisionは実読できたが、draftで評価基準が空であるため、採択済みObjectiveの参照と成果評価の実例部分は未達のまま残す。
- [ ] VibeProの既存判断文書とハーネスTEAM/4担当指示に適用経路を接続し、配布先の同一性と役割境界を確認する。
- [ ] 新しいGate、cron、権限、汎用自己改善エンジン、永続World Model実装を追加せず、Story/Spec・影響確認・レビュー・PR/CIの証跡と、成果未確認の範囲を残す。
