## 判断
- このPRで判断すること: Story別routing profileとlineage付きprojectionでfeature packetを正本化する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-routing-profiles-rendered-projections - Story別routing profileとlineage付きprojectionでfeature packetを正本化する
- 正本: [docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md](docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md)
- 変更範囲: 24 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md](docs/management/stories/active/story-vibepro-routing-profiles-rendered-projections.md), [docs/architecture/story-vibepro-routing-profiles-rendered-projections.md](docs/architecture/story-vibepro-routing-profiles-rendered-projections.md), [docs/features/routing-profiles-rendered-projections/02_functional_spec.md](docs/features/routing-profiles-rendered-projections/02_functional_spec.md)
- 実装: [src/agent-review.js](src/agent-review.js), [src/artifact-routing.js](src/artifact-routing.js), [src/cli.js](src/cli.js), ...and 6 more
- テスト: [test/artifact-routing.test.js](test/artifact-routing.test.js), [test/e2e/story-vibepro-artifact-output-routing-main.spec.ts](test/e2e/story-vibepro-artifact-output-routing-main.spec.ts), [test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts](test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts), ...and 2 more

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
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/agent-review.js](src/agent-review.js), [src/artifact-routing.js](src/artifact-routing.js), [src/cli.js](src/cli.js), [src/diagnostic-engine.js](src/diagnostic-engine.js), ...
- テスト差分: [test/artifact-routing.test.js](test/artifact-routing.test.js), [test/e2e/story-vibepro-artifact-output-routing-main.spec.ts](test/e2e/story-vibepro-artifact-output-routing-main.spec.ts), [test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts](test/e2e/story-vibepro-routing-profiles-rendered-projections-main.spec.ts), [test/evidence-depth-pr-prepare.test.js](test/evidence-depth-pr-prepare.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - 104 unit assertions pass for VIBE-RAR-001 VIBE-RAR-002 and VIBE-CORE-COST-001 on HEAD 63c6a30e; evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/verification-evidence.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/verification-evidence.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/verification-evidence.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/verification-evidence.json)
- [x] Integration Gate - 111 integration assertions pass for VIBE-CORE-COST-001 and guarded run orchestration; CI Node 22 durable artifact confirms current HEAD; evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/ci-evidence/test_22_.json)
- [x] E2E Gate - 56 Story acceptance E2E assertions pass on HEAD 63c6a30e; evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/unit-status.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/unit-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/unit-status.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/unit-status.json)
- 最終E2E: pass: 56 Story acceptance E2E assertions pass on HEAD 63c6a30e（[.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/unit-status.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/preflight-artifacts/unit-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/)
- PR準備: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/pr-prepare.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/decision-index.json](.vibepro/pr/story-vibepro-routing-profiles-rendered-projections/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.2.0-beta.1 63c6a30ed16d codex/issue-359-routing-profiles-projections clean (story=story-vibepro-routing-profiles-rendered-projections)
