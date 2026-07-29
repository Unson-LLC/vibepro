## 判断
- このPRで判断すること: Release noteのrepo-root docsリンクをcanonical source URLへ正規化する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-release-note-link-normalization - Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
- 正本: [docs/management/stories/active/story-vibepro-release-note-link-normalization.md](docs/management/stories/active/story-vibepro-release-note-link-normalization.md)
- 変更範囲: 9 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-release-note-link-normalization.md](docs/management/stories/active/story-vibepro-release-note-link-normalization.md), [docs/architecture/story-vibepro-release-note-link-normalization.md](docs/architecture/story-vibepro-release-note-link-normalization.md), [docs/specs/story-vibepro-release-note-link-normalization.vibepro.json](docs/specs/story-vibepro-release-note-link-normalization.vibepro.json), ...and 1 more
- 実装: scripts/post-merge-release.mjs
- テスト: [test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js](test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js), [test/e2e/story-vibepro-release-note-link-normalization-acceptance.spec.js](test/e2e/story-vibepro-release-note-link-normalization-acceptance.spec.js), [test/post-merge-release.test.js](test/post-merge-release.test.js)

## 経緯
- 要求: Release noteのrepo-root docsリンクをcanonical source URLへ正規化する
- 発生経緯: PR本文でStoryや設計文書をrepo-root相対の`docs/...`リンクとして参照しても、post-merge release historyとVitePress buildが壊れないようにする。 PR #350のChange Summaryにある`docs/management/...md`リンクが、`docs/releases/`と`docs/ja/releases/`へ無変換で投影された。その結果、VitePressは各release page配下の`docs/management/...`として解決し、dead linkでbuildを停止する。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-release-note-link-normalization.md](docs/management/stories/active/story-vibepro-release-note-link-normalization.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-release-note-link-normalization.md](docs/management/stories/active/story-vibepro-release-note-link-normalization.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 26 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/post-merge-release.mjs
- テスト差分: [test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js](test/e2e/story-vibepro-pr-driven-continuous-release-main.test.js), [test/e2e/story-vibepro-release-note-link-normalization-acceptance.spec.js](test/e2e/story-vibepro-release-note-link-normalization-acceptance.spec.js), [test/post-merge-release.test.js](test/post-merge-release.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Release projection unit boundaries, backslash-safe serialization, and CI output isolation pass; 32/32.; evidence: [.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/unit.json](.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/unit.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/unit.json](.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/unit.json)
- [x] Integration Gate - 32/32 pass: negative_path and failure mode coverage preserves malformed, protected, external, anchor, and root-relative destinations while later valid links still project; release_note projection is identical across CHANGELOG and English/Japanese release histories; rollout_plan uses the trusted default-branch workflow; rollback_instruction is a single-commit behavior revert with no state migration; observability_evidence is the three generated release surfaces plus CI and run artifacts; evidence: [.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/integration.json](.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/integration.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/integration.json](.vibepro/pr/story-vibepro-release-note-link-normalization/run-artifacts/integration.json)
- [x] E2E Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD cd21e65ae408; evidence: [.vibepro/pr/story-vibepro-release-note-link-normalization/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-release-note-link-normalization/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-release-note-link-normalization/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-release-note-link-normalization/ci-evidence/test_22_.json)
- 最終E2E: pass: Imported CI evidence for test (22) (SUCCESS) at HEAD cd21e65ae408（[.vibepro/pr/story-vibepro-release-note-link-normalization/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-release-note-link-normalization/ci-evidence/test_22_.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-release-note-link-normalization/](.vibepro/pr/story-vibepro-release-note-link-normalization/)
- PR準備: [.vibepro/pr/story-vibepro-release-note-link-normalization/pr-prepare.json](.vibepro/pr/story-vibepro-release-note-link-normalization/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-release-note-link-normalization/decision-index.json](.vibepro/pr/story-vibepro-release-note-link-normalization/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 cd21e65ae408 codex/fix-release-note-story-links clean (story=story-vibepro-release-note-link-normalization)
