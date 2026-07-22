# Release Notes

This history separates published VibePro versions from changes under development.

## Published Releases and Development Milestones

- A **published release** is verified by GitHub Releases, a git tag, or the npm registry.
- A **development milestone** is a reader-focused reconstruction of merged pull requests. It does not imply npm publication.

As of July 16, 2026, GitHub records **281 merged pull requests**, including **273 targeting `main`**. These notes select changes that affect adoption or upgrade decisions and link directly to the supporting PRs.

## Published

| Published | Version | Channel | Summary |
| --- | --- | --- | --- |
| 2026-07-18 | [`0.2.0-beta.1`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.1) | npm `latest` / `beta` | Post-merge continuous release |
| 2026-07-16 | [`0.2.0-beta.0`](https://www.npmjs.com/package/vibepro/v/0.2.0-beta.0) | npm `latest` / `beta` | Current published beta after the release workflow completes |
| 2026-06-07 | [`0.1.0-beta.0`](https://www.npmjs.com/package/vibepro/v/0.1.0-beta.0) | npm | Previous published beta |
| 2026-06-07 | [`0.1.0-alpha.0`](https://www.npmjs.com/package/vibepro/v/0.1.0-alpha.0) | npm `alpha` | First npm publication |
| 2026-05-05 | [`v0.1.0-internal-beta.1`](https://github.com/Unson-LLC/vibepro/releases/tag/v0.1.0-internal-beta.1) | GitHub pre-release / tag | Internal beta |

## Development History

| Period | Merged PRs | Highlights |
| --- | ---: | --- |
| [July 2026](/releases/2026-07) | 64 | Bounded evidence, UI/UX cockpit, semantic adjudication, guarded execution |
| [June 2026](/releases/2026-06) | 115 | Journey, managed worktrees and merges, canonical audit, Design SSOT |
| [May 2026](/releases/2026-05) | 101 | Story/Spec/Gate foundation, review lifecycle, pre-release check packs |
| [January 2026](/releases/2026-01) | 1 | Public-site verification starting point |

See [Version and Release Channels](/reference/version-history) to identify the version you are running. The complete source is the [merged pull-request list](https://github.com/Unson-LLC/vibepro/pulls?q=is%3Apr+is%3Amerged).

<!-- vibepro-release-index-pr:349:start -->
- [PR #349](https://github.com/Unson-LLC/vibepro/pull/349) — [2026-07](/releases/2026-07): story-vibepro-pr-driven-continuous-release - PRマージからマニュアル・VitePress・npmまで完全自動でリリースする
<!-- vibepro-release-index-pr:349:end -->

<!-- vibepro-release-index-pr:350:start -->
- [PR #350](https://github.com/Unson-LLC/vibepro/pull/350) — [2026-07](/releases/2026-07): story-vibepro-post-merge-docs-clean-worktree - Keep the post-merge docs deployment worktree clean
<!-- vibepro-release-index-pr:350:end -->

<!-- vibepro-release-index-pr:351:start -->
- [PR #351](https://github.com/Unson-LLC/vibepro/pull/351) — [2026-07](/releases/2026-07): story-vibepro-linux-rollup-ci-lock - Make the VitePress lockfile installable on Linux CI
<!-- vibepro-release-index-pr:351:end -->

<!-- vibepro-release-index-pr:352:start -->
- [PR #352](https://github.com/Unson-LLC/vibepro/pull/352) — [2026-07](/releases/2026-07): story-vibepro-next-best-action-controller - トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい
<!-- vibepro-release-index-pr:352:end -->

<!-- vibepro-release-index-pr:353:start -->
- [PR #353](https://github.com/Unson-LLC/vibepro/pull/353) — [2026-07](/releases/2026-07): story-vibepro-autonomy-roadmap-rebaseline - 直近追加Storyと衝突しない実装順へ再編したい
<!-- vibepro-release-index-pr:353:end -->

<!-- vibepro-release-index-pr:355:start -->
- [PR #355](https://github.com/Unson-LLC/vibepro/pull/355) — [2026-07](/releases/2026-07): story-vibepro-release-note-link-normalization - Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
<!-- vibepro-release-index-pr:355:end -->

<!-- vibepro-release-index-pr:354:start -->
- [PR #354](https://github.com/Unson-LLC/vibepro/pull/354) — [2026-07](/releases/2026-07): story-vibepro-artifact-output-routing - 成果物の正本出力先をリポジトリ設定で一意に制御する
<!-- vibepro-release-index-pr:354:end -->

<!-- vibepro-release-index-pr:357:start -->
- [PR #357](https://github.com/Unson-LLC/vibepro/pull/357) — [2026-07](/releases/2026-07): story-vibepro-human-decision-checkpoint - 自律実行中に本当に必要な質問だけを受け、回答後に同じRunを再開したい
<!-- vibepro-release-index-pr:357:end -->

<!-- vibepro-release-index-pr:360:start -->
- [PR #360](https://github.com/Unson-LLC/vibepro/pull/360) — [2026-07](/releases/2026-07): story-vibepro-agent-runtime-adapters - handoffとreview dispatch文書を作るだけでなく、利用可能なagent runtimeへ実行委譲したい
<!-- vibepro-release-index-pr:360:end -->

<!-- vibepro-release-index-pr:362:start -->
- [PR #362](https://github.com/Unson-LLC/vibepro/pull/362) — [2026-07](/releases/2026-07): story-vibepro-risk-adaptive-validation-sequencing - 高コストFull Suite後に境界欠陥が見つかり、修正で証跡を全て取り直す順序を改善したい
<!-- vibepro-release-index-pr:362:end -->

<!-- vibepro-release-index-pr:363:start -->
- [PR #363](https://github.com/Unson-LLC/vibepro/pull/363) — [2026-07](/releases/2026-07): story-vibepro-review-finding-repair-loop - needs_changesを停止報告で終わらせず、修正・再検証・再Reviewへ閉ループ化したい
<!-- vibepro-release-index-pr:363:end -->

<!-- vibepro-release-index-pr:364:start -->
- [PR #364](https://github.com/Unson-LLC/vibepro/pull/364) — [2026-07](/releases/2026-07): story-vibepro-story-run-portfolio-controller - 複数Storyを一つの長大sessionへ混載せず、Storyごとに閉じて順次進めたい
<!-- vibepro-release-index-pr:364:end -->

<!-- vibepro-release-index-pr:366:start -->
- [PR #366](https://github.com/Unson-LLC/vibepro/pull/366) — [2026-07](/releases/2026-07): story-vibepro-guarded-autonomy-hardening - 自律ループを無限実行や自己Reviewにせず、費用・時間・停止理由まで運用可能にしたい
<!-- vibepro-release-index-pr:366:end -->

<!-- vibepro-release-index-pr:367:start -->
- [PR #367](https://github.com/Unson-LLC/vibepro/pull/367) — [2026-07](/releases/2026-07): feat(artifact-routing): add profile-based projections
<!-- vibepro-release-index-pr:367:end -->

<!-- vibepro-release-index-pr:368:start -->
- [PR #368](https://github.com/Unson-LLC/vibepro/pull/368) — [2026-07](/releases/2026-07): story-vibepro-canonical-audit-gate-dag-replay - Summary depthのCanonical Audit Replayを欠損なく引き継ぐ
<!-- vibepro-release-index-pr:368:end -->

<!-- vibepro-release-index-pr:369:start -->
- [PR #369](https://github.com/Unson-LLC/vibepro/pull/369) — [2026-07](/releases/2026-07): feat: add explicit Run attribution lineage
<!-- vibepro-release-index-pr:369:end -->

<!-- vibepro-release-index-pr:371:start -->
- [PR #371](https://github.com/Unson-LLC/vibepro/pull/371) — [2026-07](/releases/2026-07): story-vibepro-explicit-run-attribution-lineage - Codex DesktopのThreadと内部sessionの対応は公開契約ではなく、利用者によるThread分離を正確な価値監査の前提にできない
<!-- vibepro-release-index-pr:371:end -->

<!-- vibepro-release-index-pr:374:start -->
- [PR #374](https://github.com/Unson-LLC/vibepro/pull/374) — [2026-07](/releases/2026-07): story-vibepro-managed-worktree-policy-resync - Managed worktreeのポリシーconfigを凍結させず親repoから再同期する
<!-- vibepro-release-index-pr:374:end -->

<!-- vibepro-release-index-pr:345:start -->
- [PR #345](https://github.com/Unson-LLC/vibepro/pull/345) — [2026-07](/releases/2026-07): story-vibepro-session-attribution-boundary-guard - 2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った
<!-- vibepro-release-index-pr:345:end -->

<!-- vibepro-release-index-pr:373:start -->
- [PR #373](https://github.com/Unson-LLC/vibepro/pull/373) — [2026-07](/releases/2026-07): story-vibepro-routing-profiles-rendered-projections - Story別routing profileとlineage付きprojectionでfeature packetを正本化する
<!-- vibepro-release-index-pr:373:end -->

<!-- vibepro-release-index-pr:375:start -->
- [PR #375](https://github.com/Unson-LLC/vibepro/pull/375) — [2026-07](/releases/2026-07): fix: policy_syncレビュー残課題3件を解消（#374 フォローアップ）
<!-- vibepro-release-index-pr:375:end -->

<!-- vibepro-release-index-pr:372:start -->
- [PR #372](https://github.com/Unson-LLC/vibepro/pull/372) — [2026-07](/releases/2026-07): story-vibepro-autonomous-action-dag - Guarded Runを完全な型付き自律Action DAGへ拡張する
<!-- vibepro-release-index-pr:372:end -->

<!-- vibepro-release-index-pr:370:start -->
- [PR #370](https://github.com/Unson-LLC/vibepro/pull/370) — [2026-07](/releases/2026-07): story-vibepro-trusted-delivery-efficiency-guardrail - 個別Gateの安全性だけでなく、Story全体の時間・subagent・token・再レビューを最適化したい
<!-- vibepro-release-index-pr:370:end -->

<!-- vibepro-release-index-pr:377:start -->
- [PR #377](https://github.com/Unson-LLC/vibepro/pull/377) — [2026-07](/releases/2026-07): story-vibepro-production-runtime-connectors - Agent Runtime Adapterへproduction connectorを接続する
<!-- vibepro-release-index-pr:377:end -->
