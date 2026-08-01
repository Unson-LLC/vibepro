## 判断
- このPRで判断すること: Taskが同一HEADを要求するworkflowとruntimeを現行split policyが強制分離する矛盾を解消する を満たすための Runtime / Contract Docs / Tests / Repo Control 変更として、このPRを受け入れてよいか。
- Story: story-vibepro-task-atomic-repo-control-contract - Taskが同一HEADを要求するworkflowとruntimeを現行split policyが強制分離する矛盾を解消する
- 正本: [docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md](docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)
- 変更範囲: 12 files / Runtime / Contract Docs / Tests / Repo Control
- 設計/Story: [docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md](docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md), [docs/architecture/story-vibepro-task-atomic-repo-control-contract.md](docs/architecture/story-vibepro-task-atomic-repo-control-contract.md), [docs/specs/story-vibepro-task-atomic-repo-control-contract.md](docs/specs/story-vibepro-task-atomic-repo-control-contract.md)
- 実装: [src/pr-manager.js](src/pr-manager.js), [src/task-bound-repo-control.js](src/task-bound-repo-control.js)
- テスト: [test/e2e/story-vibepro-atomic-scope-review-contract-main.spec.ts](test/e2e/story-vibepro-atomic-scope-review-contract-main.spec.ts), [test/e2e/story-vibepro-task-atomic-repo-control-contract-main.spec.ts](test/e2e/story-vibepro-task-atomic-repo-control-contract-main.spec.ts), [test/pr-artifact-size-budget.test.js](test/pr-artifact-size-budget.test.js), ...and 2 more

## 経緯
- 要求: Taskが同一HEADを要求するworkflowとruntimeを現行split policyが強制分離する矛盾を解消する
- 発生経緯: VibeProは`.github/*`などのrepo-controlを、atomic Story declarationでは上書きできない unsafe surfaceとして扱う。この既定は安全だが、選択Taskがworkflow、runtime policy、 validator、negative testを同じcurrent HEADで成立させると明示し、typed target groupの 依存グラフでそれらを接続している場合も強制分割する。その結果、どちらの分割PRも 単独では契約を満たさない中間状態を作る。


## 原因
- repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする

## 解決
- Story文書を更新: [docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md](docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)

## 受入判定スコープ
- 判定単位: Story
- Story ID: story-vibepro-task-atomic-repo-control-contract
- Task ID: なし
- 対象受入基準: 6件


## Release Notes

### Change Summary
Story文書を更新: [docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md](docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md)

### Compatibility
なし

### User Action
なし

## レビュー観点
- Gate: 未解決の必須Gateはありません。ただしリリース判断Warning: Managed Worktree Gate。 詳細はVibePro証跡の Gate DAG / Gate Enforcement を確認してください。
- Scope: 差分範囲の説明または分割判断が必要。理由: repo制御ファイルやagent設定が差分に含まれている; baseからのcommitが 18 件あるため履歴確認が必要だが、別Story lineageは検出されていない / split=split_by_lane_then_prepare
- Scope lineage evidence: -
- 分割判断: atomic rejected: atomic scope requires a current-head reviewer owner map with every configured role passing / owner repair roles: gate:gate_evidence / uncovered paths: test/e2e/story-vibepro-atomic-scope-review-contract-main.spec.ts, design-ssot.json / commands: vibepro review prepare . --id story-vibepro-task-atomic-repo-control-contract --stage gate --role gate_evidence / follow-up: vibepro review status . --id story-vibepro-task-atomic-repo-control-contract / 自動勧告: split_recommended / split_by_lane_then_prepare / lanes: repo-control, requirements-ssot, runtime-behavior, e2e-gate, misc-follow-up / 採用: split_by_lane_then_prepare
- 管理worktree: needs_review
- Storyの受け入れ基準と実装差分が対応しているか
- 主要ソース差分: [src/pr-manager.js](src/pr-manager.js), [src/task-bound-repo-control.js](src/task-bound-repo-control.js)
- テスト差分: [test/e2e/story-vibepro-atomic-scope-review-contract-main.spec.ts](test/e2e/story-vibepro-atomic-scope-review-contract-main.spec.ts), [test/e2e/story-vibepro-task-atomic-repo-control-contract-main.spec.ts](test/e2e/story-vibepro-task-atomic-repo-control-contract-main.spec.ts), [test/pr-artifact-size-budget.test.js](test/pr-artifact-size-budget.test.js), [test/task-bound-repo-control.test.js](test/task-bound-repo-control.test.js), ...
- Risk: repo制御ファイルが差分に含まれるため、アプリ変更と分けてレビューする
- Risk: 最新診断gateが needs_review

## 確認
- [x] verification:typecheck - [package.json](package.json) の typecheck scriptでTypeScript/型境界を確認する / gate: passed / evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/typecheck.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/typecheck.json)
- [x] Unit Gate - vibepro verify run executed the unit command: exit_code=0, tests=47 pass=47 fail=0, duration_ms=8556, status=pass computed from the exit code | agent summary: unit_regression negative_path VIBE-RAR-001 VIBE-RAR-002 VIBE-CORE-COST-001 VIBE-CORE-EV-001: final-HEAD fail-closed regression; evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/unit.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/unit.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/unit.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/unit.json)
- [x] Integration Gate - vibepro verify run executed the integration command: exit_code=0, tests=10 pass=10 fail=0, duration_ms=17059, status=pass computed from the exit code | agent summary: integration_runtime_path current HEAD TAR lifecycle and evidence-consumer coverage; evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/integration.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/integration.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/integration.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/integration.json)
- [x] E2E Gate - Final-HEAD real CLI flow replay, artifact replay, scenario clause E2E, and complete changed path inventory verified; evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/e2e.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/e2e.json) / gate: passed / evidence: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/e2e.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/e2e.json)
- 最終E2E: pass: Final-HEAD real CLI flow replay, artifact replay, scenario clause E2E, and complete changed path inventory verified（[.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/e2e.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/verification-runs/e2e.json)）

## 詳細
- 証跡: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/)
- PR準備: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/pr-prepare.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/pr-prepare.json)
- 判断索引: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/decision-index.summary.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/decision-index.summary.json)（bounded summary / 全文: [.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/decision-index.json](.vibepro/pr/story-vibepro-task-atomic-repo-control-contract/decision-index.json)）
- Gate: ready_for_review
- 実行状態: ready
- Scope: needs_clean_branch / clean_branch_or_split_pr
- Runtime: vibepro@0.2.0-beta.2 f212b4d3da8d codex/story-vibepro-task-atomic-repo-control-contract clean (story=story-vibepro-task-atomic-repo-control-contract)
