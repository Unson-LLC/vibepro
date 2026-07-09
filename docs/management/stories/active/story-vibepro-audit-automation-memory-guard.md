---
story_id: story-vibepro-audit-automation-memory-guard
title: "監査 automation memory の読み書きを決定的な preflight / commit 検証にする"
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "2026-07-09 の価値監査で automation memory 本体が欠落し、window 起点が automation prompt 埋め込みの Last run へのフォールバックで偶然救われた"
related_stories:
  - story-vibepro-automation-readable-value-audit
  - story-vibepro-idempotent-audit-persistence
  - story-vibepro-self-dogfood-audit-loop
parent_design: vibepro-audit-automation-memory-guard
architecture_docs:
  - docs/architecture/vibepro-audit-automation-memory-guard.md
spec_docs:
  - docs/specs/story-vibepro-audit-automation-memory-guard.md
created_at: 2026-07-09
updated_at: 2026-07-09
reason: "alternatives considered: keep memory continuity as a prompt instruction inside the automation (the 2026-07-09 run proves this fails silently when memory.md is absent), maintain a copy of last_run in a second file as passive redundancy (doubles the write surface without verifying either), or add a deterministic memory preflight/commit surface to the vibepro audit CLI that validates existence, parses last_run, records the fallback decision explicitly, and verifies write-then-read-back; selected the CLI guard. compatibility impact: `vibepro audit session-cost --automation-memory` keeps its existing behavior; the new `vibepro audit memory` subcommands are additive and the automation opts in by calling them. rollback plan: revert the audit memory guard module, its CLI wiring, this Story, the spec, and design-ssot links in one commit; automations fall back to today's prompt-driven handling. boundary and scope: the guard validates and persists window continuity metadata only; it never edits audit findings, token accounting, or gate artifacts, and it never invents a window start silently — a fallback is always an explicit, machine-readable decision. accepted followups: none for this PR."
---

# Story

2026-07-09 の VibePro 価値監査で、監査 window の正本であるはずの automation memory（`memory.md`）本体が欠落していた。今回の run は automation prompt に埋め込まれていた `Last run: 2026-07-08T00:01:57.465Z` を偶然読めたため window 起点を復元できたが、これは設計された冗長性ではない。memory が欠落しかつ prompt 側の手がかりも無い場合、監査は「約24時間前」という近似 window に黙って劣化し、window 境界のズレは PR の見落とし・二重計上として監査結果そのものを汚染する。

監査の連続性は監査基盤そのものの信頼性である。「memory を書き忘れない」「欠落に気づく」を automation prompt の注意書きに任せるのではなく、VibePro CLI 側に決定的な guard を置く: run 開始時の **preflight**（memory の存在検証・`last_run` 解析・欠落時の fallback 採用を明示的な機械可読レコードとして残す）と、run 終了時の **commit**（memory 書き込み→読み戻し検証→次回 preflight が解析可能なことの確認）である。

## User Story

**As a** 日次の VibePro 価値監査を実行する automation（および監査結果を読む operator）<br>
**I want** 監査 window の起点解決と automation memory の永続化が、欠落・破損・書き込み失敗を黙って通さない決定的なコマンドで行われること<br>
**So that** 監査 window の連続性が偶然の冗長性に依存せず、fallback が起きた事実も監査証跡として残る

## Scope

- `vibepro audit memory preflight --memory <path>`: memory ファイルの存在・解析可能性・`last_run` の ISO 8601 妥当性を検証し、`{ status: resolved|fallback|error, window_start, source, reason }` を機械可読 JSON で返す。欠落・解析不能時は `--fallback-last-run <iso>`（automation prompt 等の外部手がかり）または `--fallback-hours <n>`（近似 window）を明示指定した場合のみ fallback を採用し、採用した事実と根拠を結果に含める。
- `vibepro audit memory commit --memory <path> --last-run <iso> --window-start <iso> --window-end <iso>`: 継続性メタデータ（last_run / window 境界 / run note）を memory へ書き込み、直後に読み戻して preflight と同じ parser で解析可能なことを検証する。読み戻し不一致・解析不能は非ゼロ exit で失敗させる。
- 継続性メタデータは memory 冒頭の機械可読ブロックとして固定フォーマット化し、自由記述の findings セクション（既存の `## Key findings` 等）は保持・非破壊で扱う。
- preflight / commit の実行結果は `.vibepro/` 配下の audit continuity artifact としても保存し、後日の監査が「いつ fallback が起きたか」を再構成できるようにする。
- 事前宣言する数値目標: (1) memory 欠落・破損・last_run 不正の 3 状態すべてで preflight が黙って進まない（fallback 指定なしでは非ゼロ exit）、(2) commit 後の読み戻し検証は書き込み内容とバイト同一性ではなく parse 同値性で判定する、(3) 既存 memory の自由記述セクションが commit で失われない。

