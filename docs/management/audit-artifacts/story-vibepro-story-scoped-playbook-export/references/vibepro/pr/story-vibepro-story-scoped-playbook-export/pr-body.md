## 判断
- このPRで判断すること: Story単位のStory Engineering Playbook形式ドキュメント出力 を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-story-scoped-playbook-export - Story単位のStory Engineering Playbook形式ドキュメント出力
- 正本: [docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md](docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md)
- 変更範囲: 8 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md](docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md), [docs/architecture/vibepro-story-scoped-playbook-export.md](docs/architecture/vibepro-story-scoped-playbook-export.md)
- 実装: [src/cli.js](src/cli.js), [src/playbook-exporter.js](src/playbook-exporter.js), [src/workspace.js](src/workspace.js)
- テスト: [test/cli-smoke.test.js](test/cli-smoke.test.js), [test/playbook-exporter.test.js](test/playbook-exporter.test.js)

## 経緯
- 要求: Story単位のStory Engineering Playbook形式ドキュメント出力
- 発生経緯: VibeProのStoryは、Story、Spec、Architecture、PR Gate DAGを分けて扱える一方で、実装前に「今回のStoryでどの開発ブリーフ項目を埋めるべきか」を人間が毎回翻訳する必要がある。 全体設計図を常に更新する運用に寄せると重くなる。逆に固定テンプレを全Storyへ一律適用すると、Engineering Judgment DAGで判断している意味が薄くなる。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md](docs/management/stories/active/story-vibepro-story-scoped-playbook-export.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/playbook-exporter.js](src/playbook-exporter.js), [src/workspace.js](src/workspace.js)
- テスト差分: [test/cli-smoke.test.js](test/cli-smoke.test.js), [test/playbook-exporter.test.js](test/playbook-exporter.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Imported CI evidence for test (20) (SUCCESS) at HEAD 3efc23a965de; evidence: [.vibepro/pr/story-vibepro-story-scoped-playbook-export/ci-evidence/test_20_.json](.vibepro/pr/story-vibepro-story-scoped-playbook-export/ci-evidence/test_20_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-story-scoped-playbook-export/ci-evidence/test_20_.json](.vibepro/pr/story-vibepro-story-scoped-playbook-export/ci-evidence/test_20_.json)
- [x] Integration Gate - Story playbook workflow replay passed at HEAD 3efc23a965dea9159e7380531fbe29da27396380 with verified durable artifact; flow replay, artifact replay, scenario clause e2e, AC-3 selected/omitted template reasons, AC-4 Japanese output, review surface, PR body, gate report artifact and responsibility authority regression evidence are current-head bound for VIBE-RAR-001, VIBE-RAR-002, VIBE-CORE-PR-001, VIBE-CORE-AR-001, VIBE-CORE-EV-001, VIBE-CORE-COST-001, VIBE-CORE-STORY-001, VIBE-CORE-JUDGE-001, VIBE-CORE-WT-001.; evidence: [.vibepro/manual-verification/story-vibepro-story-scoped-playbook-export/workflow-replay.json](.vibepro/manual-verification/story-vibepro-story-scoped-playbook-export/workflow-replay.json) / gate: passed / evidence: [.vibepro/manual-verification/story-vibepro-story-scoped-playbook-export/workflow-replay.json](.vibepro/manual-verification/story-vibepro-story-scoped-playbook-export/workflow-replay.json)
- [x] E2E Gate - Design SSOT reconciliation passed for the story-scoped playbook design root and required Story child at HEAD 3efc23a965dea9159e7380531fbe29da27396380.; evidence: [.vibepro/design-ssot/vibepro-story-scoped-playbook-export/reconciliation.json](.vibepro/design-ssot/vibepro-story-scoped-playbook-export/reconciliation.json) / gate: passed / evidence: [.vibepro/design-ssot/vibepro-story-scoped-playbook-export/reconciliation.json](.vibepro/design-ssot/vibepro-story-scoped-playbook-export/reconciliation.json)
- 最終E2E: pass: Story playbook workflow replay passed at HEAD 3efc23a965dea9159e7380531fbe29da27396380 with verified durable artifact; flow replay, artifact replay, scenario clause e2e, AC-3 selected/omitted template reasons, AC-4 Japanese output, review surface, PR body, gate report artifact and responsibility authority regression evidence are current-head bound for VIBE-RAR-001, VIBE-RAR-002, VIBE-CORE-PR-001, VIBE-CORE-AR-001, VIBE-CORE-EV-001, VIBE-CORE-COST-001, VIBE-CORE-STORY-001, VIBE-CORE-JUDGE-001, VIBE-CORE-WT-001.（[.vibepro/manual-verification/story-vibepro-story-scoped-playbook-export/workflow-replay.json](.vibepro/manual-verification/story-vibepro-story-scoped-playbook-export/workflow-replay.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-story-scoped-playbook-export/](.vibepro/pr/story-vibepro-story-scoped-playbook-export/)
- PR準備: [.vibepro/pr/story-vibepro-story-scoped-playbook-export/pr-prepare.json](.vibepro/pr/story-vibepro-story-scoped-playbook-export/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-story-scoped-playbook-export/decision-index.json](.vibepro/pr/story-vibepro-story-scoped-playbook-export/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.1.0-beta.0 3efc23a965de codex/story-engineering-playbook-export clean (story=story-vibepro-story-scoped-playbook-export)
