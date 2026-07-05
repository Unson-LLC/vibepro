## 判断
- このPRで判断すること: verify record / import-ci / review prepare〜record / decision record の十数コマンドを暗記した順序で手打ちしないと PR に到達できない を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-pr-evidence-autopilot - verify record / import-ci / review prepare〜record / decision record の十数コマンドを暗記した順序で手打ちしないと PR に到達できない
- 正本: [docs/management/stories/active/story-vibepro-pr-evidence-autopilot.md](docs/management/stories/active/story-vibepro-pr-evidence-autopilot.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-pr-evidence-autopilot.md](docs/management/stories/active/story-vibepro-pr-evidence-autopilot.md), [docs/architecture/vibepro-pr-evidence-autopilot.md](docs/architecture/vibepro-pr-evidence-autopilot.md), [docs/specs/story-vibepro-pr-evidence-autopilot.md](docs/specs/story-vibepro-pr-evidence-autopilot.md)
- 実装: [src/cli.js](src/cli.js), [src/evidence-reuse.js](src/evidence-reuse.js), [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/evidence-summary-reuse.test.js](test/evidence-summary-reuse.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: verify record / import-ci / review prepare〜record / decision record の十数コマンドを暗記した順序で手打ちしないと PR に到達できない
- 発生経緯: `pr prepare` は不足している証跡を evidence-plan として既に知っているが、それを充足する作業は operator が verify record・verify import-ci・review prepare→start→close→record・再 prepare を暗記した順序で手打ちする儀式になっている。record の kind ごと上書きや review lifecycle の agent-id ズレなど、手順の罠も operator 側に露出している。不足証跡を自動で取りに行く実行系 `vibepro pr autopilot` を追加し、人間の入力が本当に必要な判断点（waiver、split


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-pr-evidence-autopilot.md](docs/management/stories/active/story-vibepro-pr-evidence-autopilot.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/evidence-reuse.js](src/evidence-reuse.js), [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/evidence-summary-reuse.test.js](test/evidence-summary-reuse.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - unit_regression for VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001 passed at current HEAD: pr_lifecycle_regression agent_review_lifecycle_regression evidence_lifecycle_regression story_source_integrity_regression engineering_judgment_regression managed_worktree_regression summary_depth_artifact_hygiene pr_autopilot current_and_stale_verification_paths passed.; evidence: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-unit-regression-verification.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-unit-regression-verification.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-unit-regression-verification.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-unit-regression-verification.json)
- [x] Integration Gate - integration_runtime_path for VIBE-CORE-COST-001 passed at current HEAD via GitHub CI: test (20), test (22), analyze, and CodeQL all passed for PR #288 after pr autopilot changes.; evidence: ../../../../../../tmp/vibepro-pr288-import-ci2.json / gate: passed / evidence: ../../../../../../tmp/vibepro-pr288-import-ci2.json
- [x] E2E Gate - flow_replay artifact_replay scenario_clause_e2e gate_dag_final_artifact_consistency summary_depth_artifact_hygiene negative_path EAP-S-1 EAP-S-2 EAP-S-3 EAP-S-4 EAP-S-5 EAP-S-6 EAP-S-7 EAP-S-8 EAP-S-9 passed at current HEAD; evidence: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-flow-replay-verification.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-flow-replay-verification.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-flow-replay-verification.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-flow-replay-verification.json)
- 最終E2E: pass: flow_replay artifact_replay scenario_clause_e2e gate_dag_final_artifact_consistency summary_depth_artifact_hygiene negative_path EAP-S-1 EAP-S-2 EAP-S-3 EAP-S-4 EAP-S-5 EAP-S-6 EAP-S-7 EAP-S-8 EAP-S-9 passed at current HEAD（[.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-flow-replay-verification.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/autopilot/current-flow-replay-verification.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/](.vibepro/pr/story-vibepro-pr-evidence-autopilot/)
- PR準備: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/pr-prepare.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-pr-evidence-autopilot/decision-index.json](.vibepro/pr/story-vibepro-pr-evidence-autopilot/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 ab5c2369bd68 codex/pr-evidence-autopilot clean (story=story-vibepro-pr-evidence-autopilot)
