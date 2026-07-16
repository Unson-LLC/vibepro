## 判断
- このPRで判断すること: VibePro manual and public control-plane refresh を満たすための Runtime / Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-manual-control-plane-refresh - VibePro manual and public control-plane refresh
- 正本: [docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md](docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)
- 変更範囲: 55 files / Runtime / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md](docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md), [docs/architecture/vibepro-manual-control-plane-refresh.md](docs/architecture/vibepro-manual-control-plane-refresh.md)
- 実装: scripts/build-public-manual.mjs, scripts/check-public-manual-build.mjs, scripts/deploy-public-manual.mjs, ...and 2 more
- テスト: [test/cli-reference-docs.test.js](test/cli-reference-docs.test.js), [test/cli-smoke.test.js](test/cli-smoke.test.js), [test/public-manual-build-contract.test.js](test/public-manual-build-contract.test.js), ...and 4 more

## 経緯
- 要求: VibePro manual and public control-plane refresh
- 発生経緯: VibePro's public manual describes an older, shorter workflow and exposes repository-internal design artifacts in the public build. Several examples no longer match the current CLI contract, while release channel and source commit information are not explicit enough for users to distinguish the npm package from current `main`.


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md](docs/management/stories/active/story-vibepro-manual-control-plane-refresh.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: 差分が 55 files あり、レビュー可能な目安 30 files を超えている; repo制御ファイルやagent設定が差分に含まれている; baseからのcommitが 9 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/build-public-manual.mjs, scripts/check-public-manual-build.mjs, scripts/deploy-public-manual.mjs, scripts/generate-cli-reference.mjs, ...
- テスト差分: [test/cli-reference-docs.test.js](test/cli-reference-docs.test.js), [test/cli-smoke.test.js](test/cli-smoke.test.js), [test/public-manual-build-contract.test.js](test/public-manual-build-contract.test.js), [test/public-manual-build-runner.test.js](test/public-manual-build-runner.test.js), ...
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Public manual and CLI contract suite passed 28/28; evidence: [.vibepro/pr/story-vibepro-manual-control-plane-refresh/verification-evidence.json](.vibepro/pr/story-vibepro-manual-control-plane-refresh/verification-evidence.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-manual-control-plane-refresh/verification-evidence.json](.vibepro/pr/story-vibepro-manual-control-plane-refresh/verification-evidence.json)
- [x] Integration Gate - VIBE-CORE-COST-001 and VIBE-CORE-STATUS-001 regressions pass 20/20 after CI import; GitHub CI remains imported separately for current HEAD.; evidence: [.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json](.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json) / gate: passed / evidence: [.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json](.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json)
- [x] E2E Gate - Current reality, failure modes, done evidence, and VIBE-CORE-PR-001 lifecycle replay pass 36/36 on the current head.; evidence: [.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json](.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json) / gate: passed / evidence: [.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json](.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json)
- 最終E2E: pass: Current reality, failure modes, done evidence, and VIBE-CORE-PR-001 lifecycle replay pass 36/36 on the current head.（[.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json](.vibepro/qa/manual-control-plane-refresh/current-head-workflow-evidence.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-manual-control-plane-refresh/](.vibepro/pr/story-vibepro-manual-control-plane-refresh/)
- PR準備: [.vibepro/pr/story-vibepro-manual-control-plane-refresh/pr-prepare.json](.vibepro/pr/story-vibepro-manual-control-plane-refresh/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-manual-control-plane-refresh/decision-index.json](.vibepro/pr/story-vibepro-manual-control-plane-refresh/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 6e53e3aac1ea codex/story-vibepro-manual-control-plane-refresh-v2 clean (story=story-vibepro-manual-control-plane-refresh)
