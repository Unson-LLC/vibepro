## 判断
- このPRで判断すること: Session exposureをprovenance分類しdigest重複排除する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-session-exposure-provenance-dedup - Session exposureをprovenance分類しdigest重複排除する
- 正本: [docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md](docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md)
- 変更範囲: 6 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md](docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md), [docs/architecture/vibepro-session-exposure-provenance-dedup.md](docs/architecture/vibepro-session-exposure-provenance-dedup.md), [docs/specs/vibepro-session-exposure-provenance-dedup.md](docs/specs/vibepro-session-exposure-provenance-dedup.md)
- 実装: [src/session-efficiency-audit.js](src/session-efficiency-audit.js)
- テスト: [test/session-efficiency-audit.test.js](test/session-efficiency-audit.test.js)

## 経緯
- 要求: Session exposureをprovenance分類しdigest重複排除する
- 発生経緯: session-costはartifactらしい文字列を意味bucketへ分類できるが、freshな読込、生成出力、compaction replay、world state、複数内容を含むtool出力を区別できない。同じ内容の再掲も毎回tokenへ加算され、fake-value監査が実際の新規露出を過大評価する。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md](docs/management/stories/active/story-vibepro-session-exposure-provenance-dedup.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 8 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/session-efficiency-audit.js](src/session-efficiency-audit.js)
- テスト差分: [test/session-efficiency-audit.test.js](test/session-efficiency-audit.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 現HEADの対象テスト22件が全件成功; evidence: [.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/workflow-replay-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/workflow-replay-current.json) / gate: passed / evidence: [.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/workflow-replay-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/workflow-replay-current.json)
- [x] Integration Gate - session-cost統合経路22件成功。artifact抽出からprovenance分類・digest重複排除・互換集計までを現HEADで確認; evidence: [.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/integration-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/integration-current.json) / gate: passed / evidence: [.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/integration-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/integration-current.json)
- [x] E2E Gate - 認証経路変更なしをN/A境界分類し、SEXP-S-1から4を現HEADで確認; evidence: [.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/auth-boundary-na-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/auth-boundary-na-current.json) / gate: passed / evidence: [.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/auth-boundary-na-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/auth-boundary-na-current.json)
- 最終E2E: pass: 認証経路変更なしをN/A境界分類し、SEXP-S-1から4を現HEADで確認（[.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/auth-boundary-na-current.json](.vibepro/verification/story-vibepro-session-exposure-provenance-dedup/auth-boundary-na-current.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-session-exposure-provenance-dedup/](.vibepro/pr/story-vibepro-session-exposure-provenance-dedup/)
- PR準備: [.vibepro/pr/story-vibepro-session-exposure-provenance-dedup/pr-prepare.json](.vibepro/pr/story-vibepro-session-exposure-provenance-dedup/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-session-exposure-provenance-dedup/decision-index.json](.vibepro/pr/story-vibepro-session-exposure-provenance-dedup/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 fb521e3ee9c2 codex/story-vibepro-session-exposure-provenance-dedup clean (story=story-vibepro-session-exposure-provenance-dedup)
