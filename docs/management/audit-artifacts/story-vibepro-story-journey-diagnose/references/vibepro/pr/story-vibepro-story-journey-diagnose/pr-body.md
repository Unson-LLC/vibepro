## 判断
- このPRで判断すること: Story診断でJourney未整理を見落とさない を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-story-journey-diagnose - Story診断でJourney未整理を見落とさない
- 正本: [docs/management/stories/active/story-vibepro-story-journey-diagnose.md](docs/management/stories/active/story-vibepro-story-journey-diagnose.md)
- 変更範囲: 7 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-story-journey-diagnose.md](docs/management/stories/active/story-vibepro-story-journey-diagnose.md), [docs/architecture/vibepro-story-journey-diagnose.md](docs/architecture/vibepro-story-journey-diagnose.md), [docs/specs/story-vibepro-story-journey-diagnose.md](docs/specs/story-vibepro-story-journey-diagnose.md)
- 実装: [src/story-html.js](src/story-html.js), [src/story-manager.js](src/story-manager.js)
- テスト: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: Story診断でJourney未整理を見落とさない
- 発生経緯: UI/Journeyに関係するStoryは、Story作成直後や`story diagnose`の時点でJourneyが未作成か、機械生成のcontext packだけか、curated Journeyまで整っているかを区別できる必要がある。 現状はPR Gate DAGではUI source changeに対して`gate:journey_context`が効くが、docs-onlyのUI StoryやStory診断段階ではJourney不足が見えにくい。そのため、実装前のStory運用でJourney作成・handoff・curated Journey作成の次アクションに進みにくい。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-story-journey-diagnose.md](docs/management/stories/active/story-vibepro-story-journey-diagnose.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/story-html.js](src/story-html.js), [src/story-manager.js](src/story-manager.js)
- テスト差分: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/typecheck.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/typecheck.status.json)
- [x] Unit Gate - Focused Story diagnose regression coverage passed on clean HEAD. Contract binding: VIBE-RAR-001, VIBE-RAR-002, and VIBE-CORE-COST-001 unit_regression evidence remains satisfied for unchanged owned surfaces.; evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json) / gate: passed / evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json)
- [x] Integration Gate - Full CLI and Journey regression suite passed 352/352 on clean HEAD, covering Story Journey diagnosis, public contract evidence, CI-success context, and VibePro responsibility-authority lifecycle contracts.; evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/full-cli-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/full-cli-journey-tests.status.json) / gate: passed / evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/full-cli-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/full-cli-journey-tests.status.json)
- [x] E2E Gate - Scenario-clause replay for Story Journey diagnosis passed on clean HEAD, covering CLI, Markdown, HTML, missing Journey, machine-derived vs curated, backend not_required, and unchanged PR Gate Journey behavior.; evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json) / gate: passed / evidence: [.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json)
- 最終E2E: pass: Scenario-clause replay for Story Journey diagnosis passed on clean HEAD, covering CLI, Markdown, HTML, missing Journey, machine-derived vs curated, backend not_required, and unchanged PR Gate Journey behavior.（[.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json](.vibepro/manual-verification/story-vibepro-story-journey-diagnose/cli-and-journey-tests.status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-story-journey-diagnose/](.vibepro/pr/story-vibepro-story-journey-diagnose/)
- PR準備: [.vibepro/pr/story-vibepro-story-journey-diagnose/pr-prepare.json](.vibepro/pr/story-vibepro-story-journey-diagnose/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-story-journey-diagnose/decision-index.json](.vibepro/pr/story-vibepro-story-journey-diagnose/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 8ba3388013a4 codex/issue-265-story-journey-diagnose clean (story=story-vibepro-story-journey-diagnose)
