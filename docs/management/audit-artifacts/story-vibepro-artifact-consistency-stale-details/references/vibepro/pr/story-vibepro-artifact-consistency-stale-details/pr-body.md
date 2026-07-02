## 判断
- このPRで判断すること: Artifact Consistency Gateでstale artifactの原因と復旧手順を出す を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-artifact-consistency-stale-details - Artifact Consistency Gateでstale artifactの原因と復旧手順を出す
- 正本: [docs/management/stories/active/story-vibepro-artifact-consistency-stale-details.md](docs/management/stories/active/story-vibepro-artifact-consistency-stale-details.md)
- 変更範囲: 6 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-artifact-consistency-stale-details.md](docs/management/stories/active/story-vibepro-artifact-consistency-stale-details.md), [docs/architecture/vibepro-artifact-consistency-stale-details.md](docs/architecture/vibepro-artifact-consistency-stale-details.md), [docs/specs/vibepro-artifact-consistency-stale-details.md](docs/specs/vibepro-artifact-consistency-stale-details.md)
- 実装: [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: Artifact Consistency Gateでstale artifactの原因と復旧手順を出す
- 要求ID: 271
- 発生経緯: Artifact Consistency Gateがstale evidenceを検出した時、現状は「何かが古い」ことは分かるが、どのartifactをどの順に復旧すればよいかがPR準備結果だけでは読み取りにくい。 VibeProはPR作成前の判断ブリーフとして、stale artifactごとの原因、影響、再実行すべきVibeProコマンドを機械可読・人間可読の両方で提示する。


## 原因
- Story文書から根本原因を抽出できませんでした。

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-artifact-consistency-stale-details.md](docs/management/stories/active/story-vibepro-artifact-consistency-stale-details.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/pr-manager.js](src/pr-manager.js)
- テスト差分: [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD 4cd9e442c237; evidence: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/test_22_.json)
- [x] Integration Gate - Imported CI evidence for CodeQL (SUCCESS) at HEAD 4cd9e442c237; evidence: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/CodeQL.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/ci-evidence/CodeQL.json)
- [x] E2E Gate - CLI pr prepare replay covers stale artifact detail output, review-surface remediation commands, path-bound story id fallback, AC-5 compatibility, and responsibility authority evidence on current HEAD.; evidence: [.vibepro/verification-artifacts/story-vibepro-artifact-consistency-stale-details/artifact-consistency-e2e-status.json](.vibepro/verification-artifacts/story-vibepro-artifact-consistency-stale-details/artifact-consistency-e2e-status.json) / gate: passed / evidence: [.vibepro/verification-artifacts/story-vibepro-artifact-consistency-stale-details/artifact-consistency-e2e-status.json](.vibepro/verification-artifacts/story-vibepro-artifact-consistency-stale-details/artifact-consistency-e2e-status.json)
- 最終E2E: pass: CLI pr prepare replay covers stale artifact detail output, review-surface remediation commands, path-bound story id fallback, AC-5 compatibility, and responsibility authority evidence on current HEAD.（[.vibepro/verification-artifacts/story-vibepro-artifact-consistency-stale-details/artifact-consistency-e2e-status.json](.vibepro/verification-artifacts/story-vibepro-artifact-consistency-stale-details/artifact-consistency-e2e-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/)
- PR準備: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/pr-prepare.json](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-artifact-consistency-stale-details/decision-index.json](.vibepro/pr/story-vibepro-artifact-consistency-stale-details/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 4cd9e442c237 codex/vibepro-artifact-consistency-details clean (story=story-vibepro-artifact-consistency-stale-details)
