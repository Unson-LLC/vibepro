## 判断
- このPRで判断すること: Full artifact dumps should not be the default LLM handoff input を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-bounded-artifact-view - Full artifact dumps should not be the default LLM handoff input
- 正本: [docs/management/stories/active/story-vibepro-bounded-artifact-view.md](docs/management/stories/active/story-vibepro-bounded-artifact-view.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-bounded-artifact-view.md](docs/management/stories/active/story-vibepro-bounded-artifact-view.md), [docs/architecture/vibepro-bounded-artifact-view.md](docs/architecture/vibepro-bounded-artifact-view.md), [docs/specs/vibepro-bounded-artifact-view.md](docs/specs/vibepro-bounded-artifact-view.md)
- 実装: [src/canonical-audit.js](src/canonical-audit.js), [src/cli.js](src/cli.js)
- テスト: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: Full artifact dumps should not be the default LLM handoff input
- 要求ID: VP-VALUE-AUDIT-2026-07-03-BOUNDED-LLM-VIEW
- 発生経緯: VibePro keeps full PR artifacts so that decisions can be audited later. The problem identified in value audit is not the existence of large machine artifacts; it is making those full dumps the default text that an LLM must read for handoff, review, or follow-up. The default agent handoff should start from a bounded pro


## 原因
- Story文書から根本原因を抽出できませんでした。

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-bounded-artifact-view.md](docs/management/stories/active/story-vibepro-bounded-artifact-view.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/canonical-audit.js](src/canonical-audit.js), [src/cli.js](src/cli.js)
- テスト差分: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/typecheck.log](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/typecheck.log)
- [x] Unit Gate - unit_regression current_head_verification for VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001: bounded projection tests passed on committed HEAD and cover gate DAG responsibility authority, runtime cost telemetry handoff, blocker filtering, and artifact reference binding.; evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json)
- [x] Integration Gate - integration_runtime_path negative_path current_head_verification for VIBE-CORE-COST-001: real pr prepare CLI path emits bounded LLM projections by default, keeps full artifact refs for targeted drill-down, and negative assertions verify full diagnostics/DAG payloads are not sent as default LLM input.; evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json)
- [x] E2E Gate - flow_replay artifact_replay scenario_clause_e2e current_head_verification: bounded PR prepare projections replay the CLI handoff path and fail if full DAG/diagnostics leak or story refs remain unbound.; evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json)
- 最終E2E: pass: flow_replay artifact_replay scenario_clause_e2e current_head_verification: bounded PR prepare projections replay the CLI handoff path and fail if full DAG/diagnostics leak or story refs remain unbound.（[.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json](.vibepro/pr/story-vibepro-bounded-artifact-view/evidence/bounded-projection-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-bounded-artifact-view/](.vibepro/pr/story-vibepro-bounded-artifact-view/)
- PR準備: [.vibepro/pr/story-vibepro-bounded-artifact-view/pr-prepare.json](.vibepro/pr/story-vibepro-bounded-artifact-view/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-bounded-artifact-view/decision-index.json](.vibepro/pr/story-vibepro-bounded-artifact-view/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 5b33b0b1e1e7 codex/vibepro-bounded-artifact-view clean (story=story-vibepro-bounded-artifact-view)
