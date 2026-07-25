## 判断
- このPRで判断すること: モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-import-based-conformance - モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える
- 正本: [docs/management/stories/active/story-vibepro-import-based-conformance.md](docs/management/stories/active/story-vibepro-import-based-conformance.md)
- 変更範囲: 6 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-import-based-conformance.md](docs/management/stories/active/story-vibepro-import-based-conformance.md), [docs/architecture/story-vibepro-import-based-conformance.md](docs/architecture/story-vibepro-import-based-conformance.md), [docs/specs/story-vibepro-import-based-conformance.md](docs/specs/story-vibepro-import-based-conformance.md)
- 実装: [src/architecture-conformance.js](src/architecture-conformance.js)
- テスト: [test/architecture-conformance.test.js](test/architecture-conformance.test.js)

## 経緯
- 要求: モジュール間依存の測定をGraphify callsから実import文スキャンへ切り替える
- 発生経緯: VibePro開発者が `vibepro architecture conformance` を実行したとき、undeclared_dependency違反が実際のソースコード上のimport/export/require文で裏付けられる。Graphifyの"calls"抽出ノイズ(識別子参照の逆向き帰属)によって実在しない依存が violation として報告されなくなり、減算(削除・統合)Storyの提案が信頼できる台帳の上で行えるようになる。 `src/architecture-conformance.js` の変更と `test/architecture-conformance.test.js` を revert すれば旧(Graphify calls依存)の挙動に戻る。target-model.json 自体は変更しないため、モデル裁定状態への影響はない。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-import-based-conformance.md](docs/management/stories/active/story-vibepro-import-based-conformance.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-import-based-conformance.md](docs/management/stories/active/story-vibepro-import-based-conformance.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/architecture-conformance.js](src/architecture-conformance.js)
- テスト差分: [test/architecture-conformance.test.js](test/architecture-conformance.test.js)
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - 変更に対応する対象テスト / gate: passed / evidence: [.vibepro/evidence/story-vibepro-import-based-conformance/unit-test-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/unit-test-status.json)
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/evidence/story-vibepro-import-based-conformance/typecheck-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/typecheck-status.json)
- [x] Integration Gate - CLI-boundary tests re-confirmed on final HEAD 3337d470; CI (test (20) and test (22), both SUCCESS at this exact HEAD, https://github.com/Unson-LLC/vibepro/actions/runs/30135732518) independently reran the full repo test suite including this Story's tests and passed.; evidence: [.vibepro/evidence/story-vibepro-import-based-conformance/integration-test-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/integration-test-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-import-based-conformance/integration-test-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/integration-test-status.json)
- [x] E2E Gate - e2e CLI-boundary tests re-confirmed on final HEAD 3337d470.; evidence: [.vibepro/evidence/story-vibepro-import-based-conformance/e2e-test-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/e2e-test-status.json) / gate: passed / evidence: [.vibepro/evidence/story-vibepro-import-based-conformance/e2e-test-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/e2e-test-status.json)
- 最終E2E: pass: e2e CLI-boundary tests re-confirmed on final HEAD 3337d470.（[.vibepro/evidence/story-vibepro-import-based-conformance/e2e-test-status.json](.vibepro/evidence/story-vibepro-import-based-conformance/e2e-test-status.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-import-based-conformance/](.vibepro/pr/story-vibepro-import-based-conformance/)
- PR準備: [.vibepro/pr/story-vibepro-import-based-conformance/pr-prepare.json](.vibepro/pr/story-vibepro-import-based-conformance/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-import-based-conformance/decision-index.summary.json](.vibepro/pr/story-vibepro-import-based-conformance/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-import-based-conformance/decision-index.json](.vibepro/pr/story-vibepro-import-based-conformance/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.2.0-beta.1 3337d4708f57 claude/story-vibepro-import-based-conformance clean (story=story-vibepro-import-based-conformance)
