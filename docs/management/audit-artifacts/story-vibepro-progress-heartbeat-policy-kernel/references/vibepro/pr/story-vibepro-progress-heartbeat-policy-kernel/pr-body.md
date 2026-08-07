## 判断
- このPRで判断すること: src配下37箇所の長時間実行バウンドのうち理想形を満たすのはevaluateProgressBounds 1箇所のみ。バウンド皆無の子プロセスと進捗シグナル破棄サイトを正本kernelへ寄せたい を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-progress-heartbeat-policy-kernel - src配下37箇所の長時間実行バウンドのうち理想形を満たすのはevaluateProgressBounds 1箇所のみ。バウンド皆無の子プロセスと進捗シグナル破棄サイトを正本kernelへ寄せたい
- 正本: [docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md](docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)
- 変更範囲: 16 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md](docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md), [docs/architecture/story-vibepro-progress-heartbeat-policy-kernel.md](docs/architecture/story-vibepro-progress-heartbeat-policy-kernel.md), [docs/specs/story-vibepro-progress-heartbeat-policy-kernel.md](docs/specs/story-vibepro-progress-heartbeat-policy-kernel.md)
- 実装: [src/cli.js](src/cli.js), [src/codex-subagent-runtime-adapter.js](src/codex-subagent-runtime-adapter.js), [src/graphify-adapter.js](src/graphify-adapter.js), ...and 3 more
- テスト: [test/e2e/story-vibepro-progress-heartbeat-policy-kernel-main.test.js](test/e2e/story-vibepro-progress-heartbeat-policy-kernel-main.test.js), [test/graphify-adapter.test.js](test/graphify-adapter.test.js), [test/progress-deadline.test.js](test/progress-deadline.test.js), ...and 1 more

## 経緯
- 要求: src配下37箇所の長時間実行バウンドのうち理想形を満たすのはevaluateProgressBounds 1箇所のみ。バウンド皆無の子プロセスと進捗シグナル破棄サイトを正本kernelへ寄せたい
- 発生経緯: **As a** VibePro CLIの運用者 **I want** 長時間実行される子プロセス（graphify update・検証スイート）が「単調な進捗がある限り生き、進捗が止まれば構造化された原因コードとともに確実に死ぬ」こと **So that** story diagnoseの無限ハングや、外部SIGTERMをtimeoutと誤記録する証跡汚染が起きず、kill原因が常に監査可能になる 2026-08-02の全数調査で、src配下の長時間実行を切る/待つ実装は37箇所。理想形4要素を全て満たすのは `evaluateProgressBounds`（[src/codex-subagent-runtime-adapter.js](src/codex-subagent-runtime-adapter.js)）ただ1箇所: 一方で: ハートビート（生存応答）では延命しない。**単調な進捗値の増加のみが延命し**、wall-clock/cost/attemptsは独立の最終防壁。kill原因は必ず構造化コードで証跡に残し、外部killとpolicy killを区別する。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md](docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-vibepro-progress-heartbeat-policy-kernel
- Task ID: なし
- 対象受入基準: 5件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md](docs/management/stories/active/story-vibepro-progress-heartbeat-policy-kernel.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 12 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/codex-subagent-runtime-adapter.js](src/codex-subagent-runtime-adapter.js), [src/graphify-adapter.js](src/graphify-adapter.js), [src/progress-deadline.js](src/progress-deadline.js), ...
- テスト差分: [test/e2e/story-vibepro-progress-heartbeat-policy-kernel-main.test.js](test/e2e/story-vibepro-progress-heartbeat-policy-kernel-main.test.js), [test/graphify-adapter.test.js](test/graphify-adapter.test.js), [test/progress-deadline.test.js](test/progress-deadline.test.js), [test/verification-runner.test.js](test/verification-runner.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: not_applicable / evidence: [.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/verification-runs/typecheck.json](.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/verification-runs/typecheck.json)
- 最終E2E: pass: vibepro verify run executed the e2e command: exit_code=0, tests=5 pass=5 fail=0, duration_ms=1559, status=pass computed from the exit code（[.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/verification-runs/e2e.json](.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/](.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/)
- PR準備: [.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/pr-prepare.json](.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/decision-index.summary.json](.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/decision-index.json](.vibepro/pr/story-vibepro-progress-heartbeat-policy-kernel/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 2bd5dabc9ebd claude/hopeful-williamson-545788 clean (story=story-vibepro-progress-heartbeat-policy-kernel)
