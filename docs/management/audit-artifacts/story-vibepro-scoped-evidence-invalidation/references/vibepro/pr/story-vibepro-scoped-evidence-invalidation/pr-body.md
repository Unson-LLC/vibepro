## 判断
- このPRで判断すること: Gate planner should scope stale evidence invalidation by changed surface を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-scoped-evidence-invalidation - Gate planner should scope stale evidence invalidation by changed surface
- 正本: [docs/management/stories/active/story-vibepro-scoped-evidence-invalidation.md](docs/management/stories/active/story-vibepro-scoped-evidence-invalidation.md)
- 変更範囲: 10 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-scoped-evidence-invalidation.md](docs/management/stories/active/story-vibepro-scoped-evidence-invalidation.md), [docs/architecture/vibepro-scoped-evidence-invalidation.md](docs/architecture/vibepro-scoped-evidence-invalidation.md), [docs/specs/story-vibepro-scoped-evidence-invalidation.md](docs/specs/story-vibepro-scoped-evidence-invalidation.md)
- 実装: [src/change-risk-classifier.js](src/change-risk-classifier.js), [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/low-risk-source-reuse.test.js](test/low-risk-source-reuse.test.js), [test/risk-adaptive-gate.test.js](test/risk-adaptive-gate.test.js)

## 経緯
- 要求: Gate planner should scope stale evidence invalidation by changed surface
- 要求ID: 268
- 発生経緯: VibePro currently binds verification evidence to the whole dirty fingerprint. That preserves current-state safety, but it is too coarse when the only change is Story, Spec, responsibility, contract, or generated VibePro metadata that does not touch runtime source or the relevant test set. Gate must classify the changed


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-scoped-evidence-invalidation.md](docs/management/stories/active/story-vibepro-scoped-evidence-invalidation.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/change-risk-classifier.js](src/change-risk-classifier.js), [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/low-risk-source-reuse.test.js](test/low-risk-source-reuse.test.js), [test/risk-adaptive-gate.test.js](test/risk-adaptive-gate.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - focused TAP regression passed for scoped evidence invalidation; VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001 unit_regression flow_replay artifact_replay scenario_clause_e2e; evidence: [.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/focused-regression.tap](.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/focused-regression.tap) / gate: passed / evidence: [.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/focused-regression.tap](.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/focused-regression.tap)
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD 5f6b00be4db8; evidence: [.vibepro/pr/story-vibepro-scoped-evidence-invalidation/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-scoped-evidence-invalidation/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-scoped-evidence-invalidation/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-scoped-evidence-invalidation/ci-evidence/test_22_.json)
- [x] E2E Gate - Story acceptance E2E replay passed with flow_replay, artifact_replay, and scenario_clause_e2e coverage for scoped stale evidence invalidation; evidence: [.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/e2e-replay-status.json](.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/e2e-replay-status.json) / gate: passed / evidence: [.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/e2e-replay-status.json](.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/e2e-replay-status.json)
- 最終E2E: pass: Story acceptance E2E replay passed with flow_replay, artifact_replay, and scenario_clause_e2e coverage for scoped stale evidence invalidation（[.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/e2e-replay-status.json](.vibepro/test-artifacts/story-vibepro-scoped-evidence-invalidation/e2e-replay-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-scoped-evidence-invalidation/](.vibepro/pr/story-vibepro-scoped-evidence-invalidation/)
- PR準備: [.vibepro/pr/story-vibepro-scoped-evidence-invalidation/pr-prepare.json](.vibepro/pr/story-vibepro-scoped-evidence-invalidation/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-scoped-evidence-invalidation/decision-index.json](.vibepro/pr/story-vibepro-scoped-evidence-invalidation/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 5f6b00be4db8 codex/issue-268-scoped-evidence-invalidation clean (story=story-vibepro-scoped-evidence-invalidation)
