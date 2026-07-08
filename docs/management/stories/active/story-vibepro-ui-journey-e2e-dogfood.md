---
story_id: story-vibepro-ui-journey-e2e-dogfood
title: "UI Story を journey→design→visual gate→merge まで一気通貫で実走し、経路をテストで固定する"
status: active
view: dev
period: 2026-07
journey_activity: activation
journey_step: ui-dogfood
release_slice: walking_skeleton
source:
  type: operator_feedback
  title: "journey / design-system / visual_qa の部品は揃っているが、実プロジェクトで一気通貫した実例がゼロ"
related_stories:
  - story-vibepro-journey-curate-command
  - story-vibepro-flow-screenshot-visual-gate-bridge
  - story-vibepro-visual-residual-local-runner
  - story-vibepro-design-modernize-journey-context
  - story-vibepro-self-dogfood-audit-loop
parent_design: vibepro-ui-journey-e2e-producer-contracts
architecture_docs:
  - docs/architecture/vibepro-ui-journey-e2e-dogfood.md
spec_docs:
  - docs/specs/story-vibepro-ui-journey-e2e-dogfood.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

コード側パイプラインは self-dogfood の往復（PR #169〜#181）で罠を潰して成熟したが、UI/UX 側は journey→design→実装→視覚検証→gate→merge を通した実例が一度もない。`.vibepro/` にも実運用の curated Journey / design 連携 / visual gate 通過の artifact が存在しない。UI を持つ実プロジェクトで 1 本のUI Story をフルパスで実走し、発見した断絶を後続 Story 化し、成立した経路を e2e テストで固定する。

## User Story

**As a** VibePro の開発者かつ利用者<br>
**I want** 実在する UI 変更 1 件を journey derive → curate → design context 参照 → 実装 → 視覚証跡 → `gate:visual_qa` / `gate:journey_context` 解消 → `execute merge` まで VibePro のみで完走させること<br>
**So that** UI/UX 手法が「部品の集合」ではなく再現可能な確立された経路であることを証跡つきで言える

## Scope

- 対象: UI を持つ実プロジェクト（例: brainbase-ui）の実 UI 変更 1 件。ダミー変更は不可。
- 実走記録: 使用したコマンド列・詰まった箇所・回避策を dogfood レポート（docs/reference/ 配下）として残す。
- 経路固定: 成立したフルパス（journey derive → curate → 実装 → visual evidence → pr prepare gates 解消 → merge）を synthetic リポジトリ上の e2e テストとして追加し、リグレッションを検出可能にする。
- 断絶の Story 化: 実走で発見した手作業・二度手間・不明瞭な next command は、それぞれ受け入れ基準つきの後続 Story として起票する。
- 事前宣言する数値目標: (1) Story 着手から merge までに必要な手動コマンド数を計測して記録する、(2) 生 JSON の手書き 0 回、(3) `gate:visual_qa` と `gate:journey_context` の解消がともに残存 blocked なしで達成される。達成可否は事後の主張ではなくこの宣言との突き合わせで判定する。

## Acceptance Criteria

- [ ] UJD-S-1: 実 UI 変更 1 件が curated Journey（`journey status` = curated）を持った状態で `pr prepare` に到達する。
- [ ] UJD-S-2: `gate:visual_qa` と `gate:journey_context` が waiver なしの証跡で解消される。
- [ ] UJD-S-3: `vibepro execute merge` まで VibePro フローのみで完了し、`gh pr create` 等の迂回を使わない。
- [ ] UJD-S-4: dogfood レポートに手動コマンド数・詰まり箇所・回避策・事前宣言との突き合わせ結果が記録される。
- [ ] UJD-S-5: フルパスを再現する e2e テストが追加され、journey curated / visual evidence / gate 解消 / merge precondition の各段を assert する。
- [ ] UJD-S-6: 実走で発見された断絶ごとに後続 Story が active に起票されている（0 件の場合はその旨をレポートに明記する）。

## 既存挙動（inherited behavior）

- The code-side pipeline (Story → Spec → Gate → PR) is unchanged.
- Existing gate activation conditions for non-UI stories are unchanged.
- `execute merge` preconditions are unchanged.

## Non Goals

- 3 本の前提 Story（journey-curate-command / flow-screenshot-visual-gate-bridge / visual-residual-local-runner）の実装そのもの。本 Story は経路の実証と固定に限定する。
- design-system derive の機能拡張。実走では現状機能をそのまま使い、不足は後続 Story 化する。
- 複数プロジェクトへの横展開。まず 1 本を完走させる。
