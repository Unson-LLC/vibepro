---
story_id: story-vibepro-progress-heartbeat-policy-kernel
title: 進捗ハートビートpolicy kernelの抽出とgraphify/verification-runnerへの採用
status: active
view: dev
period: 2026-08
category: platform
source:
  type: operator_feedback
  title: "src配下37箇所の長時間実行バウンドのうち理想形を満たすのはevaluateProgressBounds 1箇所のみ。バウンド皆無の子プロセスと進捗シグナル破棄サイトを正本kernelへ寄せたい"
related_stories:
  - story-vibepro-agent-runtime-adapters
reason: "alternatives considered: (a) 各サイトへ個別にtimeout/killを増設する、(b) 外部ライブラリ(p-timeout等)採用、(c) evaluateProgressBounds(src/codex-subagent-runtime-adapter.js)の意味論を副作用なしのpolicy kernelとして共有モジュールへ抽出し採用サイトを段階移行する — (c)を選択。(a)は既に複製病(素朴runProcess 2箇所・group-kill 3種・withTimeout 3種)を悪化させ、(b)は単調進捗による延命・コスト/attempts独立キャップ・kill原因の構造化帰属という既存意味論を表現できない。compatibility impact: evaluateProgressBoundsの既存呼び出し(CDI-S-5系テスト群)の意味論を保存したままkernelへ委譲する。graphify updateとverification-runnerの外形コントラクト(戻り値スキーマ・証跡フィールド)は維持し、timed_out誤帰属の修正はstop_reason構造化コードの追加として行う。rollback plan: kernelモジュールは純関数のため、採用サイトごとにimportを旧実装へ戻すだけで独立にロールバック可能。boundary and scope: 本Storyはkernel抽出+graphify-adapter+verification-runnerの採用まで。pr-manager autopilot shell / performance-measurer / independent-review-orchestratorへの採用と、素朴spawn+setTimeout新規実装のlint検出はfollowup Storyへ分割する。"
created_at: 2026-08-02
updated_at: 2026-08-02
---

# 進捗ハートビートpolicy kernelの抽出とgraphify/verification-runnerへの採用

## User Story

**As a** VibePro CLIの運用者
**I want** 長時間実行される子プロセス（graphify update・検証スイート）が「単調な進捗がある限り生き、進捗が止まれば構造化された原因コードとともに確実に死ぬ」こと
**So that** story diagnoseの無限ハングや、外部SIGTERMをtimeoutと誤記録する証跡汚染が起きず、kill原因が常に監査可能になる

## Background

2026-08-02の全数調査で、src配下の長時間実行を切る/待つ実装は37箇所。理想形4要素を全て満たすのは `evaluateProgressBounds`（src/codex-subagent-runtime-adapter.js）ただ1箇所:

- P1: 単調進捗checkpoint（重複ID拒否）によるデッドライン延長
- P2: 独立ハードキャップ（wall-clock / cost / attempts）
- P3: SIGTERM→猶予→SIGKILL の段階的終了
- P4: kill原因の構造化帰属（5種のstop_reason.code）

一方で:

- graphify-adapter.js の `runProcess` はtimeout削除済みコピーで、story diagnoseがハング可能・stdout蓄積無制限
- verification-runner.js はexecFile全バッファ実行で実行中の進捗観測が不可能なうえ、`error.killed && signal` によるtimedOut判定が外部SIGTERMを `timed_out: true` と偽記録する（実際に誤診事故が発生済み）

## Design Principle

ハートビート（生存応答）では延命しない。**単調な進捗値の増加のみが延命し**、wall-clock/cost/attemptsは独立の最終防壁。kill原因は必ず構造化コードで証跡に残し、外部killとpolicy killを区別する。

## Scope

- `evaluateProgressBounds` の意味論を副作用なしのpolicy kernel（`createProgressDeadline`: `observe(単調進捗値)` / `check()` → verdict `{ok | kill(cause)}`、clock注入、重複進捗の延命拒否、`no_progress` / `hard_cap` / `external_signal` のcause発行）として src の共有モジュールへ抽出する。
- codex-subagent-runtime-adapter.js の既存判定をkernel委譲へ置換し、CDI-S-5系テスト群（test/codex-subagent-host.test.js ほか）の意味論を保存する。
- graphify-adapter.js の `runProcess` をkernel採用版へ置換する（wall-clockキャップ・stdout上限・SIGTERM→猶予→SIGKILL・構造化stop_reason）。
- verification-runner.js をexecFile→spawn化し、テスト完了数パーサをストリーミング適用して単調進捗として `observe` する。外部SIGTERMの `timed_out` 誤帰属を修正し、policy kill と external kill を区別した構造化帰属を証跡へ残す。

## Out of Scope（followup Storyへ分割）

- pr-manager autopilot検証シェル / performance-measurer / independent-review-orchestrator へのkernel採用
- 素朴な spawn+setTimeout+SIGTERM 新規実装を検出する skills lint / hook
- group-kill 3種・mkdirロック4種の統合

## Acceptance Criteria

- AC1: policy kernelは純関数+注入clockで構成され、`observe` に同一進捗値を渡してもデッドラインが延長されない（重複進捗の延命拒否）。
- AC2: kernelの `check()` は `no_progress` / `hard_cap`（wall_clock・cost・attempts別）/ `external_signal` を区別した構造化causeを返す。
- AC3: codex-subagent-runtime-adapterの既存テスト（CDI-S-5系）が変更なしまたは意味論保存の最小変更で全通過する。
- AC4: graphify update子プロセスは進捗停止時・wall-clock超過時に SIGTERM→猶予→SIGKILL で終了し、stop_reasonが証跡に残る。stdout蓄積に上限がある。
- AC5: verification-runnerは実行中にテスト完了数をストリーミング観測し、進捗が続く限り延命する。外部SIGTERMで殺された実行は `timed_out: false` かつ external kill として帰属される。
