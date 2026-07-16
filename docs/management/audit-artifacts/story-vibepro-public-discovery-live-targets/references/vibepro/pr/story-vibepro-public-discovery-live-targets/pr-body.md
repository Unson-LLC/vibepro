## 判断
- このPRで判断すること: vibepro.pages.devの改訂監査で、Public Discoveryが公開ページを0件しか見ずに項目別passを表示した を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-public-discovery-live-targets - vibepro.pages.devの改訂監査で、Public Discoveryが公開ページを0件しか見ずに項目別passを表示した
- 正本: [docs/management/stories/active/story-vibepro-public-discovery-live-targets.md](docs/management/stories/active/story-vibepro-public-discovery-live-targets.md)
- 変更範囲: 13 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-public-discovery-live-targets.md](docs/management/stories/active/story-vibepro-public-discovery-live-targets.md), [docs/architecture/vibepro-public-discovery-live-targets.md](docs/architecture/vibepro-public-discovery-live-targets.md), [docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json](docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json), ...and 1 more
- 実装: [src/check-packs.js](src/check-packs.js), [src/cli.js](src/cli.js), [src/public-discovery-scanner.js](src/public-discovery-scanner.js)
- テスト: [test/public-discovery-live-targets.test.js](test/public-discovery-live-targets.test.js)

## 経緯
- 要求: vibepro.pages.devの改訂監査で、Public Discoveryが公開ページを0件しか見ずに項目別passを表示した
- 要求ID: VP-GAP-2026-07-15-PUBLIC-DISCOVERY-VACUUM
- 発生経緯: `vibepro check public-discovery` は現在、`scanPublicDiscovery(repoRoot)` がリポジトリ内を走査し、 `app/`・`pages/`・`public/`等のソース規約に合う候補だけを対象にする。静的サイトジェネレータの ビルド成果物が `dist/` に出る構成やCloudflare Pagesの公開URLは入力できず、公開ページ走査0件でも 各リスク群はfinding 0件として `pass` 相当になる。robots.txt欠落等のリポジトリ項目が `needs_review` を発生させても、メタデータ・構造化データ・本文を1ページも検査していない事実が 独立したcoverage状態として残らない。 既存の `story-vibepro-scanner-inconclusive-coverage` は「0対象はpassではない」という共有契約を 導入したが、Public Discoveryは明示的に非目標だった。本Storyではその契約をPublic Discoveryへ 展開し、公開対象を与える入力面も同時に閉じる。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-public-discovery-live-targets.md](docs/management/stories/active/story-vibepro-public-discovery-live-targets.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 7 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/check-packs.js](src/check-packs.js), [src/cli.js](src/cli.js), [src/public-discovery-scanner.js](src/public-discovery-scanner.js)
- テスト差分: [test/public-discovery-live-targets.test.js](test/public-discovery-live-targets.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/qa/public-discovery-live-targets/current-typecheck-status.json](.vibepro/qa/public-discovery-live-targets/current-typecheck-status.json)
- [x] Unit Gate - unit_regression for VIBE-CORE-COST-001 and public discovery CLI compatibility; 16 targeted tests passed on current head; evidence: [.vibepro/qa/public-discovery-live-targets/current-integration-status.json](.vibepro/qa/public-discovery-live-targets/current-integration-status.json) / gate: passed / evidence: [.vibepro/qa/public-discovery-live-targets/current-integration-status.json](.vibepro/qa/public-discovery-live-targets/current-integration-status.json)
- [x] Integration Gate - integration_runtime_path and negative_path passed for CLI to scanner to coverage artifacts on current HEAD; evidence: [.vibepro/qa/public-discovery-live-targets/current-integration-status.json](.vibepro/qa/public-discovery-live-targets/current-integration-status.json) / gate: passed / evidence: [.vibepro/qa/public-discovery-live-targets/current-integration-status.json](.vibepro/qa/public-discovery-live-targets/current-integration-status.json)
- [x] E2E Gate - scenario_clause_e2e and evidence_lifecycle_regression replay cover AC-1 through AC-9, including zero-target non-green artifacts and current-head full-suite CI; evidence: [.vibepro/qa/public-discovery-live-targets/current-full-suite-status.json](.vibepro/qa/public-discovery-live-targets/current-full-suite-status.json) / gate: passed / evidence: [.vibepro/qa/public-discovery-live-targets/current-full-suite-status.json](.vibepro/qa/public-discovery-live-targets/current-full-suite-status.json)
- 最終E2E: pass: scenario_clause_e2e and evidence_lifecycle_regression replay cover AC-1 through AC-9, including zero-target non-green artifacts and current-head full-suite CI（[.vibepro/qa/public-discovery-live-targets/current-full-suite-status.json](.vibepro/qa/public-discovery-live-targets/current-full-suite-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-public-discovery-live-targets/](.vibepro/pr/story-vibepro-public-discovery-live-targets/)
- PR準備: [.vibepro/pr/story-vibepro-public-discovery-live-targets/pr-prepare.json](.vibepro/pr/story-vibepro-public-discovery-live-targets/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-public-discovery-live-targets/decision-index.json](.vibepro/pr/story-vibepro-public-discovery-live-targets/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 8d86674bfc6a codex/story-vibepro-public-discovery-live-targets-v2 clean (story=story-vibepro-public-discovery-live-targets)
