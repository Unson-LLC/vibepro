---
title: "進捗ハートビートpolicy kernelアーキテクチャ"
status: accepted
created_at: 2026-08-02
updated_at: 2026-08-02
related_stories:
  - story-vibepro-progress-heartbeat-policy-kernel
parent_design:
  - vibepro-progress-heartbeat-policy-kernel
---

# 進捗ハートビートpolicy kernelアーキテクチャ

## Intent

長時間実行される子プロセス（graphify update・検証スイート・Codex subagent）を「単調な進捗がある限り生かし、進捗が止まれば構造化された原因コードとともに確実に殺す」という単一の意味論の下に置く。この意味論は`evaluateProgressBounds`（`src/codex-subagent-runtime-adapter.js`）1箇所にのみ存在していた。本StoryはそれをI/Oもタイマーも持たない副作用なしのpolicy kernel（`src/progress-deadline.js`）として抽出し、`graphify-adapter.js`と`verification-runner.js`という、素朴なタイムアウトすら持たない/外部SIGTERMを誤帰属する2つの実採用サイトへ委譲する。

## Kernel API Contract

`createProgressDeadline(options)`は`{ observe, check }`を返す純関数コンストラクタ。すべての「現在時刻」は注入された`now()`から、すべての「進捗」は明示的な`observe()`呼び出しから得る。タイマーもchild_processもI/Oもkernel内部には存在しない — enforcement（SIGTERM→猶予→SIGKILLの実発火）は採用側の責務。

| 要素 | 契約 |
|---|---|
| `observe(progressValue, { at? })` | `progressValue`を文字列化してSetで既知集合と照合する。**未見のトークンだけ**no-progressクロックを進める（`lastProgressAtMs`を更新）。既知トークンの再提示（ハートビート）はfalseを返し、クロックを一切動かさない。`null`/`undefined`は無視されfalseを返す。 |
| `check({ attempts?, costUsd? })` | precedence順（wall clock → attempts → cost → cost_accounting_unavailable → no_progress）で5種のcause codeを評価し、`{ ok: true }`または`{ ok: false, kill: { code, message, details } }`を返す。 |
| `classifyTermination({ signal, sentSignals })` | 死んだプロセスの終了シグナルを、kernel自身が送った集合（`sentSignals`）と照合し、`policy_kill`（自分が殺した）か`external_signal`（自分以外が殺した）かを判定する純関数。 |

**設計原則**:

- **ハートビートは延命しない。単調な進捗値の増加のみが延命する。** `observe`は同一トークンの再提示を拒否する（AC1）。graphify-adapterでは累積バイト数、verification-runnerでは`node --test`が吐く完了テスト数、codex-subagent-runtime-adapterではcheckpoint idとpartial_resultのjudgment idが進捗トークンになる。
- **wall-clock / cost / attemptsは進捗が絶対に延長できない独立ハードキャップ。** `check()`は`no_progress_deadline_ms`の遠さに関係なく、経過時間・試行回数・累計コストが上限を超えていれば即killを返す。
- **5種のcause codeとprecedence順は固定契約。** `max_wall_clock_exceeded` → `max_attempts_exceeded` → `max_cost_exceeded` → `cost_accounting_unavailable`（コスト計測必須だが計測不能なままno-progress期限超過）→ `no_progress_deadline_exceeded`。同時に複数条件が真でも、この順で最初に該当したcodeだけが返る（AC2）。
- **kill原因は必ず構造化コードで残す。** `check()`の`kill.code`と`classifyTermination()`の`kind`/`signal`が、証跡へそのまま転記される一次情報になる。

## Adoption: src/codex-subagent-runtime-adapter.js（既存の移行元）

`evaluateProgressBounds`は`createProgressDeadline`へ丸ごと委譲するよう置き換えられた。呼び出しごとに新しいkernelインスタンスを構築し、`replayProgressEvents`が永続化済みイベントログ（`checkpoint_id`付きイベント・`partial_result`イベント）を`observe(..., { at })`で再生することで、旧`lastUniqueProgressAt()`と同じ「イベント順でfirst-seen-wins」なdedupeを再現する。戻り値は`verdict.ok ? null : stalled(verdict.kill.code)`で、`stalled()`は`{ status: 'stalled', message, stop_reason: { code, message, details } }`という既存の公開契約シェイプを保つ（AC3）。CDI-S-5系テスト群（`test/codex-subagent-runtime-adapter.test.js`）は無変更で全通過する。

