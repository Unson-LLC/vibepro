## 判断
- このPRで判断すること: Managed worktreeのポリシーconfigを凍結させず親repoから再同期する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-managed-worktree-policy-resync - Managed worktreeのポリシーconfigを凍結させず親repoから再同期する
- 正本: [docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md](docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md](docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md), [docs/architecture/story-vibepro-managed-worktree-policy-resync.md](docs/architecture/story-vibepro-managed-worktree-policy-resync.md), [docs/specs/story-vibepro-managed-worktree-policy-resync.md](docs/specs/story-vibepro-managed-worktree-policy-resync.md)
- 実装: [src/execution-state.js](src/execution-state.js), [src/managed-worktree.js](src/managed-worktree.js)
- テスト: [test/e2e/story-vibepro-managed-worktree-policy-resync-main.spec.ts](test/e2e/story-vibepro-managed-worktree-policy-resync-main.spec.ts), [test/e2e/story-vibepro-managed-worktree-policy-resync-main.test.js](test/e2e/story-vibepro-managed-worktree-policy-resync-main.test.js), [test/managed-worktree-policy-resync.test.js](test/managed-worktree-policy-resync.test.js)

## 経緯
- 要求: Managed worktreeのポリシーconfigを凍結させず親repoから再同期する
- 発生経緯: 親repoの.vibepro/config.jsonで配布したポリシー（budgets.delivery_efficiency等のトークン/subagent予算enforcement）が、既存のmanaged worktreeにもrefresh時点で確実に反映され、worktreeごとに古い予算・実行ポリシーで動き続けることがなくなる。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md](docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md](docs/management/stories/active/story-vibepro-managed-worktree-policy-resync.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 7 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/execution-state.js](src/execution-state.js), [src/managed-worktree.js](src/managed-worktree.js)
- テスト差分: [test/e2e/story-vibepro-managed-worktree-policy-resync-main.spec.ts](test/e2e/story-vibepro-managed-worktree-policy-resync-main.spec.ts), [test/e2e/story-vibepro-managed-worktree-policy-resync-main.test.js](test/e2e/story-vibepro-managed-worktree-policy-resync-main.test.js), [test/managed-worktree-policy-resync.test.js](test/managed-worktree-policy-resync.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [ ] 手動確認または対象テストを追記する
- 最終E2E: pass: flow replay at head 78982951: (1) policy distribution journey against real git、(2) 合成CLIフロー gate check→reconcile→execute status のlast_event監査、(3) 支配的経路buildManagedWorktreeGateの同期実行とpolicy_sync表面化、(4) worktree内execute statusのデフォルトtext出力でfailed policy syncが可視。TAP 9/9 pass（[.vibepro/evidence/story-vibepro-managed-worktree-policy-resync/artifacts/managed-worktree-policy-resync.tap](.vibepro/evidence/story-vibepro-managed-worktree-policy-resync/artifacts/managed-worktree-policy-resync.tap)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-managed-worktree-policy-resync/](.vibepro/pr/story-vibepro-managed-worktree-policy-resync/)
- PR準備: [.vibepro/pr/story-vibepro-managed-worktree-policy-resync/pr-prepare.json](.vibepro/pr/story-vibepro-managed-worktree-policy-resync/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-managed-worktree-policy-resync/decision-index.json](.vibepro/pr/story-vibepro-managed-worktree-policy-resync/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 78982951496a vibepro/story-vibepro-managed-worktree-policy-resync-30pnn9 dirty (story=story-vibepro-managed-worktree-policy-resync)
