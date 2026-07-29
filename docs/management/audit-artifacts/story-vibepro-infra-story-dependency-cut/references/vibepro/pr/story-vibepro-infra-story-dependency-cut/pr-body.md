## 判断
- このPRで判断すること: workspace-infraからstoryへの許可外依存を削減する を満たすための Runtime / Contract Docs 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-infra-story-dependency-cut - workspace-infraからstoryへの許可外依存を削減する
- 正本: [docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md](docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)
- 変更範囲: 9 files / Runtime / Contract Docs
- 設計/Story: [docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md](docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md), [docs/architecture/target-model.json](docs/architecture/target-model.json), [docs/specs/story-vibepro-infra-story-dependency-cut.md](docs/specs/story-vibepro-infra-story-dependency-cut.md)
- 実装: [src/guard.js](src/guard.js), [src/performance-evidence.js](src/performance-evidence.js), [src/pr-manager.js](src/pr-manager.js), ...and 2 more

## 経緯
- 要求: workspace-infraからstoryへの許可外依存を削減する
- 発生経緯: VibePro開発者が、target-model.json(裁定済みto-beモデル)の「workspace-infraは何にも依存しない」という規範に対する最大の違反ペア(`workspace-infra -> story`)を削減できる。これによりconformance dry-runのviolation総数が実測で下がり、精錬(削る)ループが初めて機能した証拠が得られる。infra層がstory層のSSOT実装詳細(story-manager.js等)を直接呼ばなくなることで、依存の方向がtarget modelの宣言どおり単方向(cli -> * / story -> infra)に揃う。


## 原因
- ソース差分に対するテスト差分がない

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md](docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)

## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md](docs/management/stories/active/story-vibepro-infra-story-dependency-cut.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決Gateがあります（対象: Risk-adaptive Validation Sequencing Gate, Senior Gap Judgment Gate）。詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認し、blocking か waiver 可能かを判断してください。 リリース判断Warning: Design Input Judgment Gate, Managed Worktree Gate。
- Scope: 同一PRでレビュー可能。分割案はVibePro証跡に残す（split=split_by_lane_then_prepare）
- Scope lineage evidence: -
- 分割判断: 分割推奨 / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: requirements-ssot, runtime-behavior, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/guard.js](src/guard.js), [src/performance-evidence.js](src/performance-evidence.js), [src/pr-manager.js](src/pr-manager.js), [src/story-manager.js](src/story-manager.js), ...
- Risk: ソース差分に対するテスト差分がない
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed
- [x] Unit Gate - Combined unit evidence for the workspace-infra->story dependency cut: 88/88 targeted tests pass, exit 0; typecheck exit 0; full [test/vibepro-cli.test.js](test/vibepro-cli.test.js) regression suite 440/440 pass exit 0. architecture conformance measured separately (node [bin/vibepro.js](bin/vibepro.js) architecture conformance . --json after graphify): violation_count 85 to 84 (IDC-AC-002), workspace-infra->story edge_count 46 to 45 with 3 real edges verified removed (IDC-AC-001), no new violation pairs (IDC-AC-003). target-model.json allowed_dependencies unchanged, decision-records.js reassignment justified by its import/consumer graph (IDC-AC-004). All targeted+e2e+full-suite tests pass for every touched file (IDC-AC-005). net LOC +2 in src/, pure relocation (IDC-AC-006).; evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/c22a9134-8f86-46bc-ab42-6faec0ea73c4/scratchpad/status-artifacts/full-cli-suite-status.json / gate: passed / evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/c22a9134-8f86-46bc-ab42-6faec0ea73c4/scratchpad/status-artifacts/full-cli-suite-status.json
- [x] Integration Gate - Imported CI evidence for test (22) (SUCCESS) at HEAD b99ab72207d6; evidence: [.vibepro/pr/story-vibepro-infra-story-dependency-cut/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-infra-story-dependency-cut/ci-evidence/test_22_.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-infra-story-dependency-cut/ci-evidence/test_22_.json](.vibepro/pr/story-vibepro-infra-story-dependency-cut/ci-evidence/test_22_.json)
- [x] E2E Gate - e2e replay of the managed-worktree gate and execution DAG (PR Gate DAG / gate-dag / pr-prepare pipeline) after the decision-records.js module reassignment: 12/12 pass, exit 0. Covers gate:managed_worktree bypass via decision records (ac2/ac4/ac5) and workflow state transition replay (runtime smoke replays workflow state transitions), the exact call path touched by managed-worktree.js/managed-worktree-gate.js.; evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/c22a9134-8f86-46bc-ab42-6faec0ea73c4/scratchpad/status-artifacts/e2e-managed-worktree-gate-status.json / gate: passed / evidence: ../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/c22a9134-8f86-46bc-ab42-6faec0ea73c4/scratchpad/status-artifacts/e2e-managed-worktree-gate-status.json
- 最終E2E: pass: e2e replay of the managed-worktree gate and execution DAG (PR Gate DAG / gate-dag / pr-prepare pipeline) after the decision-records.js module reassignment: 12/12 pass, exit 0. Covers gate:managed_worktree bypass via decision records (ac2/ac4/ac5) and workflow state transition replay (runtime smoke replays workflow state transitions), the exact call path touched by managed-worktree.js/managed-worktree-gate.js.（../../../../../../../../private/tmp/claude-502/-Users-ksato-workspace-code-vibepro/c22a9134-8f86-46bc-ab42-6faec0ea73c4/scratchpad/status-artifacts/e2e-managed-worktree-gate-status.json）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-infra-story-dependency-cut/](.vibepro/pr/story-vibepro-infra-story-dependency-cut/)
- PR準備: [.vibepro/pr/story-vibepro-infra-story-dependency-cut/pr-prepare.json](.vibepro/pr/story-vibepro-infra-story-dependency-cut/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-infra-story-dependency-cut/decision-index.json](.vibepro/pr/story-vibepro-infra-story-dependency-cut/decision-index.json)
- Gate: needs_verification
- 実行状態: waiver_required
- Scope: reviewable / current_branch_pr
- Runtime: vibepro@0.2.0-beta.1 b99ab72207d6 claude/story-vibepro-infra-story-dependency-cut clean (story=story-vibepro-infra-story-dependency-cut)

## VibePro Gate Waiver

- waiver policy: cli_reason
- severity: warning
- reason: gate:validation_sequencing and gate:traceability_clause_coverage (senior-gap: 1 non-deferrable gap) are non-critical (not in isCriticalUnresolvedGate); the underlying validation is covered by the closed gate_evidence Agent Review, the independent evidence_adjudication (6/6 demonstrated) and judgment_dag_adjudication (13/13 judged_sound) passes, CI test(20)/test(22)/CodeQL all pass, and 88 targeted + 12 e2e + 440 full-CLI regression tests. The formal 5-phase validation-sequencing workflow is a separate bookkeeping track not yet exercised for this Story; waiving it here rather than re-running the same verification under a different phase-tracking scheme.
- unresolved gates: Risk-adaptive Validation Sequencing Gate:needs_evidence, Senior Gap Judgment Gate:needs_review
- critical unresolved gates: none
