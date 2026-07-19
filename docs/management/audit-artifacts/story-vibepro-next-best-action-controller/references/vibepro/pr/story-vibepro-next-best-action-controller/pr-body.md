## 判断
- このPRで判断すること: トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-next-best-action-controller - トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい
- 正本: [docs/management/stories/active/story-vibepro-next-best-action-controller.md](docs/management/stories/active/story-vibepro-next-best-action-controller.md)
- 変更範囲: 12 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-next-best-action-controller.md](docs/management/stories/active/story-vibepro-next-best-action-controller.md), [docs/architecture/story-vibepro-next-best-action-controller.md](docs/architecture/story-vibepro-next-best-action-controller.md), [docs/specs/story-vibepro-next-best-action-controller.md](docs/specs/story-vibepro-next-best-action-controller.md)
- 実装: [src/cli.js](src/cli.js), [src/guarded-run-session.js](src/guarded-run-session.js), [src/next-best-action-controller.js](src/next-best-action-controller.js), ...and 1 more
- テスト: [test/e2e/story-vibepro-guarded-run-session-contract-main.test.js](test/e2e/story-vibepro-guarded-run-session-contract-main.test.js), [test/e2e/story-vibepro-next-best-action-controller-acceptance.spec.ts](test/e2e/story-vibepro-next-best-action-controller-acceptance.spec.ts), [test/guarded-run-session.test.js](test/guarded-run-session.test.js), ...and 1 more

## 経緯
- 要求: トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい
- 発生経緯: **As a** Guarded Runを総コストで最適化したい利用者 **I want** 安全に実行可能な候補から、進捗・不確実性低減・リスク低減・証跡再利用に対して最も費用対効果の高いActionを選んでほしい **So that** 安いだけの操作や高コスト検証の反復ではなく、Trusted PR-readyへ最短で近づける ロードマップの4番目。Context CapsuleとSafe Action Orchestratorが提供する状態・候補Actionの上に置き、後続の検証順序とAgent dispatchを選択する。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-next-best-action-controller.md](docs/management/stories/active/story-vibepro-next-best-action-controller.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-next-best-action-controller.md](docs/management/stories/active/story-vibepro-next-best-action-controller.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 16 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/guarded-run-session.js](src/guarded-run-session.js), [src/next-best-action-controller.js](src/next-best-action-controller.js), [src/safe-action-orchestrator.js](src/safe-action-orchestrator.js)
- テスト差分: [test/e2e/story-vibepro-guarded-run-session-contract-main.test.js](test/e2e/story-vibepro-guarded-run-session-contract-main.test.js), [test/e2e/story-vibepro-next-best-action-controller-acceptance.spec.ts](test/e2e/story-vibepro-next-best-action-controller-acceptance.spec.ts), [test/guarded-run-session.test.js](test/guarded-run-session.test.js), [test/next-best-action-controller.test.js](test/next-best-action-controller.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 70 focused unit and regression tests pass after rebase; evidence: [.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json)
- [x] Integration Gate - 70 focused controller integration and regression tests pass after CI import; evidence: [.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/focused-unit-status.json)
- [x] E2E Gate - 3 end-to-end guarded Run acceptance flows pass after rebase; evidence: [.vibepro/evidence/story-vibepro-next-best-action-controller/acceptance-flow-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/acceptance-flow-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-next-best-action-controller/acceptance-flow-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/acceptance-flow-status.json)
- 最終E2E: pass: 3 end-to-end guarded Run acceptance flows pass after rebase（[.vibepro/evidence/story-vibepro-next-best-action-controller/acceptance-flow-status.json](.vibepro/evidence/story-vibepro-next-best-action-controller/acceptance-flow-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-next-best-action-controller/](.vibepro/pr/story-vibepro-next-best-action-controller/)
- PR準備: [.vibepro/pr/story-vibepro-next-best-action-controller/pr-prepare.json](.vibepro/pr/story-vibepro-next-best-action-controller/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-next-best-action-controller/decision-index.json](.vibepro/pr/story-vibepro-next-best-action-controller/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 2b53e4c44cff codex/story-vibepro-next-best-action-controller clean (story=story-vibepro-next-best-action-controller)
