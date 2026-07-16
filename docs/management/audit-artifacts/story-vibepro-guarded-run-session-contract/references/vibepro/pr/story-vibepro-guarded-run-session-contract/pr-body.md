## 判断
- このPRで判断すること: StoryからPR-readyまでを一つの自律セッションとして追跡・再開したい を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-guarded-run-session-contract - StoryからPR-readyまでを一つの自律セッションとして追跡・再開したい
- 正本: [docs/management/stories/active/story-vibepro-guarded-run-session-contract.md](docs/management/stories/active/story-vibepro-guarded-run-session-contract.md)
- 変更範囲: 10 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-guarded-run-session-contract.md](docs/management/stories/active/story-vibepro-guarded-run-session-contract.md), [docs/architecture/story-vibepro-guarded-run-session-contract.md](docs/architecture/story-vibepro-guarded-run-session-contract.md)
- 実装: [src/cli.js](src/cli.js), [src/git-identity.js](src/git-identity.js), [src/guarded-run-session.js](src/guarded-run-session.js)
- テスト: [test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts](test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts), [test/e2e/story-vibepro-guarded-run-session-contract-main.test.js](test/e2e/story-vibepro-guarded-run-session-contract-main.test.js), [test/guarded-run-session.test.js](test/guarded-run-session.test.js)

## 経緯
- 要求: StoryからPR-readyまでを一つの自律セッションとして追跡・再開したい
- 発生経緯: **As a** VibeProでStoryを実装可能な状態からPR-readyまで進めたい利用者 **I want** 1回の`execute run`を終了・再起動後も追跡し、停止理由を理解して再開できること **So that** 会話文脈や次コマンドの暗記に依存せず、安全な自律実行の状態を復元できる ロードマップの1番目。既存Execution stateとManaged Worktreeを利用し、後続Storyが共有するRun契約を先に固定する。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-guarded-run-session-contract.md](docs/management/stories/active/story-vibepro-guarded-run-session-contract.md)

## レビュー観点
- Gate: 未解決の必須Gateはありません。レビューでは差分の妥当性とスコープを確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 22 件あり、Story外の変更混入を確認する必要がある / split=split_by_lane_then_prepare
- 管理worktree: passed
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/cli.js](src/cli.js), [src/git-identity.js](src/git-identity.js), [src/guarded-run-session.js](src/guarded-run-session.js)
- テスト差分: [test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts](test/e2e/story-vibepro-guarded-run-session-contract-acceptance.spec.ts), [test/e2e/story-vibepro-guarded-run-session-contract-main.test.js](test/e2e/story-vibepro-guarded-run-session-contract-main.test.js), [test/guarded-run-session.test.js](test/guarded-run-session.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - Current-head Guarded Run 45/45 plus inherited runtime-cost unit regression 22/22 bound to VIBE-CORE-COST-001; evidence: [.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/unit-and-runtime-cost-current-head.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/unit-and-runtime-cost-current-head.json) / gate: passed / evidence: [.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/unit-and-runtime-cost-current-head.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/unit-and-runtime-cost-current-head.json)
- [x] Integration Gate - Current-head inherited responsibility regressions: PR lifecycle 4/4, runtime cost 22/22, managed worktree 12/12; CI test matrices also passed; evidence: [.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/responsibility-current-head.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/responsibility-current-head.json) / gate: passed / evidence: [.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/responsibility-current-head.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/responsibility-current-head.json)
- [x] E2E Gate - Current-head fresh-process repository/source-fallback flow replay and artifact replay: 3/3 outer, nested acceptance 47/47; evidence: [.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/e2e-current-head-verified.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/e2e-current-head-verified.json) / gate: passed / evidence: [.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/e2e-current-head-verified.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/e2e-current-head-verified.json)
- 最終E2E: pass: Current-head fresh-process repository/source-fallback flow replay and artifact replay: 3/3 outer, nested acceptance 47/47（[.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/e2e-current-head-verified.json](.vibepro/verification-logs/story-vibepro-guarded-run-session-contract/e2e-current-head-verified.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-guarded-run-session-contract/](.vibepro/pr/story-vibepro-guarded-run-session-contract/)
- PR準備: [.vibepro/pr/story-vibepro-guarded-run-session-contract/pr-prepare.json](.vibepro/pr/story-vibepro-guarded-run-session-contract/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-guarded-run-session-contract/decision-index.json](.vibepro/pr/story-vibepro-guarded-run-session-contract/decision-index.json)
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.1.0-beta.0 e0a38eb3c62a codex/story-vibepro-guarded-run-session-contract clean (story=story-vibepro-guarded-run-session-contract)