## Acceptance Criteria

- [ ] AMG-S-1: memory ファイルが存在し `last_run` が妥当な場合、preflight は `status=resolved` と window_start を返し、fallback レコードを作らない。
- [ ] AMG-S-2: memory が欠落または解析不能な場合、fallback オプション未指定の preflight は非ゼロ exit で止まり、`--fallback-last-run` または `--fallback-hours` 指定時のみ `status=fallback` と採用根拠を機械可読で返す。
- [ ] AMG-S-3: commit は書き込み直後の読み戻しで継続性メタデータの parse 同値性を検証し、不一致・解析不能を非ゼロ exit で報告する。
- [ ] AMG-S-4: commit は既存 memory の自由記述セクション（findings / session notes 等）を保持し、継続性ブロックだけを更新する。
- [ ] AMG-S-5: preflight / commit の結果は `.vibepro/` の audit continuity artifact として保存され、fallback 発生の有無・根拠・window 境界が後日再構成できる。
- [ ] AMG-S-6: 既存の `vibepro audit session-cost --automation-memory` の挙動は変化しない（回帰テストで固定）。

## 既存挙動（inherited behavior）

- The existing `--automation-memory` option on `vibepro audit session-cost` and `vibepro execute merge` is unchanged/existing; the new subcommands are additive.
- Audit token accounting, session attribution, and gate artifacts are unchanged; the guard touches window continuity metadata only.
- Automation prompt-driven fallback handling remains possible when the guard is not invoked; existing automations keep working unchanged.

## Non Goals

- automation scheduler（Codex cron 側）の変更。VibePro は呼ばれた時に決定的に振る舞う CLI surface を提供するだけで、呼び出し義務の enforcement は automation 定義側の責務。
- 監査ロジック本体（token/time 分解、価値判定）の変更。
- memory の findings セクションのスキーマ化（自由記述のまま保持する）。

## Runtime Evidence

- current_reality: 変更は audit memory guard モジュールの新設、`vibepro audit` への subcommand 配線、focused tests のみ。新規 scheduler・外部送信・デプロイ経路は追加しない。
- failure_modes: preflight の誤検知（妥当な memory を不正と判定）は非ゼロ exit で監査開始を止めるだけで、既存 memory を書き換えない。commit の書き込み失敗・読み戻し不一致は非ゼロ exit で明示され、部分書き込みは temp file + rename で防ぐ。

## Scenario Clauses

### Scenario: valid memory resolves the automation window

Given an automation memory file contains a parseable VibePro continuity block
When `vibepro audit memory preflight` is run without an explicit fallback
Then the command exits successfully with `status=ready`, returns the recorded `last_run`, and does not record fallback adoption.

### Scenario: missing or corrupt memory cannot silently continue

Given the automation memory file is missing or contains an unparsable continuity block
When `vibepro audit memory preflight` is run without `--fallback-last-run` or `--fallback-hours`
Then the command exits non-zero and reports a blocked preflight without mutating the memory file.

### Scenario: explicit fallback is auditable

Given the automation memory file is missing or corrupt
When `vibepro audit memory preflight` is run with an explicit fallback window
Then the command exits successfully with `status=fallback` and writes machine-readable fallback adoption metadata.

### Scenario: commit preserves memory and proves readback equivalence

Given an automation memory file already contains free-form notes
When `vibepro audit memory commit` writes `last_run`, `window_start`, and `window_end`
Then only the VibePro continuity block is replaced, free-form notes remain intact, and the command reports success only after parsing the written file back to equivalent values.

### Scenario: session meta entries remain attributed without changing audit selection

Given session-cost audit input contains `session_meta` entries
When session efficiency audit aggregation runs
Then those entries are used only for attribution and classification context, while explicit session selection behavior remains unchanged.