## Adoption: src/graphify-adapter.js（新規バウンド追加）

`graphify update`の子プロセスは従来バウンド皆無で、story diagnoseを無期限にハングさせ得た。エクスポートされた`runProcess(command, args, options)`が`spawn`をkernelで包む:

- 累積stdout+stderrバイト数を進捗トークンとして`observe`する（出力が増え続ける限り生きる）。
- `GRAPHIFY_MAX_WALL_CLOCK_MS`（既定10分）・`GRAPHIFY_NO_PROGRESS_DEADLINE_MS`（既定2分）・`GRAPHIFY_TERMINATION_GRACE_MS`（既定5秒）・`GRAPHIFY_MAX_OUTPUT_BYTES`（既定4MiB）はすべてエクスポートされた名前付き定数で、`options`（`maxWallClockMs`/`noProgressDeadlineMs`/`terminationGraceMs`/`maxOutputBytes`/`pollIntervalMs`）で呼び出しごとに上書きできる（テストがミリ秒オーダーの値へ差し替えて実子プロセスを使い高速に検証するための入口）。
- policy killは自プロセスグループへSIGTERMを送り、`terminationGraceMs`待って未終了ならSIGKILLへ昇格する（AC4）。
- stdout/stderrはそれぞれ独立に`maxOutputBytes`で打ち切られ、打ち切り箇所には明示マーカー（`...[truncated: output cap reached]`）が付く。無制限蓄積は起きない。
- `classifyTermination`により、kernelが送っていないシグナル（別プロセスからのSIGTERMなど）は`termination.kind === 'external_signal'`として区別され、`runGraphify()`はこれを`policy kill`とは別の`stop_reason: { code: 'external_signal', ... }`として上位へ伝播する。

`importGraphifyArtifacts`/`runGraphify`という既存の公開契約（戻り値スキーマ、`manifest.graphify.last_execution`への記録）は変更なし。`runProcess`自体もエクスポートされ、実バイナリを起動せずバウンド挙動（進捗延長・ハードキャップ・出力打ち切り・SIGTERM→SIGKILL・external kill帰属）を直接ユニットテスト可能にしている。

## Adoption: src/verification-runner.js（誤帰属の是正）

旧実装は`execFile`による全バッファ実行で、実行中の進捗を一切観測できず、`error.killed && signal`という条件だけで「timeoutかどうか」を判定していた。この条件は**誰が送ったシグナルかを区別しない**ため、外部SIGTERM（誤ってkillされた・OOM killer等）を`timed_out: true`として記録する誤診事故が実際に発生していた。

エクスポートされた`executeCommand(root, argv, { timeoutMs, noProgressDeadlineMs, maxOutputBytes, env })`が`execFile`を`spawn`へ置き換え、kernelで包む:

- ポーリング（`PROGRESS_POLL_INTERVAL_MS` = 200ms間隔）ごとに、蓄積stdoutから`node --test`の完了テスト数（TAPの`# tests N`、spec reporterの`ℹ tests N`のいずれか）を`extractOutputCounts`でパースし、パースできれば`kernel.observe(counts.tests)`する。テスト完了数が単調に増える限り、no-progress期限は都度延長される（AC5前半）。
- `timedOut`は**policy killの2種のみ**でtrueになる: `policyKillCause === 'max_wall_clock_exceeded' || policyKillCause === 'no_progress_deadline_exceeded'`。`classifyTermination`が`external_signal`と判定したケースは`timedOut: false`のまま、`externalKillSignal`にシグナル名が入る（AC5後半）。これは「タイムアウトかどうか」の意味を破壊する変更ではなく、**従来間違って`timed_out: true`と記録されていたケースを正す修正**である。
- SIGTERM→（固定`TERMINATION_GRACE_MS` = 2000ms）→SIGKILLの段階的終了と自プロセスグループへの送信は`graphify-adapter.js`と同じ契約（`src/managed-command-executor.js`が確立した「own process group, detached, SIGTERM then SIGKILL」パターン）を再利用する。

