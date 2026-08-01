## 判断
- このPRで判断すること: verify record/runのコマンドが名指しするtest fileパスの実在を検証する を満たすための Runtime / Contract Docs / Tests 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-verify-command-test-path-existence-guard - verify record/runのコマンドが名指しするtest fileパスの実在を検証する
- 正本: [docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md](docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md)
- 変更範囲: 21 files / Runtime / Contract Docs / Tests
- 設計/Story: [docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md](docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md), [docs/specs/story-vibepro-verify-command-test-path-existence-guard.md](docs/specs/story-vibepro-verify-command-test-path-existence-guard.md)
- 実装: [src/verification-evidence.js](src/verification-evidence.js), [src/verification-runner.js](src/verification-runner.js)
- テスト: [test/artifact-routing.test.js](test/artifact-routing.test.js), [test/content-scoped-evidence-freshness.test.js](test/content-scoped-evidence-freshness.test.js), [test/decision-records.test.js](test/decision-records.test.js), ...and 13 more

## 経緯
- 要求: verify record/runのコマンドが名指しするtest fileパスの実在を検証する
- 発生経緯: `vibepro verify run` / `vibepro verify record` は、`node --test test/pr-manager.test.js` のように リポジトリに存在しない test ファイルを名指しした passing unit record を受理してしまった。 `node --test <missing-file>` は "Could not find" を出力しつつ exit 0 で終わるため、 実行されていないカバレッジが gate DAG 上でクレジットされた （story-vibepro-owner-gated-budget-override の closure で人手により発見。2名のgate reviewerとclause adjudicatorが見逃した）。 VibePro は、検証コマンドが repo 相対の test パスを名指しする場合 （node --test / npm test -- <paths> / playwright / vitest / jest の明示ファイル引数）、 各パスを解決し、存在しないパスがあれば record を拒否し、欠損パスを名指しして報告すべきである。


## 原因
- 最新診断gateが needs_review

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md](docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-vibepro-verify-command-test-path-existence-guard
- Task ID: なし
- 対象受入基準: 6件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md](docs/management/stories/active/story-vibepro-verify-command-test-path-existence-guard.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決Gateがあります（対象: Traceability Clause Coverage Gate, Senior Gap Judgment Gate）。詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認し、blocking か waiver 可能かを判断してください。 リリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。
- Scope: 差分範囲の説明または分割判断が必要。理由: baseからのcommitが 9 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- ADRなしで既存設計の範囲に収まっているか
- 主要ソース差分: [src/verification-evidence.js](src/verification-evidence.js), [src/verification-runner.js](src/verification-runner.js)
- ...and 1 more
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/typecheck.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/typecheck.json)
- [x] Unit Gate - vibepro verify run executed the unit command: exit_code=0, tests=46 pass=46 fail=0, duration_ms=39543, status=pass computed from the exit code | agent summary: unit_regression for named-test-path existence guard (INV-001, INV-002; contracts VIBE-RAR-002, VIBE-CORE-EV-001, VIBE-CORE-COST-001); evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/unit.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/unit.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/unit.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/unit.json)
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD 5a0e056a7bd6; evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/ci-evidence/test_22_.json)
- [x] E2E Gate - vibepro verify run executed the e2e command: exit_code=0, tests=1 pass=1 fail=0, duration_ms=5520, status=pass computed from the exit code | agent summary: story acceptance E2E replays the incident through the CLI (S-001, AC-1..AC-6); evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/e2e.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/e2e.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/e2e.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/e2e.json)
- 最終E2E: pass: vibepro verify run executed the e2e command: exit_code=0, tests=1 pass=1 fail=0, duration_ms=5520, status=pass computed from the exit code | agent summary: story acceptance E2E replays the incident through the CLI (S-001, AC-1..AC-6)（[.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/e2e.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/)
- PR準備: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/pr-prepare.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/decision-index.summary.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/decision-index.json](.vibepro/pr/story-vibepro-verify-command-test-path-existence-guard/decision-index.json)）
- Gate: needs_verification
- 実行状態: waiver_required
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 5a0e056a7bd6 claude/agitated-borg-94e2f6 clean (story=story-vibepro-verify-command-test-path-existence-guard)
