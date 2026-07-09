---
story_id: story-vibepro-session-attribution-boundary-guard
title: "mixed parent session の attribution 汚染を検知し story 境界を仕組みで守る"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "2026-07-09 の価値監査で親 session 019f3f8c が複数 UI/UX story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った"
related_stories:
  - story-vibepro-session-efficiency-audit
  - story-vibepro-canonical-audit-cost-accounting
  - story-vibepro-audit-automation-memory-guard
parent_design: vibepro-session-attribution-boundary-guard
architecture_docs:
  - docs/architecture/vibepro-session-attribution-boundary-guard.md
spec_docs:
  - docs/specs/story-vibepro-session-attribution-boundary-guard.md
created_at: 2026-07-09
updated_at: 2026-07-09
reason: "alternatives considered: keep session separation as an operator habit documented in skills (two consecutive audits prove it does not hold), hard-block vibepro commands when the inferred session already contains another story's work (too destructive — mixed sessions are sometimes legitimate, e.g. cross-story triage), or detect mixed-parent contamination deterministically and surface it as first-class attribution risk in both audit output and pr artifacts; selected detection-and-surface. compatibility impact: `vibepro audit session-cost` output gains an `attribution` section; existing fields are unchanged. `pr prepare` gains an advisory session-boundary note in its artifact; no gate semantics change. rollback plan: revert the attribution detector module, its session-cost and pr prepare wiring, this Story, the spec, and design-ssot links in one commit. boundary and scope: the guard classifies and reports attribution risk; it never blocks work, never rewrites session logs, and never reassigns tokens between stories — it makes the divergence visible so audits and operators stop over-attributing parent sessions to single stories. accepted followups: none for this PR."
---

# Story

価値監査が 2 回連続で同じ構造問題を指摘している: 複数 story を混載した親 session（例: `019f3f8c-9228-7bc2-b5f3-2b3a5745de98` は `docs-feature-map` と `style-preset-token-gate` を混載）では、strict story attribution と worktree-bound attribution の乖離が大きく、親 session 全体を単一 story の工数として読むと過大評価になる。現状この乖離の測定は automation 側の外部スクリプト（`session-time-efficiency.mjs`）に依存し、VibePro 製品側には mixed parent を検知・警告する surface がない。「session を story ごとに分ける」という運用ルールだけでは横ばいのままである。

最大のロスは token ではなく attribution 汚染である。VibePro 側に決定的な検知を置く: (1) `vibepro audit session-cost` が session event を story worktree / story id / branch で分類し、strict・worktree-bound の両 attribution と乖離度を第一級の出力にする。(2) `pr prepare` が推定 session 内に他 story の作業痕跡を検知した場合、mixed-parent の事実を pr artifact に advisory として記録し、監査が後日その PR の工数を読み違えないようにする。

## User Story

**As a** 価値監査 automation と、複数 story を並行して進める operator/agent<br>
**I want** mixed parent session の attribution 乖離が VibePro 自身の出力で機械可読に検知・記録されること<br>
**So that** 親 session の壁時計時間・token を単一 story に過大帰属する読み違いが、外部スクリプトと注意力に依存せず防げる

## Scope

- `vibepro audit session-cost` に `attribution` セクションを追加: session 内 event を story 手がかり（story id・worktree path・branch 名・`.vibepro/pr/<story>` artifact パス）で分類し、`strict_story_events` / `worktree_associated_events` / `other_story_events` / `unclassified_events` の件数と token 概算、および `mixed_parent: true|false` と乖離度（strict ÷ associated）を返す。
- 乖離度が宣言済み閾値（初期値: strict が associated の 50% 未満）を超えた場合、`attribution_risk: high` を出力し、監査 automation がスクリプトなしで同じ判定を再現できるようにする。
- `pr prepare --session-id <id>|auto` 実行時に同じ検知を走らせ、mixed parent が検知された場合は `pr-prepare.json` に `session_boundary` note（検知した他 story id と event 割合）を advisory として保存する。gate 判定は変更しない。
- 事前宣言する数値目標: (1) 混載 synthetic session で `mixed_parent=true` と他 story id が検出される、(2) 単一 story session では `mixed_parent=false` で既存出力に差分がない、(3) attribution セクションの分類合計は session 全 event 数と一致する（取りこぼしは unclassified に入る）。

## Acceptance Criteria

- [ ] SAB-S-1: 2 つ以上の story 手がかりを含む synthetic session に対し、session-cost の `attribution` が `mixed_parent=true`・検知した story id 一覧・strict/associated の乖離度を返す。
- [ ] SAB-S-2: 単一 story の synthetic session では `mixed_parent=false` となり、既存の token_accounting / artifact_token_accounting 出力はバイト同一で変化しない。
- [ ] SAB-S-3: 分類は決定的で、`strict + associated_only + other_story + unclassified` の event 件数合計が session の対象 event 総数に一致する。
- [ ] SAB-S-4: 乖離度が閾値を超えた場合のみ `attribution_risk: high` が出力され、閾値は artifact に明示される。
- [ ] SAB-S-5: mixed parent 検知時の `pr prepare` は `pr-prepare.json` に `session_boundary` note を保存し、gate_status・gate verdict・next_commands は変化しない。
- [ ] SAB-S-6: session が推定できない場合（--session-id なし・infer 失敗）は attribution セクションを `unavailable` として明示し、黙って省略しない。

## 既存挙動（inherited behavior）

- Existing `vibepro audit session-cost` token accounting fields and `--window-start/--window-end` semantics are unchanged/existing.
- `pr prepare` gate evaluation, gate_status, and next_commands derivation are unchanged; the session_boundary note is additive and advisory.
- Session inference via `--session-id auto` / `--infer-session` is unchanged; the detector consumes its result.

## Non Goals

- session の強制分割・block（mixed session にも正当な用途があるため、本 story は検知と可視化に限定する）。
- token の story 間再配賦アルゴリズム（乖離の可視化まで。配賦は監査側の判断に残す）。
- Codex/Claude 側の session 管理 UI 変更。

## Runtime Evidence

- current_reality: 変更は attribution detector モジュールの新設、session-cost / pr prepare への配線、synthetic session fixture を使った focused tests のみ。session JSONL は read-only で扱い、新規外部送信・デプロイ経路は追加しない。
- failure_modes: 分類の誤検知は advisory 出力に留まり gate・PR 進行を止めない。session JSONL の読取失敗は attribution セクションを `unavailable` + 理由付きで明示し、session-cost 全体は従来どおり動作する。
