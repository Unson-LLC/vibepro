## 判断
- このPRで判断すること: Story別routing profileとlineage付きprojectionでfeature packetを正本化する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-routing-profiles-rendered-projections - Story別routing profileとlineage付きprojectionでfeature packetを正本化する
- 正本: [docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md](docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- 変更範囲: 14 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/architecture/story-vibepro-routing-profiles-rendered-projections.md](docs/architecture/story-vibepro-routing-profiles-rendered-projections.md), [docs/features/routing-profiles-rendered-projections/02_functional_spec.md](docs/features/routing-profiles-rendered-projections/02_functional_spec.md)
- 実装: [src/agent-review.js](src/agent-review.js), [src/artifact-routing.js](src/artifact-routing.js), [src/cli.js](src/cli.js), ...and 5 more
- テスト: [test/artifact-routing.test.js](test/artifact-routing.test.js), [test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts](test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts), [test/responsibility-authority.test.js](test/responsibility-authority.test.js), ...and 1 more

## 経緯
- 要求: Story別routing profileとlineage付きprojectionでfeature packetを正本化する
- 要求ID: 359
- 要求URL: https://github.com/Unson-LLC/vibepro/issues/359
- 発生経緯: #341でrepository-levelのartifact path templateとgenerated projectionを導入したが、全Storyが同じrouting設定を使い、projectionはcanonical contentのbyte copyに限られる。feature lifecycleとcross-cutting governanceで異なる配置契約を持つrepositoryでは、Storyごとにprofileを選べず、人間向けMarkdownを別途手管理する必要がある。


## 原因
- 最新診断gateが needs_review

## 解決
- - `.vibepro/config.json`に複数のnamed routing profileを定義し、既存`artifact_routing.artifacts`は後方互換なdefaultとして扱う。 - `.vibepro/config.json`の`brainbase.stories[]`を`artifact_profile`と`feature_slug`のauthorityとする。named profileを選ぶStoryではStory frontmatterを必須mirrorとし、不在または不一致なら共通resolverは書込前にfail closedする。profile metadataを持たないlegacy/unconfigured Storyではmirrorを任意とする。 - projectionは`renderer`と`ownership`を持ち、generated viewにsource path、SHA-256、renderer/schema version、direct-edit prohibitionを埋め込む。 - `human_owned`はVibeProが上書きせず、`curated`は自動上書き対象外として明示的な運用境界を返す。 - migration dry-runはprofile変更、move/collision、stale projection、human-owned overwrite...

## Release Notes

### Change Summary
- `.vibepro/config.json`に複数のnamed routing profileを定義し、既存`artifact_routing.artifacts`は後方互換なdefaultとして扱う。 - `.vibepro/config.json`の`brainbase.stories[]`を`artifact_profile`と`feature_slug`のauthorityとする。named profileを選ぶStoryではStory frontmatterを必須mirrorとし、不在または不一致なら共通resolverは書込前にfail closedする。profile metadataを持たないlegacy/unconfigured Storyではmirrorを任意とする。 - projectionは`renderer`と`ownership`を持ち、generated viewにsource path、SHA-256、renderer/schema version、direct-edit prohibitionを埋め込む。 - `human_owned`はVibeProが上書きせず、`curated`は自動上書き対象外として明示的な運用境界を返す。 - migration dry-runはprofile変更、move/collision、stale projection、human-owned overwrite...

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 16 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- 主要ソース差分: [src/agent-review.js](src/agent-review.js), [src/artifact-routing.js](src/artifact-routing.js), [src/cli.js](src/cli.js), [src/content-binding.js](src/content-binding.js), ...
- テスト差分: [test/artifact-routing.test.js](test/artifact-routing.test.js), [test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts](test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts), [test/responsibility-authority.test.js](test/responsibility-authority.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/typecheck-status.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/typecheck-status.json)
- [x] Unit Gate - pass; evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json)
- [x] Integration Gate - pass; evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json)
- [x] E2E Gate - pass; evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json)
- 最終E2E: pass: pass（[.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/targeted-validation-b4.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/)
- PR準備: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/pr-prepare.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/decision-index.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 b4def95aac62 codex/graphify-read-side-effect dirty (story=story-vibepro-routing-profiles-rendered-projections)
