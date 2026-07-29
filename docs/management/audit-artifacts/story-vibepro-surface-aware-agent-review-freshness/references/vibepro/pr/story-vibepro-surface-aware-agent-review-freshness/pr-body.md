## 判断
- このPRで判断すること: Agent Review freshnessを検査surfaceとrelease-impactに束縛する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-surface-aware-agent-review-freshness - Agent Review freshnessを検査surfaceとrelease-impactに束縛する
- 正本: [docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md](docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)
- 変更範囲: 17 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md](docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md), [docs/architecture/story-vibepro-surface-aware-agent-review-freshness.md](docs/architecture/story-vibepro-surface-aware-agent-review-freshness.md), [docs/architecture/vibepro-content-scoped-evidence-freshness.md](docs/architecture/vibepro-content-scoped-evidence-freshness.md), ...and 2 more
- 実装: [src/agent-review.js](src/agent-review.js)
- テスト: [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js](test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js), [test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts](test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts), ...and 2 more

## 経緯
- 要求: Agent Review freshnessを検査surfaceとrelease-impactに束縛する
- 発生経緯: **As a** 複数セッションでmain更新とrebaseを挟みながらVibePro Storyを進める開発者 **I want** 必須Agent ReviewがHEAD SHAではなく実際に検査したsurfaceとrelease-impactの変化で失効すること **So that** 無関係なmain advance、rebase、証跡timestamp、予算設定だけで全レビューをやり直さず、安全にPRを完遂できる 1. Surface-aware freshness policy 2. Rebase and fail-closed regression coverage 3. Contract and operator guidance


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md](docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md](docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/agent-review.js](src/agent-review.js)
- テスト差分: [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js](test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js), [test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts](test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts), [test/e2e/story-vibepro-surface-aware-agent-review-freshness-main.spec.ts](test/e2e/story-vibepro-surface-aware-agent-review-freshness-main.spec.ts), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Current HEAD focused freshness/lifecycle regression 39/39 pass with responsibility contract bindings.; evidence: ../../../../../../tmp/vibepro-focused-final.tap / gate: passed / evidence: ../../../../../../tmp/vibepro-focused-final.tap
- [x] Integration Gate - Imported CI evidence for CodeQL (SUCCESS) at HEAD 2411506a2ffd; evidence: [.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/ci-evidence/CodeQL.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/ci-evidence/CodeQL.json)
- [x] E2E Gate - Surface-aware freshness E2E matrix passed 8/8 after current code freeze.; evidence: ../../../../../../tmp/vibepro-surface-aware-e2e.tap / gate: passed / evidence: ../../../../../../tmp/vibepro-surface-aware-e2e.tap
- 最終E2E: pass: Surface-aware freshness E2E matrix passed 8/8 after current code freeze.（../../../../../../tmp/vibepro-surface-aware-e2e.tap）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/](.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/)
- PR準備: [.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/pr-prepare.json](.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/decision-index.json](.vibepro/pr/story-vibepro-surface-aware-agent-review-freshness/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.2.0-beta.1 2411506a2ffd codex/story-vibepro-surface-aware-agent-review-freshness clean (story=story-vibepro-surface-aware-agent-review-freshness)
