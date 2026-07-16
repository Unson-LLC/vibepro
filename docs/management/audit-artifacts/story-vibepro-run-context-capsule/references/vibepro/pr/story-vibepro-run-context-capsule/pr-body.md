## 判断
- このPRで判断すること: 長時間Runで会話履歴と巨大artifactを再投入せず、現在状態だけから判断を再開したい を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-run-context-capsule - 長時間Runで会話履歴と巨大artifactを再投入せず、現在状態だけから判断を再開したい
- 正本: [docs/management/stories/active/story-vibepro-run-context-capsule.md](docs/management/stories/active/story-vibepro-run-context-capsule.md)
- 変更範囲: 16 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-run-context-capsule.md](docs/management/stories/active/story-vibepro-run-context-capsule.md), [docs/architecture/story-vibepro-run-context-capsule.md](docs/architecture/story-vibepro-run-context-capsule.md), [docs/specs/story-vibepro-run-context-capsule.vibepro.json](docs/specs/story-vibepro-run-context-capsule.vibepro.json), ...and 1 more
- 実装: [src/agent-review.js](src/agent-review.js), [src/decision-records.js](src/decision-records.js), [src/guarded-run-session.js](src/guarded-run-session.js), ...and 2 more
- テスト: [test/decision-records.test.js](test/decision-records.test.js), [test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts](test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts), [test/e2e/story-vibepro-run-context-capsule-acceptance.spec.ts](test/e2e/story-vibepro-run-context-capsule-acceptance.spec.ts), ...and 2 more

## 経緯
- 要求: 長時間Runで会話履歴と巨大artifactを再投入せず、現在状態だけから判断を再開したい
- 発生経緯: **As a** 長時間または再開可能なGuarded Runを使う利用者 **I want** 現在の目的、HEAD、ボトルネック、有効証跡、予算、未解決判断を小さな状態から復元したい **So that** transcript compactionや巨大artifactの再読込を繰り返さず、判断品質を保ったままRunを継続できる ロードマップの2番目。`story-vibepro-guarded-run-session-contract`のRun正本を入力とし、後続のAction OrchestratorとMeta Controllerへbounded contextを渡す。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-run-context-capsule.md](docs/management/stories/active/story-vibepro-run-context-capsule.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/agent-review.js](src/agent-review.js), [src/decision-records.js](src/decision-records.js), [src/guarded-run-session.js](src/guarded-run-session.js), [src/run-context-capsule.js](src/run-context-capsule.js), ...
- テスト差分: [test/decision-records.test.js](test/decision-records.test.js), [test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts](test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts), [test/e2e/story-vibepro-run-context-capsule-acceptance.spec.ts](test/e2e/story-vibepro-run-context-capsule-acceptance.spec.ts), [test/guarded-run-session.test.js](test/guarded-run-session.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 19 focused Run Context Capsule and decision refresh tests passed on current HEAD, including canonical authority identity revalidation and non-mutating stale binding rejection; evidence: [.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/unit-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/unit-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/unit-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/unit-status.json)
- [x] Integration Gate - 104 current-head integration and regression tests passed after CI import across capsule recovery, canonical authority identity validation, managed mirrors, PR lifecycle, Agent Review lifecycle, evidence lifecycle, and managed worktree behavior; evidence: [.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/integration-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/integration-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/integration-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/integration-status.json)
- [x] E2E Gate - Acceptance artifact replay passed on current HEAD: 1 top-level E2E scenario with 14 nested contract tests covering AC-1 through AC-7 and S-001; evidence: [.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/e2e-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/e2e-status.json)
- 最終E2E: pass: Acceptance artifact replay passed on current HEAD: 1 top-level E2E scenario with 14 nested contract tests covering AC-1 through AC-7 and S-001（[.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-run-context-capsule/preflight-artifacts/e2e-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-run-context-capsule/](.vibepro/pr/story-vibepro-run-context-capsule/)
- PR準備: [.vibepro/pr/story-vibepro-run-context-capsule/pr-prepare.json](.vibepro/pr/story-vibepro-run-context-capsule/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-run-context-capsule/decision-index.json](.vibepro/pr/story-vibepro-run-context-capsule/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 7dd3e237727c codex/story-vibepro-run-context-capsule clean (story=story-vibepro-run-context-capsule)
