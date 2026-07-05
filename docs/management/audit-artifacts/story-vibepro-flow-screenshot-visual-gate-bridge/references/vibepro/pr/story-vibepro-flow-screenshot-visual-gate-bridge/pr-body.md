## 判断
- このPRで判断すること: verify flow が撮影済みのスクリーンショットを visual_qa 用に手動で再記録するのは二度手間 を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-flow-screenshot-visual-gate-bridge - verify flow が撮影済みのスクリーンショットを visual_qa 用に手動で再記録するのは二度手間
- 正本: [docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md](docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md)
- 変更範囲: 22 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md](docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md), [docs/management/stories/active/story-vibepro-visual-residual-local-runner.md](docs/management/stories/active/story-vibepro-visual-residual-local-runner.md), [docs/architecture/vibepro-flow-screenshot-visual-gate-bridge.md](docs/architecture/vibepro-flow-screenshot-visual-gate-bridge.md), ...and 5 more
- 実装: [src/cli.js](src/cli.js), [src/flow-verifier.js](src/flow-verifier.js), [src/journey-map.js](src/journey-map.js), ...and 3 more
- テスト: [test/e2e/story-vibepro-flow-screenshot-visual-gate-bridge-main.test.js](test/e2e/story-vibepro-flow-screenshot-visual-gate-bridge-main.test.js), [test/e2e/story-vibepro-journey-curate-command-main.test.js](test/e2e/story-vibepro-journey-curate-command-main.test.js), [test/e2e/story-vibepro-ui-journey-e2e-dogfood-main.test.js](test/e2e/story-vibepro-ui-journey-e2e-dogfood-main.test.js), ...and 3 more

## 経緯
- 要求: verify flow が撮影済みのスクリーンショットを visual_qa 用に手動で再記録するのは二度手間
- 発生経緯: `vibepro verify flow` は Playwright 実行時にすでに `.vibepro/verification/<run-id>/screenshots/` へフルページスクリーンショットを保存している。しかし screenshot の存在だけでは visual residual の判定や目視完了を証明できない。撮影済みの視覚証跡を residual runner へ接続し、UI 変更で必要な Visual QA 証跡を prose ではなく artifact-backed にする。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md](docs/management/stories/active/story-vibepro-flow-screenshot-visual-gate-bridge.md), [docs/management/stories/active/story-vibepro-visual-residual-local-runner.md](docs/management/stories/active/story-vibepro-visual-residual-local-runner.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 8 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/flow-verifier.js](src/flow-verifier.js), [src/journey-map.js](src/journey-map.js), [src/pr-manager.js](src/pr-manager.js), ...
- テスト差分: [test/e2e/story-vibepro-flow-screenshot-visual-gate-bridge-main.test.js](test/e2e/story-vibepro-flow-screenshot-visual-gate-bridge-main.test.js), [test/e2e/story-vibepro-journey-curate-command-main.test.js](test/e2e/story-vibepro-journey-curate-command-main.test.js), [test/e2e/story-vibepro-ui-journey-e2e-dogfood-main.test.js](test/e2e/story-vibepro-ui-journey-e2e-dogfood-main.test.js), [test/e2e/story-vibepro-visual-residual-local-runner-main.test.js](test/e2e/story-vibepro-visual-residual-local-runner-main.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-typecheck-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-typecheck-b367e45.json)
- [x] Unit Gate - Responsibility authority current-head contracts passed. Unit regression evidence is bound to [docs/contracts/vibepro-responsibility-authority.json#VIBE-RAR-001](docs/contracts/vibepro-responsibility-authority.json%23VIBE-RAR-001) and [docs/contracts/vibepro-core-responsibilities.json#VIBE-CORE-COST-001](docs/contracts/vibepro-core-responsibilities.json%23VIBE-CORE-COST-001), with current_head_verification, typecheck linkage, evidence lifecycle, agent review lifecycle, engineering judgment, and managed worktree regression coverage.; evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-unit-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-unit-b367e45.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-unit-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-unit-b367e45.json)
- [x] Integration Gate - VibePro integration regression passed locally and GitHub PR #286 checks passed. Integration/runtime and negative-path evidence is bound to [docs/contracts/vibepro-core-responsibilities.json#VIBE-CORE-COST-001](docs/contracts/vibepro-core-responsibilities.json%23VIBE-CORE-COST-001); story source integrity evidence is bound to [docs/contracts/vibepro-core-responsibilities.json#VIBE-CORE-STORY-001](docs/contracts/vibepro-core-responsibilities.json%23VIBE-CORE-STORY-001). Covers artifact_replay, PR lifecycle, review_surface artifact/report path, responsibility authority, evidence lifecycle, agent review lifecycle, and design SSOT reconcile.; evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-integration-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-integration-b367e45.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-integration-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-integration-b367e45.json)
- [x] E2E Gate - Story acceptance E2E coverage passed with flow_replay, artifact_replay, scenario_clause_e2e, visual_qa, screenshot, accessibility evidence, review surface artifact replay, and negative path coverage for the 4-story journey pipeline.; evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-e2e-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-e2e-b367e45.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-e2e-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-e2e-b367e45.json)
- 最終E2E: pass: Responsibility authority current-head contracts passed. Unit regression evidence is bound to [docs/contracts/vibepro-responsibility-authority.json#VIBE-RAR-001](docs/contracts/vibepro-responsibility-authority.json%23VIBE-RAR-001) and [docs/contracts/vibepro-core-responsibilities.json#VIBE-CORE-COST-001](docs/contracts/vibepro-core-responsibilities.json%23VIBE-CORE-COST-001), with current_head_verification, typecheck linkage, evidence lifecycle, agent review lifecycle, engineering judgment, and managed worktree regression coverage.（[.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-unit-b367e45.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/artifacts/current-head-unit-b367e45.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/)
- PR準備: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/pr-prepare.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/decision-index.json](.vibepro/pr/story-vibepro-flow-screenshot-visual-gate-bridge/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 b367e4551d80 codex/vibepro-journey-uiux-pipeline-impl clean (story=story-vibepro-flow-screenshot-visual-gate-bridge)