### 公開契約の変更点と互換性

| 変更 | 内容 | 互換性 |
|---|---|---|
| 新規CLIフラグ `verify run --no-progress-deadline-ms <ms>` | `normalizeNoProgressDeadline`が未指定時は`--timeout-ms`の値をそのまま採用する。 | フラグ未指定時の挙動は変更前とバイト同一（`no_progress_deadline_ms === timeout_ms`なら実質的にwall-clockのみのバウンドだった旧挙動と同じ）。 |
| 新規証跡フィールド `external_kill_signal`（`COMPUTED_OBSERVATION_KEYS`に追加） | 既定値`"none"`（evidence記録時）/ 内部は`null`。外部killが観測された時だけシグナル名が入る。 | 新規追加フィールドであり、既存フィールドの削除・改名はない。 |
| 新規warning `verification_run_killed_by_external_signal` | `externalKillSignal`が非nullの時にwarningsへ追加される。`verification_run_timed_out`とは排他（`timedOut`がtrueになるのはpolicy killのみのため）。 | 既存warning群（`verification_run_timed_out`含む）は削除・改名なし。 |
| `timed_out`の判定条件変更 | 従来: `error.killed && Boolean(error.signal)`（誰が送ったかを区別しない）。現在: `policy_kill`原因（`max_wall_clock_exceeded`/`no_progress_deadline_exceeded`）のみtrue。 | **既存契約の破壊ではなく誤記録の是正**として扱う。外部SIGTERMで殺された実行を`timed_out: false`かつ`external_kill_signal`付きで記録し直すことで、以前`timed_out: true`だった一部のケースの意味が変わる（これが本Storyの主目的の一つ）。既存CLIフラグ・戻り値スキーマの他フィールド・exit-code意味論は変更しない。 |

## Boundary and Scope

本StoryはKernel抽出＋`codex-subagent-runtime-adapter.js`の委譲置換＋`graphify-adapter.js`と`verification-runner.js`への採用までを範囲とする。以下はfollowup Storyへ分割済みで本Storyのスコープ外:

- `pr-manager` autopilot検証シェル
- `performance-measurer`
- `independent-review-orchestrator`
- 素朴な`spawn`+`setTimeout`+`SIGTERM`新規実装を検出するskills lint/hook
- group-kill 3種・mkdirロック4種の統合

## Rollback

kernelモジュール（`src/progress-deadline.js`）は純関数のみで構成され、外部状態を持たない。採用サイトごとに独立してロールバック可能: `graphify-adapter.js`の`runProcess`または`verification-runner.js`の`executeCommand`のimportと呼び出しを旧実装（タイムアウトなしのspawn、または`execFile`＋`error.killed`判定）へ戻すだけで、他の採用サイトやkernel自体には影響しない。

## Verification

- `test/progress-deadline.test.js`: kernル単体（重複進捗の延命拒否、5種cause codeとprecedence、`classifyTermination`の policy/external判定、必須オプションのバリデーション）。
- `test/graphify-adapter.test.js`: 実子プロセスを起動した`runProcess`の正常終了・進捗延長・no-progress kill・wall-clock kill・出力打ち切り・external kill帰属。
- `test/verification-runner.test.js`: `vibepro verify run`経由のno-progress kill、`executeCommand`直接呼び出しでのexternal kill帰属・no-progress kill・ストリーミング進捗延長。
- `test/codex-subagent-runtime-adapter.test.js`: CDI-S-5系（heartbeat無効化、successor間でのno-progress deadline保持、bounded recovery、wall-clock kill）が委譲後も無変更で通過する。
- `test/e2e/story-vibepro-progress-heartbeat-policy-kernel-main.test.js`: 本StoryのAC1–AC5を実子プロセス・実adapter経路で再現するVibePro受け入れE2E。
