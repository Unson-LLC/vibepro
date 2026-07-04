## 判断
- このPRで判断すること: VibePro gate evidence feels heavy when an agent only needs the next blocker を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-gate-efficiency-fast-readiness - VibePro gate evidence feels heavy when an agent only needs the next blocker
- 正本: [docs/management/stories/active/story-vibepro-gate-efficiency-fast-readiness.md](docs/management/stories/active/story-vibepro-gate-efficiency-fast-readiness.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-gate-efficiency-fast-readiness.md](docs/management/stories/active/story-vibepro-gate-efficiency-fast-readiness.md), [docs/architecture/story-vibepro-gate-efficiency-fast-readiness.md](docs/architecture/story-vibepro-gate-efficiency-fast-readiness.md), [docs/specs/story-vibepro-gate-efficiency-fast-readiness-spec.md](docs/specs/story-vibepro-gate-efficiency-fast-readiness-spec.md)
- 実装: [src/canonical-audit.js](src/canonical-audit.js), [src/cli.js](src/cli.js), [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/evidence-depth-pr-prepare.test.js](test/evidence-depth-pr-prepare.test.js), [test/pr-readiness-gate-status.test.js](test/pr-readiness-gate-status.test.js)

## 経緯
- 要求: VibePro gate evidence feels heavy when an agent only needs the next blocker
- 発生経緯: Focused `pr prepare` views should preserve Gate DAG safety while avoiding heavy HTML and full DAG artifacts when the caller asked only for a bounded readiness projection. When a gate still blocks, the projection should include the concrete next command VibePro already knows.


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-gate-efficiency-fast-readiness.md](docs/management/stories/active/story-vibepro-gate-efficiency-fast-readiness.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/canonical-audit.js](src/canonical-audit.js), [src/cli.js](src/cli.js), [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/evidence-depth-pr-prepare.test.js](test/evidence-depth-pr-prepare.test.js), [test/pr-readiness-gate-status.test.js](test/pr-readiness-gate-status.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Full test suite passed on current head 0c8539d: 785 tests, 785 pass, 0 fail, duration_ms=696946. Contract-bound responsibility evidence: unit_regression VIBE-RAR-001 VIBE-RAR-002; pr_lifecycle_regression VIBE-CORE-PR-001; agent_review_lifecycle_regression VIBE-CORE-AR-001; evidence_lifecycle_regression VIBE-CORE-EV-001; integration_runtime_path negative_path VIBE-CORE-COST-001; story_source_integrity_regression VIBE-CORE-STORY-001; engineering_judgment_regression VIBE-CORE-JUDGE-001; managed_worktree_regression VIBE-CORE-WT-001. Common judgment spine evidence: current_reality focused_test runtime_path_evidence integration_runtime_path; failure_modes negative_path boundary_condition; done_evidence focused_test current_verification.; evidence: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/verification-evidence.json](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/verification-evidence.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/verification-evidence.json](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/verification-evidence.json)
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD 0c8539d7b1e5; evidence: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/ci-evidence/test_22_.json)
- [x] E2E Gate - Focused PR readiness workflow replay passed on current head 0c8539d with durable artifact: flow_replay, artifact_replay, scenario_clause_e2e, focused_pr_prepare_view, blocking_gate_next_command_projection, AC-2 GEFR-S-2 summary-depth skips heavy HTML/Gate DAG dumps, AC-4 GEFR-S-4 explicit-depth override, and GEFR-S-6 next_commands ordering coverage. Common judgment spine evidence: current_reality focused_test runtime_path_evidence integration_runtime_path; failure_modes negative_path boundary_condition; done_evidence focused_test current_verification.; evidence: [.vibepro/evidence/story-vibepro-gate-efficiency-fast-readiness/workflow-replay-verified.json](.vibepro/evidence/story-vibepro-gate-efficiency-fast-readiness/workflow-replay-verified.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-gate-efficiency-fast-readiness/workflow-replay-verified.json](.vibepro/evidence/story-vibepro-gate-efficiency-fast-readiness/workflow-replay-verified.json)
- 最終E2E: pass: Focused PR readiness workflow replay passed on current head 0c8539d with durable artifact: flow_replay, artifact_replay, scenario_clause_e2e, focused_pr_prepare_view, blocking_gate_next_command_projection, AC-2 GEFR-S-2 summary-depth skips heavy HTML/Gate DAG dumps, AC-4 GEFR-S-4 explicit-depth override, and GEFR-S-6 next_commands ordering coverage. Common judgment spine evidence: current_reality focused_test runtime_path_evidence integration_runtime_path; failure_modes negative_path boundary_condition; done_evidence focused_test current_verification.（[.vibepro/evidence/story-vibepro-gate-efficiency-fast-readiness/workflow-replay-verified.json](.vibepro/evidence/story-vibepro-gate-efficiency-fast-readiness/workflow-replay-verified.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/)
- PR準備: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/pr-prepare.json](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/decision-index.json](.vibepro/pr/story-vibepro-gate-efficiency-fast-readiness/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 0c8539d7b1e5 codex/vibepro-gate-efficiency clean (story=story-vibepro-gate-efficiency-fast-readiness)
