---
story_id: story-vibepro-evidence-adjudication-gate
title: Evidence Adjudication Gate Architecture
parent_design: vibepro-evidence-adjudication-gate
---

# アーキテクチャ

## 判断

「この証拠はこのACの成果を実証しているか」は意味的判断であり、決定的コード（テキストトークン照合）で実装すると、照合条件の充足そのものが目的化して fake binding を正規動作として受理する（2026-07-13 SalesTailor Blueprint インシデント）。この判断を agent review と同じ委譲パターンで独立LLM adjudicatorへ移す。VibePro自身はLLMを呼ばず、(1) 裁定依頼書の生成、(2) 裁定結果の記録、(3) ゲートによる強制、のみを行う。

設計原則は3つ。**独立性**: 依頼書は実装エージェントと別のfresh context subagentでの実行を要求し、記録にはprovenance（agent-system / agent-id / session-ref）を必須にする。**意図アクセス**: 依頼書の一次コンテキストはgate JSONではなくStoryのAC原文であり、各clauseに紐づく検証証拠（observation含む）を並置して「証拠が成果を実証しているか」を反証の立場で問う。**正直な語彙**: verdict に `not_verifiable_by_automation` を用意し、自動検証不能な人間成果ACを正直に申告する出口を作る。正直な申告は罰でなく、人間検証（decision record）への明示ルートに接続する。

ゲートは advisory ではなく enforced にする。`evidence_adjudication` を unresolved-required 集計と critical 判定へ登録し、理由のみの waiver では通らない。prose規範はcontext compactionで蒸発するが、ゲートは毎回再出力されるため、強制点はゲート側に置くしかない。anti-vacuum として、ACが存在しないStoryへの `adjudicate prepare` は pass 相当の成果物を作らず明示エラーにする（「検査対象なし=問題なし」を再演しない）。

## 入力

- Story markdown の受け入れ基準 clause（traceability と同じ抽出器を再利用し、clause id / 全文を取得）
- `.vibepro/pr/<story-id>/verification-evidence.json` の command entries（kind / status / command / summary / observation）
- `vibepro adjudicate record` の CLI 引数（`--clause` / `--verdict` / `--reason` / `--agent-system` / `--agent-id` / `--session-ref`）
- 記録時の current HEAD commit（git rev-parse）
- `.vibepro/config.json` の `evidence_adjudication.enabled`（既定 true）
- decision record（`--source gate:evidence_adjudication` / status=accepted / reason / artifact）

## 出力

- `.vibepro/adjudication/<story-id>/adjudication-request.md`: clause全文＋紐づく証拠＋裁定者指示（独立fresh context・反証の立場・verdict 3値定義）
- `.vibepro/adjudication/<story-id>/adjudication.json`: clauseごとの `{ verdict, reason, provenance, head_commit, recorded_at }`
- `pr prepare` gate_dag への `evidence_adjudication` ノード:
  - 裁定なし / stale HEAD / clause不足 → `needs_evidence`（不足clause idをreasonへ列挙）
  - いずれかが `not_demonstrated` → `failed`（裁定理由をreasonへ含める）
  - いずれかが `not_verifiable_by_automation` → 人間検証要求付き `needs_evidence`。decision record（accepted + reason + artifact）でのみ解決
  - 全clauseがcurrent HEADの `demonstrated` → `passed`
- unresolved-required 集計（overall_status / ready_for_pr_create）と critical 判定への反映

## 境界

- VibePro自身はLLM API を呼ばない（委譲パターン維持）。裁定の実行はcoordinatorが起動するsubagentの責務
- agent_review gate とは独立。agent review は「変更の質」、adjudication は「証拠とACの意味的整合」を裁く
- 裁定transcriptの自動品質採点はしない（fake-value-hardening の Non-Goal を維持）
- verify record のstatus語彙は変更しない。正直な語彙は adjudication verdict 側に置く
- traceability のトークン照合は残置する（弱いシグナルとして有用。強制点は adjudication へ移る）
- `evidence_adjudication.enabled: false` で明示オプトアウト可能。adjudication成果物がない既存リポジトリでも `pr prepare` はクラッシュしない
