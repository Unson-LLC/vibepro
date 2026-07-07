---
story_id: story-vibepro-pr-artifact-size-budget
title: "pr prepare artifact に per-file サイズ予算を課し、LLM handoff は bounded summary を既定にする"
status: active
view: dev
period: 2026-07
source:
  type: value_audit_followup
  title: "salestailor STR-144 実測で design-ssot-reconciliation.json 101KB / decision-index.json 41KB が handoff 読込対象に残っている"
related_stories:
  - story-vibepro-evidence-cost-budget
  - story-vibepro-bounded-artifact-view
  - story-vibepro-audit-bundle-budget
parent_design: vibepro-pr-artifact-size-budget
architecture_docs:
  - docs/architecture/vibepro-pr-artifact-size-budget.md
spec_docs:
  - docs/specs/story-vibepro-pr-artifact-size-budget.md
created_at: 2026-07-07
updated_at: 2026-07-08
reason: "alternatives considered: shrink the full-fidelity artifacts themselves (loses machine-readable SSOT detail), hard-fail pr prepare on oversized artifacts (blocks existing repos retroactively), or generate bounded summary siblings and route LLM handoff surfaces through them while keeping full artifacts on disk; selected bounded summary siblings. compatibility impact: all existing artifacts keep their full content and paths; new .summary.json siblings and an artifact_budget report section are additive; handoff documents change which path they reference by default. rollback plan: revert src/pr-manager.js summary generation and handoff reference changes, this Story, the spec, and design-ssot links in one commit. boundary and scope: only pr prepare artifact emission and handoff-surface references change; gate evaluation reads full artifacts as before. accepted followups: none for this PR."
---

# Story

bounded-artifact-view で「full artifact dump を既定の LLM handoff にしない」方針は入ったが、`pr prepare` が生成する artifact 自体には per-file のサイズ予算がなく、大物が handoff 読込対象に残っている。salestailor の実運用 STR-144 で実測すると、`design-ssot-reconciliation.json` が **101KB**（LLM が読めば約 25k tokens）、`decision-index.json` が 41KB、story 1 本の `.vibepro/pr/` 合計は約 1.3MB。subagent dispatch や review 準備でこれらを読む度に、token と時間が本体作業と無関係に消える。

full-fidelity な JSON は機械可読の正本として維持しつつ、サイズ予算を超えた artifact には bounded summary（件数・結論・full 版へのポインタ）を自動生成し、LLM handoff 面（pr-body / parallel-dispatch / cockpit の参照）を summary 側に既定で向ける。

## User Story

**As a** VibePro の story を処理する agent（および dispatch を書く coordinator）<br>
**I want** handoff で読む artifact が予算内の bounded summary であり、深掘りが必要な時だけ full 版へ辿れること<br>
**So that** story 1 本あたりの handoff token が artifact の肥大と無関係に一定に収まる

## Scope

- `pr prepare` に per-artifact サイズ予算（既定 16KB、`.vibepro/config.json` で上書き可）を導入する。
- 予算超過の JSON artifact には `<name>.summary.json`（schema_version・結論フィールド・主要件数・超過理由・full 版への相対パス）を自動生成する。
- LLM handoff 面（`pr-body.md` の artifact 参照、`parallel-dispatch.md` の読込指示、bounded artifact view の既定解決）は、summary が存在する artifact については summary 側を参照する。
- `pr-prepare.json` に `artifact_budget` セクション（予算値・超過 artifact 一覧・summary 生成結果）を追加する。
- 事前宣言する数値目標: (1) summary は元 artifact の 10% 以下のバイト数、(2) handoff 面の既定参照から予算超過の full 版が消える、(3) full 版は従来パスに従来内容のまま存在する。

## Acceptance Criteria

- [x] PAB-S-1: 予算超過の JSON artifact に `<name>.summary.json` が生成され、結論・主要件数・full 版パスを含む。
- [x] PAB-S-2: 予算内の artifact には summary が生成されず、handoff 参照も従来どおり full 版を指す。
- [x] PAB-S-3: `pr-prepare.json` の `artifact_budget` が予算値・超過一覧・summary パスを機械可読で報告する。
- [x] PAB-S-4: `parallel-dispatch.md` の読込指示が、summary 存在時に summary パスを指し full 版の inline 読込を指示しない。
- [x] PAB-S-5: gate 評価は従来どおり full artifact を読み、gate の判定結果は本 Story の前後で変化しない。
- [x] PAB-S-6: 予算は `.vibepro/config.json` で設定でき、未設定時の既定値が文書化されている。
- [x] PAB-S-7: テストが超過/非超過/設定上書き/dispatch 参照切替の各経路を固定する。

## 既存挙動（inherited behavior）

- Full-fidelity artifact generation paths and file names under `.vibepro/pr/<story-id>/` are unchanged.
- Gate evaluation inputs are unchanged; gates keep reading full artifacts.
- The bounded artifact view command surface is unchanged; only its default resolution gains summary awareness.
- Existing `pr-prepare.json` fields are unchanged; `artifact_budget` is additive.

## Non Goals

- full artifact 自体の内容削減・スキーマ変更。
- canonical audit（merge 後持ち回り）側の予算（story-vibepro-audit-bundle-budget の責務）。
- 証跡を「最初から浅く作る」深さ制御（story-vibepro-evidence-cost-budget の責務）。

## Runtime Evidence

- current_reality: 変更は `src/pr-manager.js` の artifact 出力後処理（summary 生成・budget 報告）と handoff 文書生成の参照先、focused tests のみ。新規コマンド・scheduler・外部送信は追加しない。
- failure_modes: summary 生成失敗は artifact_budget に failed として明示し、handoff は full 版参照に fallback する（handoff が壊れるより token 超過を許容する）。summary と full の乖離は summary に元 artifact の content hash を埋めて検出可能にする。
