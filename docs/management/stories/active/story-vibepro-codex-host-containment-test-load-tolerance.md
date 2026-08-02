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
reason: "alternatives considered: (a) waitFor の固定 10 秒 deadline を負荷耐性のある値へ広げる、(b) プロセス群終了検知をポーリングからイベント駆動（worker の exit イベント / shutdown-finished.json の fs.watch）へ置き換える、(c) テストを serial 実行へ隔離する。selected: (a) をベースに waitFor をタイムアウト指定可能にし、shutdown 後のプロセス消滅待ちなど負荷感受性の高い待機だけ deadline を広げる。理由: shutdown 実装自体が SIGTERM→SIGKILL エスカレーションで最大約 7.5 秒の内部待ちを持ち、production コードは既に決定的に終了を保証している。テスト側の検知だけが固定 10 秒で不足しており、production コード変更 (b) は回帰リスクに対して得るものがない。compatibility impact: テストのみの変更で runtime 動作は不変。rollback plan: テストの deadline 値を元に戻すだけ。boundary and scope: test/codex-subagent-host.test.js の waitFor ヘルパーとその呼び出し箇所に限定し、src/ 配下は変更しない。"
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
- テスト自体は `host.shutdown()` を await 済みのため、production 側の終了保証は満たされている。不足しているのはテスト側の検知余裕のみ。

## 影響範囲

impact_scope_explained: 変更は test/codex-subagent-host.test.js の waitFor ヘルパーとその containment テスト 4 呼び出し箇所のみ。src/ 配下の production コード（codex-subagent-host.js の terminateWorkerTree エスカレーション）は不変で、waitFor のデフォルト deadline 10000ms も据え置きのため、他のテスト呼び出し箇所の挙動は変わらない。公開 CLI/API・設定スキーマ・出力形式への影響はない（.vibepro/config.json の変更は本 Story の brainbase.stories[] 登録エントリ追加のみ）。

## Acceptance Criteria

- [ ] AC1: `waitFor` がタイムアウト値を呼び出し側から指定できる。
- [ ] AC2: containment テスト（process group / sandbox boundary）の shutdown 後待機と spawn 後の pid ファイル待機が、production の終了エスカレーション上限＋高負荷マージンを織り込んだ deadline を持つ。
- [ ] AC3: 単体実行・full suite（`node --test --test-concurrency=2`）の双方で該当テストが pass する。
- [ ] AC4: production コード（src/）は変更しない。
