## 判断
- このPRで判断すること: Keep the post-merge docs deployment worktree clean を満たすための Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-post-merge-docs-clean-worktree - Keep the post-merge docs deployment worktree clean
- 正本: [docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md](docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md)
- 変更範囲: 7 files / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md](docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md), [docs/architecture/story-vibepro-post-merge-docs-clean-worktree.md](docs/architecture/story-vibepro-post-merge-docs-clean-worktree.md), [docs/specs/story-vibepro-post-merge-docs-clean-worktree.vibepro.json](docs/specs/story-vibepro-post-merge-docs-clean-worktree.vibepro.json), ...and 1 more
- テスト: [test/post-merge-release.test.js](test/post-merge-release.test.js)

## 経緯
- 要求: Keep the post-merge docs deployment worktree clean
- 発生経緯: After every merged PR, deploy the generated VitePress manual from the committed main state without violating the deploy script's clean-worktree safety check. The first post-merge run for PR #349 published npm and GitHub Release and committed release history, then failed during VitePress deployment because `npm ci` created an untracked `node_modules/` directory before a script that requires a clean worktree. Local runs masked this because `.git/info/exclude` is not transferred to GitHub runners.


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md](docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md](docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- テスト差分: [test/post-merge-release.test.js](test/post-merge-release.test.js)
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [ ] 手動確認または対象テストを追記する
- 最終E2E: not_applicable: Typed N/A: deployment bug physics requires version-stamp propagation evidence; code correctness gates are not proof that the running session uses the expected artifact

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-post-merge-docs-clean-worktree/](.vibepro/pr/story-vibepro-post-merge-docs-clean-worktree/)
- PR準備: [.vibepro/pr/story-vibepro-post-merge-docs-clean-worktree/pr-prepare.json](.vibepro/pr/story-vibepro-post-merge-docs-clean-worktree/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-post-merge-docs-clean-worktree/decision-index.json](.vibepro/pr/story-vibepro-post-merge-docs-clean-worktree/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 971be8775b4c vibepro/story-vibepro-post-merge-docs-clean-worktree clean (story=story-vibepro-post-merge-docs-clean-worktree)
