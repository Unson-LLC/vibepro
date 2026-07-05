## 判断
- このPRで判断すること: 70 超のゲートのうち、どれが本物の欠陥を止め、どれが文言修正と waiver しか生んでいないかのデータが存在しない を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-gate-outcome-roi-ledger - 70 超のゲートのうち、どれが本物の欠陥を止め、どれが文言修正と waiver しか生んでいないかのデータが存在しない
- 正本: [docs/management/stories/active/story-vibepro-gate-outcome-roi-ledger.md](docs/management/stories/active/story-vibepro-gate-outcome-roi-ledger.md)
- 変更範囲: 10 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-gate-outcome-roi-ledger.md](docs/management/stories/active/story-vibepro-gate-outcome-roi-ledger.md), [docs/architecture/story-vibepro-gate-outcome-roi-ledger.md](docs/architecture/story-vibepro-gate-outcome-roi-ledger.md), [docs/specs/story-vibepro-gate-outcome-roi-ledger.md](docs/specs/story-vibepro-gate-outcome-roi-ledger.md)
- 実装: [src/cli.js](src/cli.js), [src/gate-outcome-ledger.js](src/gate-outcome-ledger.js), [src/pr-manager.js](src/pr-manager.js), ...and 1 more
- テスト: [test/gate-outcome-ledger.test.js](test/gate-outcome-ledger.test.js), [test/traceability-usage-report.test.js](test/traceability-usage-report.test.js)

## 経緯
- 要求: 70 超のゲートのうち、どれが本物の欠陥を止め、どれが文言修正と waiver しか生んでいないかのデータが存在しない
- 発生経緯: 運用方針は「1 ゲートずつ計測して育てる」だが、ゲートがブロックした後に何が起きたか（実コードが直ったのか、証跡の書き直しだけで解けたのか、waiver されたのか）は記録されていない。このため fast lane の拡張対象や advisory→enforce 昇格の判断が勘に依存している。ゲートごとのブロック→解消の結末を分類して台帳化し、usage report でゲート精度（実修正率・文言解消率・waiver 率)を集計できるようにする。


## 原因
- Story文書から根本原因を抽出できませんでした。

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-gate-outcome-roi-ledger.md](docs/management/stories/active/story-vibepro-gate-outcome-roi-ledger.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/gate-outcome-ledger.js](src/gate-outcome-ledger.js), [src/pr-manager.js](src/pr-manager.js), [src/usage-report.js](src/usage-report.js)
- テスト差分: [test/gate-outcome-ledger.test.js](test/gate-outcome-ledger.test.js), [test/traceability-usage-report.test.js](test/traceability-usage-report.test.js)

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: ../../../../../../tmp/vibepro-gate-roi-final-typecheck.json
- [x] Unit Gate - Gate outcome ROI ledger unit/regression/e2e usage-report coverage passed: 26 tests, 0 failures.; evidence: ../../../../../../tmp/vibepro-gate-roi-final-node-test.json / gate: passed / evidence: ../../../../../../tmp/vibepro-gate-roi-final-node-test.json
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD e65fd032390e; evidence: [.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/ci-evidence/test_22_.json)
- [x] E2E Gate - flow_replay artifact_replay scenario_clause_e2e passed for gate outcome ledger; per_gate_classification_regression missing_review_not_evidence short_gate_token_not_evidence legacy_v1_v2_ledger_ignored VIBE-RAR-001 responsibility-authority and VIBE-CORE-COST-001 runtime cost telemetry unavailable token/time provenance covered; pr_lifecycle_regression agent_review_lifecycle_regression evidence_lifecycle_regression story_source_integrity_regression engineering_judgment_regression managed_worktree_regression integration_runtime_path unit_regression negative_path covered; evidence: ../../../../../../tmp/vibepro-gate-roi-node-test.json / gate: passed / evidence: ../../../../../../tmp/vibepro-gate-roi-node-test.json
- 最終E2E: pass: Gate outcome ROI ledger unit/regression/e2e usage-report coverage passed: 26 tests, 0 failures.（../../../../../../tmp/vibepro-gate-roi-final-node-test.json）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/](.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/)
- PR準備: [.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/pr-prepare.json](.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/decision-index.json](.vibepro/pr/story-vibepro-gate-outcome-roi-ledger/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 e65fd032390e codex/gate-outcome-roi-ledger clean (story=story-vibepro-gate-outcome-roi-ledger)
