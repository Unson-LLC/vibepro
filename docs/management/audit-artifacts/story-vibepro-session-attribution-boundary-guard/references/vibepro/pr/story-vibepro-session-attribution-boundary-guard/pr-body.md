## 判断
- このPRで判断すること: 2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-session-attribution-boundary-guard - 2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った
- 正本: [docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md](docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)
- 変更範囲: 11 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md](docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md), [docs/architecture/vibepro-session-attribution-boundary-guard.md](docs/architecture/vibepro-session-attribution-boundary-guard.md), [docs/specs/story-vibepro-session-attribution-boundary-guard.md](docs/specs/story-vibepro-session-attribution-boundary-guard.md), ...and 1 more
- 実装: [src/merge-manager.js](src/merge-manager.js), [src/pr-manager.js](src/pr-manager.js), [src/session-efficiency-audit.js](src/session-efficiency-audit.js)
- テスト: [test/session-efficiency-audit.test.js](test/session-efficiency-audit.test.js), [test/session-efficiency-run-lineage.test.js](test/session-efficiency-run-lineage.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)

## 経緯
- 要求: 2026-07-09 の価値監査で親 session 019f3f8c が複数の関連 story を混載し、strict と worktree-bound の attribution 乖離（例: docs-feature-map strict 1h24m vs bound 11h24m 相当）が前回監査から横ばいのまま残った
- 発生経緯: 価値監査が 2 回連続で同じ構造問題を指摘している: 複数 story を混載した親 session（例: `019f3f8c-9228-7bc2-b5f3-2b3a5745de98` は `docs-feature-map` と `style-preset-token-gate` を混載）では、strict story attribution と worktree-bound attribution の乖離が大きく、親 session 全体を単一 story の工数として読むと過大評価になる。設定baseにはStory cueの初期検出と非blockingな`session_boundary` advisoryは既に存在したが、strict/associated/other/unclassifiedの排他的分類、乖離率、mixed-parent readinessを同じsession-cost契約で返すsurfaceは未完成だった。外部スクリプト（`session-time-efficiency.mjs`）に依存した測定と「session を story ごとに分ける」という運用ルールだけでは横ばいのままである。 最大のロスは token ではなく attribution 汚染である。VibePro 側に決定的な検知を置く: (1) `vibepro audit session-cost` が session event を story worktree /...


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md](docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md](docs/management/stories/active/story-vibepro-session-attribution-boundary-guard.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 9 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/merge-manager.js](src/merge-manager.js), [src/pr-manager.js](src/pr-manager.js), [src/session-efficiency-audit.js](src/session-efficiency-audit.js)
- テスト差分: [test/session-efficiency-audit.test.js](test/session-efficiency-audit.test.js), [test/session-efficiency-run-lineage.test.js](test/session-efficiency-run-lineage.test.js), [test/vibepro-cli.test.js](test/vibepro-cli.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/expensive-verification-b6c66dac.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/expensive-verification-b6c66dac.json)
- [x] Unit Gate - pass; evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json)
- [x] Integration Gate - Imported CI evidence for CodeQL (SUCCESS) at HEAD afd5a8ac3749; evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/ci-evidence/CodeQL.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/ci-evidence/CodeQL.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/ci-evidence/CodeQL.json)
- [x] E2E Gate - pass; evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json)
- 最終E2E: pass: pass（[.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/targeted-validation-afd5.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/)
- PR準備: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/pr-prepare.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-session-attribution-boundary-guard/decision-index.json](.vibepro/pr/story-vibepro-session-attribution-boundary-guard/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.1 afd5a8ac3749 codex/story-vibepro-session-attribution-boundary-guard-clean dirty (story=story-vibepro-session-attribution-boundary-guard)
