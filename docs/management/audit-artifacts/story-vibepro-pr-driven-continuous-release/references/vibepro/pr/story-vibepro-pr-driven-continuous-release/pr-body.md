## 判断
- このPRで判断すること: PRマージからマニュアル・VitePress・npmまで完全自動でリリースする を満たすための Runtime / Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-pr-driven-continuous-release - PRマージからマニュアル・VitePress・npmまで完全自動でリリースする
- 正本: [docs/management/stories/active/story-vibepro-pr-driven-continuous-release.md](docs/management/stories/active/story-vibepro-pr-driven-continuous-release.md)
- 変更範囲: 23 files / Runtime / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-pr-driven-continuous-release.md](docs/management/stories/active/story-vibepro-pr-driven-continuous-release.md), [docs/architecture/vibepro-pr-driven-continuous-release.md](docs/architecture/vibepro-pr-driven-continuous-release.md), [docs/specs/vibepro-pr-driven-continuous-release.md](docs/specs/vibepro-pr-driven-continuous-release.md)
- 実装: scripts/npm-release-lock.mjs, scripts/post-merge-release.mjs, [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js](test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js), [test/post-merge-release.test.js](test/post-merge-release.test.js), [test/public-release-notes.test.js](test/public-release-notes.test.js), ...and 1 more

## 経緯
- 要求: PRマージからマニュアル・VitePress・npmまで完全自動でリリースする
- 要求ID: pr-driven-continuous-release-2026-07-18
- 発生経緯: Story文書から経緯を抽出できませんでした。


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- main向けPRのマージを起点に、VibePro PR本文の安定したRelease Notesセクションを日英のVitePress履歴とCHANGELOGへ決定的に投影し、毎回マニュアルをデプロイする。package versionが増加した場合だけ、同じmerge commitとリリースノートへGitHub Releaseとnpm公開を結び付け、CAS leaseと再照合で不可逆処理を直列化する。

## Release Notes

### Change Summary
main向けPRのマージを起点に、VibePro PR本文の安定したRelease Notesセクションを日英のVitePress履歴とCHANGELOGへ決定的に投影し、毎回マニュアルをデプロイする。package versionが増加した場合だけ、同じmerge commitとリリースノートへGitHub Releaseとnpm公開を結び付け、CAS leaseと再照合で不可逆処理を直列化する。

### Compatibility
既存CLIとversion不変PRの挙動は維持する。npm公開は増加したSemVerだけが対象で、`0.2.0-beta.1` はprereleaseとして `beta` と単調な `latest` 判定を明示的に適用する。

### User Action
なし。PR作成者はマージ前にChange Summary、Compatibility、User Actionの3節が利用者向けの内容になっていることを確認する。

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている; baseからのcommitが 15 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/npm-release-lock.mjs, scripts/post-merge-release.mjs, [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js](test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js), [test/post-merge-release.test.js](test/post-merge-release.test.js), [test/public-release-notes.test.js](test/public-release-notes.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: not_applicable / evidence: [.vibepro/evidence/story-vibepro-pr-driven-continuous-release/release-surfaces-6086ea0a.json](.vibepro/evidence/story-vibepro-pr-driven-continuous-release/release-surfaces-6086ea0a.json)
- 最終E2E: pass: 24 current-head release flow tests prove version stamp propagation: running session reads expected artifact version 6086ea0a（[.vibepro/evidence/story-vibepro-pr-driven-continuous-release/release-surfaces-6086ea0a.json](.vibepro/evidence/story-vibepro-pr-driven-continuous-release/release-surfaces-6086ea0a.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-pr-driven-continuous-release/](.vibepro/pr/story-vibepro-pr-driven-continuous-release/)
- PR準備: [.vibepro/pr/story-vibepro-pr-driven-continuous-release/pr-prepare.json](.vibepro/pr/story-vibepro-pr-driven-continuous-release/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-pr-driven-continuous-release/decision-index.json](.vibepro/pr/story-vibepro-pr-driven-continuous-release/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 6086ea0a94aa vibepro/story-vibepro-pr-driven-continuous-release-wzlakz clean (story=story-vibepro-pr-driven-continuous-release)
