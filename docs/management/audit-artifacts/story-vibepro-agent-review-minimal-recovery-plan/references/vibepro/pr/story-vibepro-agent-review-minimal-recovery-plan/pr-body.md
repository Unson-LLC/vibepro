## 判断
- このPRで判断すること: Agent Review Gate should emit a minimal recovery plan for stale and timed-out review lifecycles を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-agent-review-minimal-recovery-plan - Agent Review Gate should emit a minimal recovery plan for stale and timed-out review lifecycles
- 正本: [docs/management/stories/active/story-vibepro-agent-review-minimal-recovery-plan.md](docs/management/stories/active/story-vibepro-agent-review-minimal-recovery-plan.md)
- 変更範囲: 7 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-agent-review-minimal-recovery-plan.md](docs/management/stories/active/story-vibepro-agent-review-minimal-recovery-plan.md), [docs/architecture/vibepro-agent-review-minimal-recovery-plan.md](docs/architecture/vibepro-agent-review-minimal-recovery-plan.md), [docs/specs/vibepro-agent-review-minimal-recovery-plan.md](docs/specs/vibepro-agent-review-minimal-recovery-plan.md)
- 実装: [src/html-report.js](src/html-report.js), [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/risk-adaptive-gate.test.js](test/risk-adaptive-gate.test.js)

## 経緯
- 要求: Agent Review Gate should emit a minimal recovery plan for stale and timed-out review lifecycles
- 要求ID: 270
- 発生経緯: **As a** VibeProでPR readinessを判断する開発者 **I want to** stale resultやtimed-out lifecycleが重なったAgent Review blockerから、次に実行する最小手順だけを見たい **So that** dispatch batch、preflight、role、record、artifact freshnessの複数表示を手で解釈せず、現在stageの正しいreview recoveryに進める


## 原因
- Story文書から根本原因を抽出できませんでした。

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-agent-review-minimal-recovery-plan.md](docs/management/stories/active/story-vibepro-agent-review-minimal-recovery-plan.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/html-report.js](src/html-report.js), [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/risk-adaptive-gate.test.js](test/risk-adaptive-gate.test.js)

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - post-CI unit_regression for VIBE-RAR-001/VIBE-RAR-002 and VIBE-CORE-COST-001 passed on current HEAD with verified generic status JSON artifact; evidence: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json)
- [x] Integration Gate - Imported CI evidence for CodeQL (SUCCESS) at HEAD f433abf9d546; evidence: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/ci-evidence/CodeQL.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/ci-evidence/CodeQL.json)
- [x] E2E Gate - AC-specific workflow replay for agent-review minimal recovery plan output and report surfaces with verified generic status JSON artifact; evidence: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json)
- 最終E2E: pass: AC-specific workflow replay for agent-review minimal recovery plan output and report surfaces with verified generic status JSON artifact（[.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/test-artifacts/focused-risk-adaptive-gate.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/)
- PR準備: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/pr-prepare.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/decision-index.json](.vibepro/pr/story-vibepro-agent-review-minimal-recovery-plan/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 f433abf9d546 codex/issue-270-agent-review-minimal-recovery clean (story=story-vibepro-agent-review-minimal-recovery-plan)
