---
story_id: story-vibepro-codex-host-containment-test-load-tolerance
parent_design: vibepro-autonomy-roadmap-rebaseline
title: Codex host containment テストの waitFor を高負荷ホストでフレークしない待機設計にする
status: active
view: dev
period: 2026-08
category: platform
source:
  type: operator_feedback
  title: "test/codex-subagent-host.test.js の containment テストが load average 20-35 の full suite 実行時のみ condition timeout でフレークする"
related_stories:
  - story-vibepro-agent-runtime-adapters
reason: "premise correction (2026-08-03): 当初の前提「production は決定的に終了を保証しており、テスト側の検知余裕だけが不足」は full suite 実測で反証された（300000ms deadline でも 303 秒 timeout）。真因は containment の登録レース: worker は codex 子プロセスを detached（独立プロセス群）で spawn し pid 登録 (codex-process.json) が非同期 write のため、高負荷で worker の event loop が飢餓すると、host は codexPid 不明のまま escalation を完走し waitForPidExit(null)=true で『封じ込め成功』を返す。worker が SIGTERM ハンドラ実行前に SIGKILL されると孤児 codex には誰もシグナルを送らない。alternatives considered: (a) テスト側 deadline 拡大のみ（実測で反証済み）、(b) テストが codex-process.json 登録完了を待ってから shutdown する（本番で任意タイミングの shutdown に存在する穴を検証範囲から外すだけでレースを隠蔽する、却下）、(c) src 修正でレース窓を閉じる。selected: (c) 最小手術 — worker は spawn 直後に writeFileSync で同期的に codex-process.json を登録し（未登録窓を event loop 非依存のマイクロ秒単位へ縮小）、host の terminateWorkerTree は codexPid 不明のとき各 escalation 段階で codex-process.json を再解決してから殺害・確認する。テスト側 deadline 拡大（負荷起因の正当な遅延吸収）は維持する。compatibility impact: shutdown エスカレーションの段階・シグナル順序・sandbox EPERM fallback は不変。登録タイミングと再解決だけが変わる。rollback plan: worker の同期 write を async に戻し、host の再解決を削除するだけ。boundary and scope: src/codex-subagent-host.js の terminateWorkerTree/shutdown、src/codex-subagent-host-worker.js の pid 登録、test/codex-subagent-host.test.js に限定。"
created_at: 2026-08-02
updated_at: 2026-08-02
---

# Codex host containment テストの waitFor を高負荷ホストでフレークしない待機設計にする

## User Story

**As a** VibePro の full test suite を高負荷ホストで実行する開発者
**I want** containment テストの待機が CPU 負荷に左右されず、production コードの終了保証時間に整合した deadline を持つこと
**So that** load average 20-35 の環境でも「production Codex host shutdown contains the detached worker process group」が偽陽性で落ちず、本物の containment 回帰だけを検知できる

## 背景 / 実測

- 単体実行: 1.7 秒で pass。
- full suite 実行（load average ~20-35）: 11.7 秒で `condition timeout`（`waitFor` の固定 10 秒 deadline 超過）により fail。
- `terminateWorkerTree`（src/codex-subagent-host.js:247）は SIGTERM → 群 SIGTERM → SIGKILL のエスカレーションで内部待ちが最大約 7.5 秒あり、高負荷時はテスト側 10 秒 deadline のマージンがほぼ消える。
- テスト自体は `host.shutdown()` を await 済みのため、当初は production 側の終了保証は満たされていると仮定した。
- **計測で確定した真因（2026-08-03、killProcess 注入の計測ハーネス 18 run / 2 leak 再現）**: deadline を 300000ms へ広げても full suite / 並行実行で該当テストが ~303 秒 timeout する事象の正体は、**テストフィクスチャ自身の pid ファイル非アトミック書き込みレース**。fake codex の `writeFile(pidPath, pid)` 直書き中に、テストの `access()` ポーリングが 0 バイト時点でファイル存在を検知し、一回きりの `readFile` が空文字を読む → `Number("") = 0` → `process.kill(0, 0)` は POSIX 上「自プロセス群への送信」で常に成功するため `isProcessAlive(0)` は恒真 → `!isProcessAlive(0)` は原理的に永遠に成立せず、deadline 値に関係なく timeout する。signal ログと runDir 状態は、production の封じ込め（シグナル送達・ESRCH 確認・cancelled 遷移、shutdown 1533ms）が全 run で正常完了していることを示した。
- **調査の副産物（inspection で発見・実測では未観測の理論的窓）**: worker の codex pid 登録（codex-process.json）が非同期 write だったため、host が codexPid 不明（`waitForPidExit(null)=true` の「停止済み」扱い）のまま escalation を成功で完了し得る登録レース窓が存在した。同期登録（writeFileSync）と escalation 各段階での再解決で同時に閉じる。

## 影響範囲

impact_scope_explained: 変更は (1) test/codex-subagent-host.test.js の waitFor ヘルパーと containment テスト 4 呼び出し箇所、(2) src/codex-subagent-host-worker.js の codex pid 登録の同期化（writeFileSync）、(3) src/codex-subagent-host.js の terminateWorkerTree/shutdown における codexPid 再解決、の 3 点。shutdown エスカレーションの段階・シグナル順序・sandbox EPERM fallback・イベント配送・状態遷移は不変。waitFor のデフォルト deadline 10000ms も据え置きのため、他のテスト呼び出し箇所の挙動は変わらない。公開 CLI/API・設定スキーマ・出力形式への影響はない（.vibepro/config.json の変更は本 Story の brainbase.stories[] 登録エントリ追加のみ）。なお design-ssot.json には `vibepro design-ssot link` 実行時のツール由来正規化（他 Story の child_links 並び替え・spec pointer パス正規化）が含まれる。

## Acceptance Criteria

- [ ] AC1: `waitFor` がタイムアウト値を呼び出し側から指定できる。
- [ ] AC2: containment テスト（process group / sandbox boundary）の shutdown 後待機と spawn 後の pid ファイル待機が、production の終了エスカレーション上限＋高負荷マージンを織り込んだ deadline を持つ。
- [ ] AC3: 単体実行・full suite（`node --test --test-concurrency=2`）の双方で該当テストが pass する。
- [ ] AC4: production 変更は containment 登録レース窓（inspection で発見）の閉鎖に限定する。shutdown エスカレーションの段階・シグナル順序・sandbox EPERM fallback は既存挙動を保持する。
- [ ] AC5: worker は codex 子プロセスの spawn 直後に同期的（writeFileSync）に codex-process.json を登録し、host の terminateWorkerTree は codexPid 不明のとき escalation 各段階と最終確認前に codex-process.json を再解決して、未登録のまま「封じ込め成功」を返さない。
- [ ] AC6: テストフィクスチャの pid ファイル・シグナルマーカーの書き込みは tmp+rename でアトミック化し、テスト側の読み取りは「非空・正整数としてパースできるまで」を待機条件に含める。`childPid = 0` の誤読が構造的に発生しない。
