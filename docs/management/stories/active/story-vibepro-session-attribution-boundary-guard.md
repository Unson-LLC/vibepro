---
story_id: story-vibepro-session-attribution-boundary-guard
title: "mixed parent session の attribution 汚染を検知し story 境界を仕組みで守る"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った"
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
updated_at: 2026-07-18
reason: "alternatives considered: keep session separation as an operator habit, hard-block all mixed sessions, or make strict story attribution primary while retaining worktree-associated attribution as an explicit upper bound; selected strict-primary attribution with readiness degradation. compatibility impact: existing accounting fields remain additive, but mixed-parent sessions no longer report audit readiness as ready. rollback plan: remove the readiness blocker while preserving the attribution projection. boundary and scope: the guard does not reassign tokens or block development commands; it prevents a mixed parent from being treated as audit-ready evidence for one story."
---

# Story

価値監査が 2 回連続で同じ構造問題を指摘している: 複数 story を混載した親 session（例: `019f3f8c-9228-7bc2-b5f3-2b3a5745de98` は `docs-feature-map` と `style-preset-token-gate` を混載）では、strict story attribution と worktree-bound attribution の乖離が大きく、親 session 全体を単一 story の工数として読むと過大評価になる。設定baseにはStory cueの初期検出と非blockingな`session_boundary` advisoryは既に存在したが、strict/associated/other/unclassifiedの排他的分類、乖離率、mixed-parent readinessを同じsession-cost契約で返すsurfaceは未完成だった。外部スクリプト（`session-time-efficiency.mjs`）に依存した測定と「session を story ごとに分ける」という運用ルールだけでは横ばいのままである。

最大のロスは token ではなく attribution 汚染である。VibePro 側に決定的な検知を置く: (1) `vibepro audit session-cost` が session event を story worktree / story id / branch で分類し、strict・worktree-bound の両 attribution と乖離度を第一級の出力にする。(2) `pr prepare` は runtime session id・branch・HEAD の境界だけを pr artifact に advisory として記録し、mixed-parent 判定を `audit session-cost` へ明示的に委ねる。これにより監査は後日、PR の工数を同じ CLI で再判定できる。

## User Story

**As a** 価値監査 automation と、複数 story を並行して進める operator/agent<br>
**I want** mixed parent session の attribution 乖離が VibePro 自身の出力で機械可読に検知・記録されること<br>
**So that** 親 session の壁時計時間・token を単一 story に過大帰属する読み違いが、外部スクリプトと注意力に依存せず防げる

## Scope

- `vibepro audit session-cost` に `attribution` セクションを追加: session 内 event を story 手がかり（story id・worktree path・branch 名・`.vibepro/pr/<story>` artifact パス）で分類し、`strict_story_events` / `worktree_associated_events` / `other_story_events` / `unclassified_events` の件数、および `mixed_parent: true|false` と乖離度（strict ÷ associated）を返す。
- 乖離度が宣言済み閾値（初期値: strict が associated の 50% 未満）を超えた場合、`attribution_risk: high` を出力し、監査 automation がスクリプトなしで同じ判定を再現できるようにする。
- strict story cue による attribution を主値、strict + worktree-associated を上限値として同時表示する。
- mixed parent が検知された場合、開発 gate は変更しないが session-cost の `audit_readiness` は `partial` に落とし、単一 story の確定コストとして使わせない。
- 事前宣言する数値目標: (1) 混載 synthetic session で `mixed_parent=true` と他 story id が検出される、(2) 単一 story session では `mixed_parent=false` で既存出力に差分がない、(3) attribution セクションの分類合計は session 全 event 数と一致する（取りこぼしは unclassified に入る）。

## Acceptance Criteria

- [x] SAB-S-1: 2 つ以上の story 手がかりを含む synthetic session に対し、session-cost の `attribution` が `mixed_parent=true`・検知した story id 一覧・strict/associated の乖離度を返す。
- [x] SAB-S-2: 単一 story の synthetic session では `mixed_parent=false` となり、既存の token_accounting 値と artifact_token_accounting の semantic bucket totals は変化しない。
- [x] SAB-S-3: 分類は決定的で、`strict + associated_only + other_story + unclassified` の event 件数合計が session の対象 event 総数に一致する。
- [x] SAB-S-4: strict ÷ associated が閾値を下回る場合のみ `attribution_risk: high` が出力され、mixed parent は別の readiness blocker として扱われ、閾値は artifact に明示される（実装: `src/session-efficiency-audit.js`; 回帰: `test/session-efficiency-audit.test.js`）。
- [x] SAB-S-5: `pr prepare` は runtime session id の有無を非 blocking な `session_boundary` note に保存し、mixed session の判定を `audit session-cost` へ明示的に委ねる。
- [x] SAB-S-6: session が推定できない場合（--session-id なし・infer 失敗）は attribution セクションを `unavailable` として明示し、黙って省略しない。

## 既存挙動（inherited behavior）

- Existing `vibepro audit session-cost` token accounting fields and `--window-start/--window-end` semantics are unchanged/existing.
- `pr prepare` gate evaluation, gate_status, and next_commands derivation are unchanged; the session_boundary note is additive and advisory.
- Session inference via `--session-id auto` / `--infer-session` is unchanged; the detector consumes its result.

## Non Goals

- session の強制分割・開発 command の block（ただし audit readiness は確定扱いしない）。
- token の story 間再配賦アルゴリズム（乖離の可視化まで。配賦は監査側の判断に残す）。
- Codex/Claude 側の session 管理機構の変更。

## Runtime Evidence

- `current_reality`: 変更は既存session parser上のattribution detector、session-cost出力、pr prepareのadvisory note、synthetic fixtureに限定する。session JSONLはread-onlyで、新規外部送信・デプロイ経路は追加しない。
- `invariants`: eventはstrict、worktree-associated、other-story、unclassifiedのどれか一つへ入り、合計は対象event数と一致する。単一Story sessionの既存token accountingは変えない。
- `boundaries`: strict attributionを主値、worktree-associatedを上限として表示するだけでtokenを再配賦しない。mixed parentは開発gateを止めず、監査readinessだけをpartialへ落とす。
- `failure_modes`: cue誤検知はadvisoryに留める。session未解決・JSONL読取失敗は`unavailable`と理由を返す。個別のmalformed rowは欠落させず`unclassified`へ保持し、valid rowの部分集計にはparse coverageとblockerを付けてcomplete扱いしない。
- `done_evidence`: current-head unitとtypecheckが6 AC、負経路、出力互換、review surfaceを固定し、独立Agent ReviewとAC/judgment adjudicationがscopeとfailure policyを確認する。
