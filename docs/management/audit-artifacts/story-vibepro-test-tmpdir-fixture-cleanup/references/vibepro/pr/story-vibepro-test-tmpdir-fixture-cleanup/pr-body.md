## 判断
- このPRで判断すること: テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構 を満たすための Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-test-tmpdir-fixture-cleanup - テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構
- 正本: [docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md](docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)
- 変更範囲: 151 files / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md](docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md), [docs/specs/story-vibepro-test-tmpdir-fixture-cleanup.md](docs/specs/story-vibepro-test-tmpdir-fixture-cleanup.md)
- テスト: [test/adjudication.test.js](test/adjudication.test.js), [test/agent-completion-inbox.test.js](test/agent-completion-inbox.test.js), [test/agent-review-independence.test.js](test/agent-review-independence.test.js), ...and 140 more

## 経緯
- 要求: テストスイートが$TMPDIRに残すmkdtemp fixtureのクリーンアップ機構
- 発生経緯: VibeProのテストスイートはmacOSの`$TMPDIR`(`/var/folders/.../T`)に `mkdtemp`でfixtureディレクトリ(`vibepro-*`, `story-vibepro-*`等のprefix)を作るが、 削除せず残す。2026-08-02時点で88,778個が蓄積し、rootボリューム残2.2Giまで 枯渇してENOSPCでテストが43/92 failした。 - `test/` 配下123ファイル + `src/` 4ファイルがmkdtempを使用し、prefixは約400種。 - `test/vibepro-cli.test.js` の `makeRepo` / `makeGitRepoWithStory` 等のヘルパーが 最大の発生源だが、src側(`pr-manager.js`のgate-check-snapshot、 `execution-state.js`のlinked-artifacts等)がテストプロセス内で作る分も漏れる。


## 原因
- VibeProのテストスイートはmacOSの`$TMPDIR`(`/var/folders/.../T`)に `mkdtemp`でfixtureディレクトリ(`vibepro-*`, `story-vibepro-*`等のprefix)を作るが、 削除せず残す。2026-08-02時点で88,778個が蓄積し、rootボリューム残2.2Giまで 枯渇してENOSPCでテストが43/92 failした。 - `test/` 配下123ファイル + `src/` 4ファイルがmkdtempを使用し、prefixは約400種。 - `test/vibepro-cli.test.js` の `makeRepo` / `makeGitRepoWithStory` 等のヘルパーが 最大の発生源だが、src側(`pr-manager.js`のgate-check-snapshot、 `execution-state.js`のlinked-artifacts等)がテストプロセス内で作る分も漏れる。

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md](docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-vibepro-test-tmpdir-fixture-cleanup
- Task ID: なし
- 対象受入基準: 5件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md](docs/management/stories/active/story-vibepro-test-tmpdir-fixture-cleanup.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: 差分が 151 files あり、レビュー可能な目安 30 files を超えている; baseからのcommitが 25 件あり、別work item story-local のlineageが含まれている / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- テスト差分: [test/adjudication.test.js](test/adjudication.test.js), [test/agent-completion-inbox.test.js](test/agent-completion-inbox.test.js), [test/agent-review-independence.test.js](test/agent-review-independence.test.js), [test/architecture-conformance.test.js](test/architecture-conformance.test.js), ...
- Risk: 最新診断gateが needs_review

## 確認
- [x] Unit Gate - vibepro verify run executed the unit command: exit_code=0, tests=2391 pass=2391 fail=0, duration_ms=2814689, status=pass computed from the exit code | agent summary: full unit regression suite under scratch TMPDIR isolation with the widened conformance guard: every test file passes and leaves no fixture dirs in the real TMPDIR (ac:5); evidence: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/unit.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/unit.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/unit.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/unit.json)
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD f56a1f7556f2; evidence: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/ci-evidence/test_22_.json)
- [x] E2E Gate - vibepro verify run executed the e2e command: exit_code=0, tests=5 pass=5 fail=0, duration_ms=1619, status=pass computed from the exit code | agent summary: story e2e: scratch TMPDIR isolation behavioral suite covering ac:1-ac:5 (AC-1..AC-5) and spec scenario clauses S-001/S-002 at the final head; evidence: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/e2e.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/e2e.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/e2e.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/e2e.json)
- 最終E2E: pass: vibepro verify run executed the e2e command: exit_code=0, tests=5 pass=5 fail=0, duration_ms=1619, status=pass computed from the exit code | agent summary: story e2e: scratch TMPDIR isolation behavioral suite covering ac:1-ac:5 (AC-1..AC-5) and spec scenario clauses S-001/S-002 at the final head（[.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/e2e.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/)
- PR準備: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/pr-prepare.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/decision-index.summary.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/decision-index.json](.vibepro/pr/story-vibepro-test-tmpdir-fixture-cleanup/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 f56a1f7556f2 claude/adoring-keller-f403ec clean (story=story-vibepro-test-tmpdir-fixture-cleanup)
