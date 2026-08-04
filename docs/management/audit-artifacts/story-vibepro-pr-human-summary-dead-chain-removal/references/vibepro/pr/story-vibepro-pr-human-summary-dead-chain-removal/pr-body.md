## 判断
- このPRで判断すること: 死んだ人間向けPRサマリーレンダラーチェーンを削除する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-pr-human-summary-dead-chain-removal - 死んだ人間向けPRサマリーレンダラーチェーンを削除する
- 正本: [docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md](docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md)
- 変更範囲: 7 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md](docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md), [docs/specs/story-vibepro-pr-human-summary-dead-chain-removal.md](docs/specs/story-vibepro-pr-human-summary-dead-chain-removal.md)
- 実装: [src/pr-manager.js](src/pr-manager.js)
- テスト: [test/e2e/story-vibepro-pr-human-summary-dead-chain-removal-main.test.js](test/e2e/story-vibepro-pr-human-summary-dead-chain-removal-main.test.js), [test/e2e/story-vibepro-uiux-intake-gate-pr-summary-surfaces-main.test.js](test/e2e/story-vibepro-uiux-intake-gate-pr-summary-surfaces-main.test.js), [test/pr-human-summary-uiux-intake-gate.test.js](test/pr-human-summary-uiux-intake-gate.test.js)

## 経緯
- 要求: 死んだ人間向けPRサマリーレンダラーチェーンを削除する
- 発生経緯: PR #228「render concise VibePro PR bodies」で `renderPrDecisionSection` と `renderPrGateSummary` の呼び出し元が本文レンダリングから除去されて以降、人間向けPRサマリーの2系統はproduction未参照のdead codeとして残っている（story-vibepro-uiux-intake-gate-pr-summary-surfaces の3独立レビューで確認済み）。PR #416 はcuratedラベル一覧を実gateノード集合へ揃えたが、再配線可否を本Storyで判定した結果、現行のconcise本文契約（`Engineering Judgment:` 出現禁止・判断narrative禁止・suppressed詳細禁止・20KB上限）が再配線内容を明示的に排除しており、同内容は review-cockpit.html / gate-dag.html が人間向け正本として提供している。よって dead chain は復元先を持たず、削除して迷いの原因（将来の再配線期待・二重curation負担）を除去する。 削除対象（全てproduction呼び出し元ゼロ、chain内相互参照のみ）:


## 原因
- PR #228「render concise VibePro PR bodies」で `renderPrDecisionSection` と `renderPrGateSummary` の呼び出し元が本文レンダリングから除去されて以降、人間向けPRサマリーの2系統はproduction未参照のdead codeとして残っている（story-vibepro-uiux-intake-gate-pr-summary-surfaces の3独立レビューで確認済み）。PR #416 はcuratedラベル一覧を実gateノード集合へ揃えたが、再配線可否を本Storyで判定した結果、現行のconcise本文契約（`Engineering Judgment:` 出現禁止・判断narrative禁止・suppressed詳細禁止・20KB上限）が再配線内容を明示的に排除しており、同内容は review-cockpit.html / gate-dag.html が人間向け正本として提供している。よって dead chain は復元先を持たず、削除して迷いの原因（将来の再配線期待・二重curation負担）を除去する。 削除対象（全てproduction呼び出し元ゼロ、chain内相互参照のみ）: - `renderPrDecisionSection` とその専用helper: `buildHumanMergeDecision` /...

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md](docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-vibepro-pr-human-summary-dead-chain-removal
- Task ID: なし
- 対象受入基準: 4件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md](docs/management/stories/active/story-vibepro-pr-human-summary-dead-chain-removal.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: [src/pr-manager.js](src/pr-manager.js)
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/typecheck.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/typecheck.json)
- [x] Unit Gate - Full suite passes after dead chain removal at head f44165f2 (runner-direct execution: 2416 tests, 0 fail; artifact is the runner-written unit.json of that run); evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/unit.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/unit.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/unit.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/unit.json)
- [x] Integration Gate - vibepro verify run executed the integration command: exit_code=0, tests=74 pass=74 fail=0, duration_ms=26062, status=pass computed from the exit code | agent summary: Integration run across the touched responsibility surfaces: process-record store integration, responsibility authority gate, agent review lifecycle, story discovery, engineering judgment activation, managed worktree policy, and the story e2e replay; evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/integration.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/integration.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/integration.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/integration.json)
- [x] E2E Gate - Story e2e replay (runner-direct execution at this head: 4 tests, 0 fail; artifact is the runner-written e2e.json of that run); evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/e2e.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/e2e.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/e2e.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/e2e.json)
- 最終E2E: pass: Story e2e replay (runner-direct execution at this head: 4 tests, 0 fail; artifact is the runner-written e2e.json of that run)（[.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/e2e.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/)
- PR準備: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/pr-prepare.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/decision-index.json](.vibepro/pr/story-vibepro-pr-human-summary-dead-chain-removal/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.2.0-beta.2 f44165f2c03c claude/youthful-fermi-2f2520 clean (story=story-vibepro-pr-human-summary-dead-chain-removal)
