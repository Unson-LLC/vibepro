# Changelog

All notable changes to VibePro will be documented in this file.

## Unreleased

- Bind ordinary reviews to their inspected content surface while keeping
  `gate_evidence` and `release_risk` reviews strictly bound to the full commit.
  Passing `review record` calls must now include `--inspection-summary`, at least
  one existing non-`.vibepro` `--inspection-input`, and `--judgment-delta`;
  existing automation must add these arguments when upgrading.

## 0.2.0-beta.1 - 2026-07-18

- Add a deterministic post-merge release pipeline that projects PR release notes
  into the bilingual VitePress manual and changelog, then deploys the manual for
  every merged `main` pull request.
- Publish GitHub Releases and npm packages only when `package.json` advances,
  with retry-safe registry reconciliation and explicit SemVer dist-tags.
- Standardize PR release-note sections so the authoring LLM writes the release
  explanation once before merge and post-merge automation performs no LLM calls.

## 0.2.0-beta.0 - 2026-07-16

- Document the complete guarded delivery loop: managed execution, independent
  review and adjudication, release guard, PR/CI refresh, merge, canonical audit,
  and usage/ROI reporting.
- Generate the bilingual CLI reference from the current shipped help contract
  and fail documentation builds when it drifts.
- Separate the published npm beta from current `main` and expose the documentation
  build's source commit.
- Promote and verify both npm `beta` and `latest` dist-tags during publication.
- Restrict the public manual build to curated guide/reference content, require
  production deploys to match freshly fetched `origin/main`, and add
  robots, sitemap, llms.txt, social metadata, and structured data.
- Expand UI/UX, Journey, Design System, review lifecycle, decision, guard,
  execution, audit, and ROI documentation for current VibePro behavior.

## 0.1.0-alpha.0

- Prepare the project for Apache-2.0 OSS publication.
- Add phase checkpoints for Story, implementation start, test plan, implementation completion, verification, and PR readiness.
- Add public-discovery live, built-output, and source target discovery with bounded scans, explicit omissions, and fail-closed coverage reporting.

<!-- vibepro-release-pr:349:start -->
## [#349](https://github.com/Unson-LLC/vibepro/pull/349) story-vibepro-pr-driven-continuous-release - PRマージからマニュアル・VitePress・npmまで完全自動でリリースする

- Author: @sintariran
- Merged: 2026-07-19T00:32:53Z
- Commit: `5bbfb6e42933d626199eb2c6fa4a402f1ee05bcc`

### Change Summary

main向けPRのマージを起点に、VibePro PR本文の安定したRelease Notesセクションを日英のVitePress履歴とCHANGELOGへ決定的に投影し、毎回マニュアルをデプロイする。package versionが増加した場合だけ、同じmerge commitとリリースノートへGitHub Releaseとnpm公開を結び付け、CAS leaseと再照合で不可逆処理を直列化する。

### Compatibility

既存CLIとversion不変PRの挙動は維持する。npm公開は増加したSemVerだけが対象で、`0.2.0-beta.1` はprereleaseとして `beta` と単調な `latest` 判定を明示的に適用する。

### User Action

なし。PR作成者はマージ前にChange Summary、Compatibility、User Actionの3節が利用者向けの内容になっていることを確認する。

<!-- vibepro-release-pr:349:end -->

<!-- vibepro-release-pr:350:start -->
## [#350](https://github.com/Unson-LLC/vibepro/pull/350) story-vibepro-post-merge-docs-clean-worktree - Keep the post-merge docs deployment worktree clean

- Author: @sintariran
- Merged: 2026-07-19T01:18:06Z
- Commit: `1846cff28afd89d23368e29e05f12019dd1a77d6`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-post-merge-docs-clean-worktree.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:350:end -->

<!-- vibepro-release-pr:351:start -->
## [#351](https://github.com/Unson-LLC/vibepro/pull/351) story-vibepro-linux-rollup-ci-lock - Make the VitePress lockfile installable on Linux CI

- Author: @sintariran
- Merged: 2026-07-19T02:12:55Z
- Commit: `fc2f2efebe8420ea4ff300f27ced8edd448c5fa3`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-linux-rollup-ci-lock.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:351:end -->

<!-- vibepro-release-pr:352:start -->
## [#352](https://github.com/Unson-LLC/vibepro/pull/352) story-vibepro-next-best-action-controller - トークン最小ではなくTrusted PR-readyまでの総コストで次のActionを選びたい

- Author: @sintariran
- Merged: 2026-07-19T02:30:39Z
- Commit: `b89bf7f3fc89f74395625db1278774ad0f2e3993`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-next-best-action-controller.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-next-best-action-controller.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:352:end -->

<!-- vibepro-release-pr:353:start -->
## [#353](https://github.com/Unson-LLC/vibepro/pull/353) story-vibepro-autonomy-roadmap-rebaseline - 直近追加Storyと衝突しない実装順へ再編したい

- Author: @sintariran
- Merged: 2026-07-19T03:40:14Z
- Commit: `5cdd7650f07de5a8fda7100f6d6d2fbd9011d68f`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-autonomy-roadmap-rebaseline.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-autonomy-roadmap-rebaseline.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:353:end -->

<!-- vibepro-release-pr:355:start -->
## [#355](https://github.com/Unson-LLC/vibepro/pull/355) story-vibepro-release-note-link-normalization - Release noteのrepo-root docsリンクをcanonical source URLへ正規化する

- Author: @sintariran
- Merged: 2026-07-19T06:17:39Z
- Commit: `d82e0ab9518bd81580063b645411fbfd465c1a90`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-release-note-link-normalization.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-release-note-link-normalization.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:355:end -->

<!-- vibepro-release-pr:354:start -->
## [#354](https://github.com/Unson-LLC/vibepro/pull/354) story-vibepro-artifact-output-routing - 成果物の正本出力先をリポジトリ設定で一意に制御する

- Author: @sintariran
- Merged: 2026-07-19T08:49:44Z
- Commit: `ffeacc5097e5b90bfee256fb69cf4383a3fb388c`

### Change Summary

- `.vibepro/config.json` に成果物種別ごとの canonical path template と、中央 writer を持つ種別の任意の projection を宣言できるようにする。 - 共通 resolver が `{story_id}` と `{feature_slug}` を展開し、生成側と検出側の双方へ同じ結果を返す。 - 未設定時は既存の出力先を維持する。 - 絶対パス、repository traversal、未解決変数、canonical 同士の衝突は書き込み前に fail closed する。 - migration plan は dry-run で移動元、移動先、衝突、未解決項目を表示し、暗黙には移動しない。

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:354:end -->

<!-- vibepro-release-pr:357:start -->
## [#357](https://github.com/Unson-LLC/vibepro/pull/357) story-vibepro-human-decision-checkpoint - 自律実行中に本当に必要な質問だけを受け、回答後に同じRunを再開したい

- Author: @sintariran
- Merged: 2026-07-19T11:09:40Z
- Commit: `006d5fb5abe9889f91ad282001bd0095133bc957`

### Change Summary

Story文書を更新: [docs/management/stories/active/story-vibepro-human-decision-checkpoint.md](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-human-decision-checkpoint.md)

### Compatibility

なし

### User Action

なし

<!-- vibepro-release-pr:357:end -->
