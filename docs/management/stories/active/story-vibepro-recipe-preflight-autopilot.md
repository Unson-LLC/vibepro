---
story_id: story-vibepro-recipe-preflight-autopilot
title: "dogfood で学習した非自明レシピを autopilot preflight として製品に吸収する"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "PR #292（初見・レビュー4R・約40コマンド）と #293（レシピ学習済み・1R一発）の差はレシピ知識であり、それが人とメモに依存している"
related_stories:
  - story-vibepro-pr-evidence-autopilot
  - story-vibepro-evidence-summary-reuse-refresh
  - story-vibepro-gate-efficiency-fast-readiness
parent_design: vibepro-recipe-preflight-autopilot
architecture_docs:
  - docs/architecture/vibepro-recipe-preflight-autopilot.md
spec_docs:
  - docs/specs/story-vibepro-recipe-preflight-autopilot.md
created_at: 2026-07-07
updated_at: 2026-07-07
reason: "alternatives considered: keep recipes in operator memos (stays person-bound), encode recipes as documentation only (agents still rediscover them at runtime), or encode each recipe as a deterministic preflight check with an auto-fix or exact next command inside pr autopilot; selected the deterministic preflight registry. compatibility impact: pr autopilot gains a preflight phase and report section; no existing gate semantics, artifact schema, or command output field is removed; auto-fixes only produce artifacts that operators previously produced by hand. rollback plan: revert the preflight registry module, its autopilot wiring, this Story, the spec, and design-ssot links in one commit. boundary and scope: preflight detects and repairs evidence-shape pitfalls before gate evaluation; it never overrides gate verdicts, waives gates, or fabricates verification results. accepted followups: none for this PR."
---

# Story

VibePro フローを一度通した agent は速い。#292 は初見でレビュー 4 ラウンド・フルスイート 2 回・約 40 コマンドを要したが、直後の #293 はレシピ学習済みで 1 ラウンド一発 pass だった。差を生んだのは dogfood メモに蓄積された非自明レシピ — 例: 実 exit code から生成した status JSON を `--artifact` 添付しないと judgment spine が strong にならない、generic 語のみの record は contract clause ID を本文に含めないとマッチしない、architecture gate の ADR 不要宣言は story frontmatter の `reason:` キー、followup decision は `--reason` と `--artifact` の両方が必要、design_diagrams は final spec の `diagrams[]` のみ、手書き Story は `.vibepro/config.json` の `brainbase.stories[]` へ登録、`review record` には `--inspection-input` が必要、等。

これらが人（agent の都度学習）とメモに依存している限り、初見 story は毎回 #292 のコストを払う。レシピを決定的な preflight チェックとして `pr autopilot` に吸収し、検出→自動修復（安全なもの）または正確な next command 提示（判断を伴うもの）に変える。

## User Story

**As a** 初見の story を VibePro で通す agent<br>
**I want** `pr autopilot` がレシピ既知の落とし穴を gate 評価前に検出し、安全なものは自動修復・それ以外は正確なコマンドで指示すること<br>
**So that** 初回 story でも学習済み 2 回目相当の往復回数で PR まで到達できる

## Scope

- レシピレジストリ: 各レシピを `{ id, detection, action }` の決定的チェックとして実装する。`action` は `auto_fix`（副作用が operator の既存手作業と同一のもの）か `next_command`（正確なコマンド文字列と理由）のいずれか。
- 初期収載レシピ（最低 6 件）:
  1. pass の verify record に status artifact が無い → 記録済み exit code から status JSON を生成し添付（auto_fix）。
  2. generic 語のみの record 本文に contract clause ID が無い → 必要 clause ID を明示した記録し直しコマンドを提示（next_command）。
  3. architecture gate が ADR を要求し story frontmatter に `reason:` が無い → 必要 4 要素（alternatives/compatibility/rollback/boundary）のテンプレを提示（next_command）。
  4. followup decision に `--artifact` が無く axis が accepted_followup にならない → artifact 付き再記録コマンドを提示（next_command）。
  5. design_diagrams gate の必要図が final spec の `diagrams[]` に無い → draft/doc セクションでは検出されない旨と `spec write --final` 手順を提示（next_command）。
  6. story id がカタログ未登録で diagnose が解決しない → `.vibepro/config.json` `brainbase.stories[]` へのエントリ追記（auto_fix、追記内容を報告に明示）。
- `pr autopilot` の実行冒頭に preflight フェーズを追加し、検出・修復・提示の結果を autopilot 報告の `preflight` セクションとして機械可読に出す。
- 事前宣言する数値目標: (1) 上記 6 レシピが synthetic テストで検出される、(2) auto_fix は operator が従来手作業で作っていた artifact とスキーマ同一の成果物を作る、(3) preflight は gate verdict を一切書き換えない。

## Acceptance Criteria

- [ ] RPA-S-1: 収載 6 レシピそれぞれについて、該当状態を作った synthetic リポジトリで preflight が検出し、`auto_fix` または `next_command` を報告する。
- [ ] RPA-S-2: auto_fix の成果物（status JSON artifact、カタログエントリ）は手作業版とスキーマ互換で、後続の gate 評価が strong/resolved と判定する。
- [ ] RPA-S-3: preflight は gate の判定結果・waiver・review verdict を作成も変更もしない。
- [ ] RPA-S-4: 該当なしの story では preflight は no-op で、autopilot の既存挙動が変化しない。
- [ ] RPA-S-5: preflight 結果は autopilot 報告の `preflight` セクションに `{ recipe_id, detected, action_taken, next_command }` の機械可読形式で出る。
- [ ] RPA-S-6: レシピ追加が registry へのエントリ追加だけで済む構造であることをテストが固定する（既存レシピの変更なしに 7 件目を追加できる）。

## 既存挙動（inherited behavior）

- Gate evaluation semantics, waiver rules, and review lifecycle rules are unchanged.
- Existing `pr autopilot` phases and their outputs are unchanged; preflight is additive and runs first.
- Verify record, decision record, and spec write command contracts are unchanged; preflight only invokes or suggests them.

## Non Goals

- gate 自体の緩和・自動 waiver（preflight は証跡の形の落とし穴だけを扱う）。
- レシピの自動学習（本 Story は既知レシピの手動収載。学習パイプラインは将来 story）。
- レビュー subagent への指示文改善（dispatch テンプレ側の責務）。

## Runtime Evidence

- current_reality: 変更はレシピ registry モジュールの新設、`pr autopilot` への preflight 配線、focused tests のみ。新規 CLI コマンド・scheduler・外部送信・デプロイ経路は追加しない。
- failure_modes: 検出の偽陽性は next_command 提示に留まり破壊的変更を起こさない。auto_fix の失敗は preflight 報告に failed として明示し、autopilot は従来フローを続行する（preflight 失敗で全体を止めない）。
