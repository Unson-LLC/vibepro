## 判断
- このPRで判断すること: execution gate blockedのまま、エージェントが直接git push / raw PR作成 / デプロイでVibeProを素通りした を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-release-surface-guard - execution gate blockedのまま、エージェントが直接git push / raw PR作成 / デプロイでVibeProを素通りした
- 正本: [docs/management/stories/active/story-vibepro-release-surface-guard.md](docs/management/stories/active/story-vibepro-release-surface-guard.md)
- 変更範囲: 13 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-release-surface-guard.md](docs/management/stories/active/story-vibepro-release-surface-guard.md), [docs/architecture/story-vibepro-release-surface-guard.md](docs/architecture/story-vibepro-release-surface-guard.md), [docs/architecture/vibepro-release-surface-guard.md](docs/architecture/vibepro-release-surface-guard.md), ...and 2 more
- 実装: [src/cli.js](src/cli.js), [src/guard.js](src/guard.js)
- テスト: [test/cli-smoke.test.js](test/cli-smoke.test.js), [test/e2e/story-vibepro-release-surface-guard-main.test.js](test/e2e/story-vibepro-release-surface-guard-main.test.js), [test/guard.test.js](test/guard.test.js)

## 経緯
- 要求: execution gate blockedのまま、エージェントが直接git push / raw PR作成 / デプロイでVibeProを素通りした
- 要求ID: VP-INCIDENT-2026-07-13-SALESTAILOR-BLUEPRINT-ADVISORY-BYPASS
- 発生経緯: VibeProのenforcementは現在 `vibepro pr create` 内部のthrowだけで、直接 `git push` / `gh pr create` / デプロイを実行するエージェントには何の強制力もない（advisory）。2026-07-13のSalesTailor Blueprint インシデントでは、`execution_gate: blocked`・`ready_for_pr_create: false` のまま本番デプロイまで 進んだ。再発防止は「気をつける」ではなく「止まる」仕組みで実装する。 止められる面は2つ: (1) git pre-push hook（protected branchへの直接push）、 (2) エージェントハーネスのPreToolUse hook（Claude Codeが実行するBashコマンドの事前検査）。 どちらも `vibepro guard check` という単一の決定的判定器へ委譲する。判定器は release-surfaceコマンドのパターン分類（決定的コード）と、選択Storyのgate readiness評価を行う。 迂回路は残すが、無音では通れない（bypass理由の記録を強制する）。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-release-surface-guard.md](docs/management/stories/active/story-vibepro-release-surface-guard.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 7 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/guard.js](src/guard.js)
- テスト差分: [test/cli-smoke.test.js](test/cli-smoke.test.js), [test/e2e/story-vibepro-release-surface-guard-main.test.js](test/e2e/story-vibepro-release-surface-guard-main.test.js), [test/guard.test.js](test/guard.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: not_applicable / evidence: [.vibepro/qa/story-vibepro-release-surface-guard/typecheck-5912f32.log](.vibepro/qa/story-vibepro-release-surface-guard/typecheck-5912f32.log)
- 最終E2E: pass: 実CLIで6ブロックのE2E全pass。running git session が expected artifact（marker付きpre-push hook）を実行することを実bare origin相手の実pushで検証（deployment heuristic対応: デプロイではなくhook設置物同一性の検証）。blocked時のraw pr create block、bypass監査記録、PreToolUse stdin exit2、config上書き、status表示（[.vibepro/qa/story-vibepro-release-surface-guard/npm-test-5912f32.json](.vibepro/qa/story-vibepro-release-surface-guard/npm-test-5912f32.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-release-surface-guard/](.vibepro/pr/story-vibepro-release-surface-guard/)
- PR準備: [.vibepro/pr/story-vibepro-release-surface-guard/pr-prepare.json](.vibepro/pr/story-vibepro-release-surface-guard/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-release-surface-guard/decision-index.json](.vibepro/pr/story-vibepro-release-surface-guard/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 5912f32d4010 vibepro/story-vibepro-release-surface-guard-1gi86s clean (story=story-vibepro-release-surface-guard)
