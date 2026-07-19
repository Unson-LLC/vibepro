## 判断
- このPRで判断すること: Make the VitePress lockfile installable on Linux CI を満たすための Runtime / Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-linux-rollup-ci-lock - Make the VitePress lockfile installable on Linux CI
- 正本: [docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md](docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md)
- 変更範囲: 12 files / Runtime / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md](docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md), [docs/architecture/story-vibepro-linux-rollup-ci-lock.md](docs/architecture/story-vibepro-linux-rollup-ci-lock.md), [docs/specs/story-vibepro-linux-rollup-ci-lock.vibepro.json](docs/specs/story-vibepro-linux-rollup-ci-lock.vibepro.json), ...and 1 more
- 実装: scripts/post-merge-release.mjs
- テスト: [test/post-merge-release.test.js](test/post-merge-release.test.js)

## 経緯
- 要求: Make the VitePress lockfile installable on Linux CI
- 発生経緯: After every merged PR, the Linux GitHub runner can install the committed dependency graph and build the VitePress manual deterministically. Post-merge run 29668367599 reached `Deploy VitePress manual`, but `npm ci` omitted `@rollup/rollup-linux-x64-gnu`. Rollup then raised `MODULE_NOT_FOUND` before VitePress could build.


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md](docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md](docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている; baseからのcommitが 2 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/post-merge-release.mjs
- テスト差分: [test/post-merge-release.test.js](test/post-merge-release.test.js)
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: not_applicable / evidence: [.vibepro/evidence/story-vibepro-linux-rollup-ci-lock/typecheck.json](.vibepro/evidence/story-vibepro-linux-rollup-ci-lock/typecheck.json)
- 最終E2E: pass: Artifact-bound replay of the merged-main release contract and its failure paths（[.vibepro/evidence/story-vibepro-linux-rollup-ci-lock/focused-tests.json](.vibepro/evidence/story-vibepro-linux-rollup-ci-lock/focused-tests.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-linux-rollup-ci-lock/](.vibepro/pr/story-vibepro-linux-rollup-ci-lock/)
- PR準備: [.vibepro/pr/story-vibepro-linux-rollup-ci-lock/pr-prepare.json](.vibepro/pr/story-vibepro-linux-rollup-ci-lock/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-linux-rollup-ci-lock/decision-index.json](.vibepro/pr/story-vibepro-linux-rollup-ci-lock/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 4d57b80973d6 vibepro/story-vibepro-linux-rollup-ci-lock clean (story=story-vibepro-linux-rollup-ci-lock)
