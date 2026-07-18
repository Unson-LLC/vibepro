## 判断
- このPRで判断すること: コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている を満たすための Runtime / Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-content-scoped-evidence-freshness - コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている
- 正本: [docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md](docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)
- 変更範囲: 27 files / Runtime / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md](docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md), [docs/architecture/vibepro-content-scoped-evidence-freshness.md](docs/architecture/vibepro-content-scoped-evidence-freshness.md), [docs/specs/story-vibepro-content-scoped-evidence-freshness.md](docs/specs/story-vibepro-content-scoped-evidence-freshness.md)
- 実装: scripts/generate-cli-reference.mjs, [src/agent-review.js](src/agent-review.js), [src/cli.js](src/cli.js), ...and 2 more
- テスト: [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js](test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js), [test/e2e/story-vibepro-fake-value-hardening-main.spec.js](test/e2e/story-vibepro-fake-value-hardening-main.spec.js), ...and 4 more

## 経緯
- 要求: コミットすると証跡・レビューが全部 stale になるため、ツリー最終化後に儀式をまとめて行う運用を強いられている
- 発生経緯: 検証証跡とレビュー証跡は現在 git HEAD SHA に束縛されており、docs のみのコミットでもコード証跡が一括で stale になる。この結果「実装しながら証跡を貯める」のではなく「ツリーを最終化してから証跡→レビューを一気に取る」という逆順の運用が事実上強制され、Commit Small の原則とも衝突している。story-vibepro-scoped-evidence-invalidation が始めた changed-surface スコープ判定を鮮度モデルのデフォルトまで押し切り、証跡の束縛先を「その証跡が依拠するファイル群のコンテンツハッシュ」に変える。


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md](docs/management/stories/active/story-vibepro-content-scoped-evidence-freshness.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている; baseからのcommitが 19 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: scripts/generate-cli-reference.mjs, [src/agent-review.js](src/agent-review.js), [src/cli.js](src/cli.js), [src/content-binding.js](src/content-binding.js), ...
- テスト差分: [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js](test/e2e/story-vibepro-content-scoped-evidence-freshness-main.test.js), [test/e2e/story-vibepro-fake-value-hardening-main.spec.js](test/e2e/story-vibepro-fake-value-hardening-main.spec.js), [test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts](test/e2e/story-vibepro-review-dispatch-preflight-dag-main.spec.ts), ...
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Focused lifecycle, authority, telemetry, and status regressions passed on HEAD 709dbf0; full Node 20/22 CI also passed; evidence: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/verification-evidence.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/verification-evidence.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/verification-evidence.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/verification-evidence.json)
- [x] Integration Gate - Current HEAD 709dbf0 Node 20/22 CI, analyze, and CodeQL passed; acceptance and negative lifecycle paths are covered; evidence: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/ci-evidence/test_20_.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/ci-evidence/test_20_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/ci-evidence/test_20_.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/ci-evidence/test_20_.json)
- [x] E2E Gate - Story acceptance replay executed AC-1 through AC-9 with executable assertions; evidence: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/e2e-current.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/e2e-current.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/e2e-current.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/e2e-current.json)
- 最終E2E: pass: Story acceptance replay executed AC-1 through AC-9 with executable assertions（[.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/e2e-current.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/e2e-current.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/)
- PR準備: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/pr-prepare.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/decision-index.json](.vibepro/pr/story-vibepro-content-scoped-evidence-freshness/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.0 709dbf083f2c codex/review-surface-policy clean (story=story-vibepro-content-scoped-evidence-freshness)
