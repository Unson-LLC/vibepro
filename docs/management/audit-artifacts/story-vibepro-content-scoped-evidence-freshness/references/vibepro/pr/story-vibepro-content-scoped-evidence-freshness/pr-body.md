## 判断
- このPRで判断すること: コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-content-scoped-evidence-freshness - コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている
- 正本: [docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md](docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)
- 変更範囲: 14 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md](docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md), [docs/architecture/vibepro-content-scoped-evidence-freshness.md](docs/architecture/vibepro-content-scoped-evidence-freshness.md), [docs/specs/story-vibepro-content-scoped-evidence-freshness.md](docs/specs/story-vibepro-content-scoped-evidence-freshness.md)
- 実装: [src/agent-review.js](src/agent-review.js), [src/cli.js](src/cli.js), [src/content-binding.js](src/content-binding.js), ...and 2 more
- テスト: [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js](test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js), [test/e2e/story-vibepro-issues-189-204-gate-friction-main.test.js](test/e2e/story-vibepro-issues-189-204-gate-friction-main.test.js), ...and 2 more

## 経緯
- 要求: コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている
- 発生経緯: 検証証跡とレビュー証跡は現在 git HEAD SHA に束縛されており、docs のみのコミットでもコード証跡が一括で stale になる。この結果「実装しながら証跡を貯める」のではなく「ツリーを最終化してから証跡→レビューを一気に取る」という逆順の運用が事実上強制され、Commit Small の原則とも衝突している。story-vibepro-scoped-evidence-invalidation が始めた changed-surface スコープ判定を鮮度モデルのデフォルトまで押し切り、証跡の束縛先を「その証跡が依拠するファイル群のコンテンツハッシュ」に変える。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md](docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/agent-review.js](src/agent-review.js), [src/cli.js](src/cli.js), [src/content-binding.js](src/content-binding.js), [src/pr-manager.js](src/pr-manager.js), ...
- テスト差分: [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js](test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js), [test/e2e/story-vibepro-issues-189-204-gate-friction-main.test.js](test/e2e/story-vibepro-issues-189-204-gate-friction-main.test.js), [test/risk-adaptive-gate.test.js](test/risk-adaptive-gate.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Responsibility Authority unit regression suite passed on current head a6d7d16: VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001 unit_regression current_head_verification negative_path artifact_replay scenario_clause_e2e; 47/47 focused tests passed.; evidence: [.vibepro/evidence/content-scoped-evidence-freshness/responsibility-unit-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/responsibility-unit-a6d7d16.json) / gate: passed / evidence: [.vibepro/evidence/content-scoped-evidence-freshness/responsibility-unit-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/responsibility-unit-a6d7d16.json)
- [x] Integration Gate - CI passed for PR #285 at a6d7d16 and covers responsibility authority contract regressions: unit_regression pr_lifecycle_regression agent_review_lifecycle_regression evidence_lifecycle_regression integration_runtime_path negative_path story_source_integrity_regression engineering_judgment_regression managed_worktree_regression.; evidence: [.vibepro/evidence/content-scoped-evidence-freshness/ci-responsibility-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/ci-responsibility-a6d7d16.json) / gate: passed / evidence: [.vibepro/evidence/content-scoped-evidence-freshness/ci-responsibility-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/ci-responsibility-a6d7d16.json)
- [x] E2E Gate - workflow replay verified with durable artifact for content-scoped evidence freshness; flow_replay artifact_replay scenario_clause_e2e current_reality failure_modes done_evidence all passed; evidence: [.vibepro/evidence/content-scoped-evidence-freshness/workflow-replay-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/workflow-replay-a6d7d16.json) / gate: passed / evidence: [.vibepro/evidence/content-scoped-evidence-freshness/workflow-replay-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/workflow-replay-a6d7d16.json)
- 最終E2E: pass: Responsibility Authority unit regression suite passed on current head a6d7d16: VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001 unit_regression current_head_verification negative_path artifact_replay scenario_clause_e2e; 47/47 focused tests passed.（[.vibepro/evidence/content-scoped-evidence-freshness/responsibility-unit-a6d7d16.json](.vibepro/evidence/content-scoped-evidence-freshness/responsibility-unit-a6d7d16.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/)
- PR準備: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/pr-prepare.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/decision-index.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 a6d7d163c2ac codex/content-scoped-evidence-freshness clean (story=story-vibepro-content-scoped-evidence-freshness)
