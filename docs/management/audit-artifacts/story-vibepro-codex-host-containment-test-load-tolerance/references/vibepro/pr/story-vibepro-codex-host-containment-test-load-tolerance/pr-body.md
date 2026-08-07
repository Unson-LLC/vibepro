## 判断
- このPRで判断すること: test/codex-subagent-host.test.js の containment テストが load average 20-35 の full suite 実行時のみ condition timeout でフレークする を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-codex-host-containment-test-load-tolerance - test/codex-subagent-host.test.js の containment テストが load average 20-35 の full suite 実行時のみ condition timeout でフレークする
- 正本: [docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md](docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)
- 変更範囲: 7 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md](docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md), [docs/specs/story-vibepro-codex-host-containment-test-load-tolerance.md](docs/specs/story-vibepro-codex-host-containment-test-load-tolerance.md)
- 実装: [src/codex-subagent-host-worker.js](src/codex-subagent-host-worker.js), [src/codex-subagent-host.js](src/codex-subagent-host.js)
- テスト: [test/codex-subagent-host.test.js](test/codex-subagent-host.test.js), [test/e2e/story-vibepro-codex-host-containment-test-load-tolerance-main.test.js](test/e2e/story-vibepro-codex-host-containment-test-load-tolerance-main.test.js)

## 経緯
- 要求: test/codex-subagent-host.test.js の containment テストが load average 20-35 の full suite 実行時のみ condition timeout でフレークする
- 発生経緯: - 単体実行: 1.7 秒で pass。 - full suite 実行（load average ~20-35）: 11.7 秒で `condition timeout`（`waitFor` の固定 10 秒 deadline 超過）により fail。 - `terminateWorkerTree`（[src/codex-subagent-host.js:247](src/codex-subagent-host.js%3A247)）は SIGTERM → 群 SIGTERM → SIGKILL のエスカレーションで内部待ちが最大約 7.5 秒あり、高負荷時はテスト側 10 秒 deadline のマージンがほぼ消える。 - テスト自体は `host.shutdown()` を await 済みのため、当初は production 側の終了保証は満たされていると仮定した。 - **計測で確定した真因（2026-08-03、killProcess 注入の計測ハーネス 18 run / 2 leak 再現）**: deadline を 300000ms へ広げても full suite / 並行実行で該当テストが ~303 秒 timeout する事象の正体は、**テストフィクスチャ自身の pid ファイル非アトミック書き込みレース**。fake codex の `writeFile(pidPath, pid)` 直書き中に、テストの `access()` ポーリングが 0 バイト時点でファイル存在を検知し、一回きりの...


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md](docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-vibepro-codex-host-containment-test-load-tolerance
- Task ID: なし
- 対象受入基準: 6件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md](docs/management/stories/active/story-vibepro-codex-host-containment-test-load-tolerance.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 5 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: [src/codex-subagent-host-worker.js](src/codex-subagent-host-worker.js), [src/codex-subagent-host.js](src/codex-subagent-host.js)
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - vibepro verify run executed the unit command: exit_code=0, tests=2382 pass=2382 fail=0, duration_ms=2449667, status=pass computed from the exit code | agent summary: Unit regression: clean full-suite pass at final head 03ac374b including the previously flaky codex host containment tests and the new e2e flow replay; evidence: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/unit.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/unit.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/unit.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/unit.json)
- [x] Integration Gate - vibepro verify run executed the integration command: exit_code=0, tests=5 pass=5 fail=0, duration_ms=6237, status=pass computed from the exit code | agent summary: Integration verification: containment e2e replay crossing host worker and codex child module boundaries plus the adjacent durable process-record store integration suite; evidence: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/integration.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/integration.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/integration.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/integration.json)
- 最終E2E: pass: vibepro verify run executed the e2e command: exit_code=0, tests=2 pass=2 fail=0, duration_ms=6224, status=pass computed from the exit code | agent summary: E2E flow replay of the codex host containment lifecycle at final head（[.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/e2e.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/)
- PR準備: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/pr-prepare.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/decision-index.summary.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/decision-index.json](.vibepro/pr/story-vibepro-codex-host-containment-test-load-tolerance/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 03ac374b7dbf claude/relaxed-moser-327f0c clean (story=story-vibepro-codex-host-containment-test-load-tolerance)
