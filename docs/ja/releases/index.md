# リリースノート

VibeProで何が変わったかを、公開版と開発中の変更を分けて記録します。

## 公開版と開発マイルストーン

- **公開版**はGitHub Release、git tag、npm registryで確認できる版です。
- **開発マイルストーン**は、マージ済みPRから主要な変化を月ごとに再構成したものです。npmへ公開済みとは限りません。

2026年7月16日時点で、GitHubには**281件のmerged PR**があり、そのうち**273件が`main`向け**です。全件を並べるのではなく、利用・更新判断に影響するPRを選び、根拠として直接リンクしています。

## 公開済み

| 公開日 | Version | Channel | 内容 |
| --- | --- | --- | --- |
| 2026-07-18 | [`0.2.0-beta.1`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.1) | npm `latest` / `beta` | PRマージ後のcontinuous release |
| 2026-07-16 | [`0.2.0-beta.0`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.0) | npm `latest` / `beta` | release workflow完了後の現在の公開beta |
| 2026-06-07 | [`0.1.0-beta.0`](https://www.npmjs.com/package/vibepro/v/0.1.0-beta.0) | npm | 以前の公開beta |
| 2026-06-07 | [`0.1.0-alpha.0`](https://www.npmjs.com/package/vibepro/v/0.1.0-alpha.0) | npm `alpha` | 最初のnpm公開版 |
| 2026-05-05 | [`v0.1.0-internal-beta.1`](https://github.com/Unson-LLC/vibepro/releases/tag/v0.1.0-internal-beta.1) | GitHub pre-release / tag | internal beta |

## 開発履歴

| 期間 | Merged PR | 主な変化 |
| --- | ---: | --- |
| [2026年7月](/ja/releases/2026-07) | 64 | bounded evidence、UI/UX cockpit、semantic adjudication、guarded execution |
| [2026年6月](/ja/releases/2026-06) | 115 | Journey、managed worktree/merge、canonical audit、Design SSOT |
| [2026年5月](/ja/releases/2026-05) | 101 | Story/Spec/Gate基盤、review lifecycle、公開前check pack |
| [2026年1月](/ja/releases/2026-01) | 1 | 公開サイト検証の起点 |

実行中の版を確かめる場合は[バージョンとリリースチャネル](/ja/reference/version-history)を参照してください。全PRは[GitHubのmerged PR一覧](https://github.com/Unson-LLC/vibepro/pulls?q=is%3Apr+is%3Amerged)で確認できます。

<!-- vibepro-release-index-pr:349:start -->
- [PR #349](https://github.com/Unson-LLC/vibepro/pull/349) — [2026-07](/ja/releases/2026-07): story-vibepro-pr-driven-continuous-release - PRマージからマニュアル・VitePress・npmまで完全自動でリリースする
<!-- vibepro-release-index-pr:349:end -->

<!-- vibepro-release-index-pr:350:start -->
- [PR #350](https://github.com/Unson-LLC/vibepro/pull/350) — [2026-07](/ja/releases/2026-07): story-vibepro-post-merge-docs-clean-worktree - Keep the post-merge docs deployment worktree clean
<!-- vibepro-release-index-pr:350:end -->

<!-- vibepro-release-index-pr:351:start -->
- [PR #351](https://github.com/Unson-LLC/vibepro/pull/351) — [2026-07](/ja/releases/2026-07): story-vibepro-linux-rollup-ci-lock - Make the VitePress lockfile installable on Linux CI
<!-- vibepro-release-index-pr:351:end -->

<!-- vibepro-release-index-pr:352:start -->
- [PR #352](https://github.com/Unson-LLC/vibepro/pull/352) — [2026-07](/ja/releases/2026-07): story-vibepro-next-best-action-controller - トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい
<!-- vibepro-release-index-pr:352:end -->

<!-- vibepro-release-index-pr:353:start -->
- [PR #353](https://github.com/Unson-LLC/vibepro/pull/353) — [2026-07](/ja/releases/2026-07): story-vibepro-autonomy-roadmap-rebaseline - 直近追加Storyと衝突しない実装順へ再編したい
<!-- vibepro-release-index-pr:353:end -->

<!-- vibepro-release-index-pr:355:start -->
- [PR #355](https://github.com/Unson-LLC/vibepro/pull/355) — [2026-07](/ja/releases/2026-07): story-vibepro-release-note-link-normalization - Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
<!-- vibepro-release-index-pr:355:end -->

<!-- vibepro-release-index-pr:354:start -->
- [PR #354](https://github.com/Unson-LLC/vibepro/pull/354) — [2026-07](/ja/releases/2026-07): story-vibepro-artifact-output-routing - 成果物の正本出力先をリポジトリ設定で一意に制御する
<!-- vibepro-release-index-pr:354:end -->

<!-- vibepro-release-index-pr:357:start -->
- [PR #357](https://github.com/Unson-LLC/vibepro/pull/357) — [2026-07](/ja/releases/2026-07): story-vibepro-human-decision-checkpoint - 自律実行中に本当に必要な質問だけを受け、回答後に同じRunを再開したい
<!-- vibepro-release-index-pr:357:end -->

<!-- vibepro-release-index-pr:360:start -->
- [PR #360](https://github.com/Unson-LLC/vibepro/pull/360) — [2026-07](/ja/releases/2026-07): story-vibepro-agent-runtime-adapters - handoffとreview dispatch文書を作るだけでなく、利用可能なagent runtimeへ実行委譲したい
<!-- vibepro-release-index-pr:360:end -->

<!-- vibepro-release-index-pr:362:start -->
- [PR #362](https://github.com/Unson-LLC/vibepro/pull/362) — [2026-07](/ja/releases/2026-07): story-vibepro-risk-adaptive-validation-sequencing - 高コストFull Suite後に境界欠陥が見つかり、修正で証跡を全て取り直す順序を改善したい
<!-- vibepro-release-index-pr:362:end -->

<!-- vibepro-release-index-pr:363:start -->
- [PR #363](https://github.com/Unson-LLC/vibepro/pull/363) — [2026-07](/ja/releases/2026-07): story-vibepro-review-finding-repair-loop - needs_changesを停止報告で終わらせず、修正・再検証・再Reviewへ閉ループ化したい
<!-- vibepro-release-index-pr:363:end -->

<!-- vibepro-release-index-pr:364:start -->
- [PR #364](https://github.com/Unson-LLC/vibepro/pull/364) — [2026-07](/ja/releases/2026-07): story-vibepro-story-run-portfolio-controller - 複数Storyを一つの長大sessionへ混載せず、Storyごとに閉じて順次進めたい
<!-- vibepro-release-index-pr:364:end -->
