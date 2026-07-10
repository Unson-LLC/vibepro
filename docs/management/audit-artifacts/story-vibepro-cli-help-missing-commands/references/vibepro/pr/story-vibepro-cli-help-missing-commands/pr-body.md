## 判断
- このPRで判断すること: CLI --help Usage must list runtime commands story map, task brief/plan/handoff, and check list を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-cli-help-missing-commands - CLI --help Usage must list runtime commands story map, task brief/plan/handoff, and check list
- 正本: [docs/management/stories/active/story-vibepro-cli-help-missing-commands.md](docs/management/stories/active/story-vibepro-cli-help-missing-commands.md)
- 変更範囲: 6 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-cli-help-missing-commands.md](docs/management/stories/active/story-vibepro-cli-help-missing-commands.md), [docs/architecture/vibepro-cli-help-missing-commands.md](docs/architecture/vibepro-cli-help-missing-commands.md), [docs/specs/vibepro-cli-help-missing-commands.md](docs/specs/vibepro-cli-help-missing-commands.md)
- 実装: [src/cli.js](src/cli.js)
- テスト: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: CLI --help Usage must list runtime commands story map, task brief/plan/handoff, and check list
- 発生経緯: Story文書から経緯を抽出できませんでした。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-cli-help-missing-commands.md](docs/management/stories/active/story-vibepro-cli-help-missing-commands.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js)
- テスト差分: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/typecheck-status.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/typecheck-status.json)
- [x] Unit Gate - CLI help/usage unit tests pass at current HEAD: ja+en render check list, story map, task brief|plan|handoff. unit_regression bound to VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-PR-001 VIBE-CORE-AR-001 VIBE-CORE-EV-001 VIBE-CORE-COST-001 VIBE-CORE-STORY-001 VIBE-CORE-STATUS-001 VIBE-CORE-JUDGE-001 VIBE-CORE-WT-001; evidence: [.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/cli-status.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/cli-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/cli-status.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/cli-status.json)
- [x] E2E Gate - End-to-end CLI verification at current HEAD: vibepro help renders the 5 documented Usage lines in ja and en; vibepro check list lists diagnosis packs.; evidence: [.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/e2e-status.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/e2e-status.json)
- 最終E2E: pass: End-to-end CLI verification at current HEAD: vibepro help renders the 5 documented Usage lines in ja and en; vibepro check list lists diagnosis packs.（[.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/e2e-status.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/verification-artifacts/e2e-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-cli-help-missing-commands/](.vibepro/pr/story-vibepro-cli-help-missing-commands/)
- PR準備: [.vibepro/pr/story-vibepro-cli-help-missing-commands/pr-prepare.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-cli-help-missing-commands/decision-index.json](.vibepro/pr/story-vibepro-cli-help-missing-commands/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 747ecfe4750b claude/bold-torvalds-30d996 clean (story=story-vibepro-cli-help-missing-commands)
