# Target Model Rebaseline Proposal

- model: docs/architecture/target-model.json (version=1, status=adjudicated, governance=present)
- 孤児: 22 (候補あり 16 / 候補なし 6)
- 孤児クラスタ: 14
- 未宣言依存: 41 (declare候補 22 / resolve 19)

> 候補モジュールのスコアは (被import元モジュールのedge数 × consumer_edge_weight) + (import先モジュールのedge数 × dependency_edge_weight)。同点はモジュール名の辞書順。allowed_dependencies が "*" のdispatcherモジュールは所有シグナルにならないため候補から除外する。

> このartifactは提案のみ。target-model.json は書き換えない。新モジュール新設と新規依存宣言は人間裁定 (governance.human_adjudicated)。

## 孤児ファイルの割当候補

### src/agent-completion-inbox.js

- 推奨: human_adjudication — モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない
- 孤児同士の隣接: src/codex-runtime-bridge.js, src/codex-subagent-runtime-adapter.js
- 候補なし

### src/atomic-file.js

- 推奨: human_adjudication — モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない
- 孤児同士の隣接: src/decision-outcome-ledger.js, src/outcome-manager.js
- 候補なし

### src/budget-override-authority.js

- 推奨: human_adjudication — 最高スコアが複数モジュールで同点 (reporting, workspace-infra)
- 候補 `reporting` score=2 (consumer=1, dependency=0)
  - 根拠: src/delivery-efficiency-guardrail.js -> src/budget-override-authority.js
  - 誘発依存: workspace-infra -> reporting (1 edges, allowed=false, 新規違反=false)
- 候補 `workspace-infra` score=2 (consumer=1, dependency=0)
  - 根拠: src/decision-records.js -> src/budget-override-authority.js
  - 誘発依存: reporting -> workspace-infra (1 edges, allowed=true, 新規違反=false)

### src/canonical-persistence.js

- 推奨: machine_maintainable_assign (workspace-infra) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 孤児同士の隣接: src/outcome-manager.js
- 候補 `workspace-infra` score=4 (consumer=1, dependency=2)
  - 根拠: src/canonical-persistence.js -> src/managed-command-executor.js
  - 根拠: src/canonical-persistence.js -> src/story-id.js
  - 根拠: src/merge-manager.js -> src/canonical-persistence.js

### src/codex-runtime-bridge.js

- 推奨: machine_maintainable_assign (run-session) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 孤児同士の隣接: src/agent-completion-inbox.js, src/codex-subagent-runtime-adapter.js
- 候補 `run-session` score=3 (consumer=0, dependency=3)
  - 根拠: src/codex-runtime-bridge.js -> src/agent-runtime-adapter.js
  - 根拠: src/codex-runtime-bridge.js -> src/agent-runtime-connectors.js
  - 根拠: src/codex-runtime-bridge.js -> src/guarded-run-session.js
  - 誘発依存: cli -> run-session (1 edges, allowed=true, 新規違反=false)

### src/codex-runtime-output-contract.js

- 推奨: human_adjudication — モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない
- 孤児同士の隣接: src/codex-subagent-host-worker.js
- 候補なし

### src/codex-subagent-host-worker.js

- 推奨: human_adjudication — モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない
- 孤児同士の隣接: src/codex-runtime-output-contract.js
- 候補なし

### src/codex-subagent-host.js

- 推奨: human_adjudication — モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない
- 候補なし

### src/codex-subagent-runtime-adapter.js

- 推奨: human_adjudication — モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない
- 孤児同士の隣接: src/agent-completion-inbox.js, src/codex-runtime-bridge.js, src/progress-deadline.js
- 候補なし

### src/decision-outcome-ledger.js

- 推奨: machine_maintainable_assign (gate-pr) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 孤児同士の隣接: src/atomic-file.js, src/outcome-manager.js
- 候補 `gate-pr` score=6 (consumer=3, dependency=0)
  - 根拠: src/canonical-audit.js -> src/decision-outcome-ledger.js
  - 根拠: src/pr-artifact-budget.js -> src/decision-outcome-ledger.js
  - 根拠: src/pr-manager.js -> src/decision-outcome-ledger.js
  - 誘発依存: gate-pr -> workspace-infra (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: reporting -> gate-pr (1 edges, allowed=true, 新規違反=false)
- 候補 `reporting` score=2 (consumer=1, dependency=0)
  - 根拠: src/usage-report.js -> src/decision-outcome-ledger.js
  - 誘発依存: gate-pr -> reporting (3 edges, allowed=true, 新規違反=false)
  - 誘発依存: reporting -> workspace-infra (1 edges, allowed=true, 新規違反=false)
- 候補 `workspace-infra` score=1 (consumer=0, dependency=1)
  - 根拠: src/decision-outcome-ledger.js -> src/workspace.js
  - 誘発依存: gate-pr -> workspace-infra (3 edges, allowed=true, 新規違反=false)
  - 誘発依存: reporting -> workspace-infra (1 edges, allowed=true, 新規違反=false)

### src/dispatch-identity.js

- 推奨: machine_maintainable_assign (run-session) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 候補 `run-session` score=6 (consumer=3, dependency=0)
  - 根拠: src/agent-runtime-adapter.js -> src/dispatch-identity.js
  - 根拠: src/guarded-run-session.js -> src/dispatch-identity.js
  - 根拠: src/independent-review-orchestrator.js -> src/dispatch-identity.js

### src/merge-gate-authorization.js

- 推奨: machine_maintainable_assign (workspace-infra) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 候補 `workspace-infra` score=4 (consumer=2, dependency=0)
  - 根拠: src/execution-state.js -> src/merge-gate-authorization.js
  - 根拠: src/merge-manager.js -> src/merge-gate-authorization.js

### src/merge-public-projection.js

- 推奨: machine_maintainable_assign (reporting) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 候補 `reporting` score=4 (consumer=2, dependency=0)
  - 根拠: src/html-report.js -> src/merge-public-projection.js
  - 根拠: src/usage-report.js -> src/merge-public-projection.js
  - 誘発依存: gate-pr -> reporting (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> reporting (1 edges, allowed=false, 新規違反=false)
- 候補 `gate-pr` score=2 (consumer=1, dependency=0)
  - 根拠: src/canonical-audit.js -> src/merge-public-projection.js
  - 誘発依存: reporting -> gate-pr (2 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> gate-pr (1 edges, allowed=false, 新規違反=false)
- 候補 `workspace-infra` score=2 (consumer=1, dependency=0)
  - 根拠: src/merge-manager.js -> src/merge-public-projection.js
  - 誘発依存: gate-pr -> workspace-infra (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: reporting -> workspace-infra (2 edges, allowed=true, 新規違反=false)

### src/outcome-manager.js

- 推奨: machine_maintainable_assign (workspace-infra) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 孤児同士の隣接: src/atomic-file.js, src/canonical-persistence.js, src/decision-outcome-ledger.js
- 候補 `workspace-infra` score=6 (consumer=1, dependency=4)
  - 根拠: src/outcome-manager.js -> src/artifact-routing.js
  - 根拠: src/outcome-manager.js -> src/managed-command-executor.js
  - 根拠: src/outcome-manager.js -> src/story-id.js
  - 根拠: src/outcome-manager.js -> src/workspace.js
  - 根拠: src/merge-manager.js -> src/outcome-manager.js
  - 誘発依存: cli -> workspace-infra (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> gate-pr (2 edges, allowed=false, 新規違反=false)
- 候補 `gate-pr` score=2 (consumer=0, dependency=2)
  - 根拠: src/outcome-manager.js -> src/canonical-audit.js
  - 根拠: src/outcome-manager.js -> src/content-binding.js
  - 誘発依存: cli -> gate-pr (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: gate-pr -> workspace-infra (4 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> gate-pr (1 edges, allowed=false, 新規違反=false)

### src/process-record-store.js

- 推奨: machine_maintainable_assign (workspace-infra) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 候補 `workspace-infra` score=2 (consumer=0, dependency=2)
  - 根拠: src/process-record-store.js -> src/story-id.js
  - 根拠: src/process-record-store.js -> src/workspace.js
  - 誘発依存: cli -> workspace-infra (1 edges, allowed=true, 新規違反=false)

### src/progress-deadline.js

- 推奨: machine_maintainable_assign (graph) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 孤児同士の隣接: src/codex-subagent-runtime-adapter.js, src/verification-runner.js
- 候補 `graph` score=2 (consumer=1, dependency=0)
  - 根拠: src/graphify-adapter.js -> src/progress-deadline.js

### src/reconciliation-action.js

- 推奨: human_adjudication — 最高スコアが複数モジュールで同点 (reporting, workspace-infra)
- 候補 `reporting` score=4 (consumer=2, dependency=0)
  - 根拠: src/html-report.js -> src/reconciliation-action.js
  - 根拠: src/usage-report.js -> src/reconciliation-action.js
  - 誘発依存: gate-pr -> reporting (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> reporting (2 edges, allowed=false, 新規違反=false)
- 候補 `workspace-infra` score=4 (consumer=2, dependency=0)
  - 根拠: src/execution-state.js -> src/reconciliation-action.js
  - 根拠: src/merge-manager.js -> src/reconciliation-action.js
  - 誘発依存: gate-pr -> workspace-infra (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: reporting -> workspace-infra (2 edges, allowed=true, 新規違反=false)
- 候補 `gate-pr` score=2 (consumer=1, dependency=0)
  - 根拠: src/canonical-audit.js -> src/reconciliation-action.js
  - 誘発依存: reporting -> gate-pr (2 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> gate-pr (2 edges, allowed=false, 新規違反=false)

### src/review-inspection-inputs.js

- 推奨: human_adjudication — 最高スコアが複数モジュールで同点 (gate-pr, review)
- 候補 `gate-pr` score=4 (consumer=2, dependency=0)
  - 根拠: src/pr-manager.js -> src/review-inspection-inputs.js
  - 根拠: src/validation-sequencing.js -> src/review-inspection-inputs.js
  - 誘発依存: review -> gate-pr (2 edges, allowed=false, 新規違反=false)
- 候補 `review` score=4 (consumer=2, dependency=0)
  - 根拠: src/agent-review.js -> src/review-inspection-inputs.js
  - 根拠: src/review-repair.js -> src/review-inspection-inputs.js
  - 誘発依存: gate-pr -> review (2 edges, allowed=true, 新規違反=false)

### src/review-surface-violations.js

- 推奨: human_adjudication — 最高スコアが複数モジュールで同点 (gate-pr, review)
- 候補 `gate-pr` score=2 (consumer=1, dependency=0)
  - 根拠: src/pr-manager.js -> src/review-surface-violations.js
  - 誘発依存: review -> gate-pr (1 edges, allowed=false, 新規違反=false)
- 候補 `review` score=2 (consumer=1, dependency=0)
  - 根拠: src/agent-review.js -> src/review-surface-violations.js
  - 誘発依存: gate-pr -> review (1 edges, allowed=true, 新規違反=false)

### src/story-transaction-lock.js

- 推奨: machine_maintainable_assign (workspace-infra) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 候補 `workspace-infra` score=5 (consumer=2, dependency=1)
  - 根拠: src/story-transaction-lock.js -> src/workspace.js
  - 根拠: src/execution-state.js -> src/story-transaction-lock.js
  - 根拠: src/merge-manager.js -> src/story-transaction-lock.js

### src/task-bound-repo-control.js

- 推奨: machine_maintainable_assign (gate-pr) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 候補 `gate-pr` score=2 (consumer=1, dependency=0)
  - 根拠: src/pr-manager.js -> src/task-bound-repo-control.js

### src/verification-runner.js

- 推奨: machine_maintainable_assign (workspace-infra) — 単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない
- 孤児同士の隣接: src/progress-deadline.js
- 候補 `workspace-infra` score=2 (consumer=0, dependency=2)
  - 根拠: src/verification-runner.js -> src/artifact-routing.js
  - 根拠: src/verification-runner.js -> src/workspace.js
  - 誘発依存: cli -> workspace-infra (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: workspace-infra -> evidence (1 edges, allowed=false, 新規違反=false)
- 候補 `evidence` score=1 (consumer=0, dependency=1)
  - 根拠: src/verification-runner.js -> src/verification-evidence.js
  - 誘発依存: cli -> evidence (1 edges, allowed=true, 新規違反=false)
  - 誘発依存: evidence -> workspace-infra (2 edges, allowed=true, 新規違反=false)

## 孤児クラスタ (新モジュール候補の母集団)

- orphan_cluster:src/agent-completion-inbox.js — members=5, touchpoints=cli/evidence/graph/run-session/workspace-infra, authority=human_adjudicated
  - src/agent-completion-inbox.js
  - src/codex-runtime-bridge.js
  - src/codex-subagent-runtime-adapter.js
  - src/progress-deadline.js
  - src/verification-runner.js
- orphan_cluster:src/atomic-file.js — members=4, touchpoints=cli/gate-pr/reporting/workspace-infra, authority=human_adjudicated
  - src/atomic-file.js
  - src/canonical-persistence.js
  - src/decision-outcome-ledger.js
  - src/outcome-manager.js
- orphan_cluster:src/codex-runtime-output-contract.js — members=2, touchpoints=none, authority=human_adjudicated
  - src/codex-runtime-output-contract.js
  - src/codex-subagent-host-worker.js
- orphan_cluster:src/budget-override-authority.js — members=1, touchpoints=reporting/workspace-infra, authority=machine_maintainable
  - src/budget-override-authority.js
- orphan_cluster:src/codex-subagent-host.js — members=1, touchpoints=cli, authority=machine_maintainable
  - src/codex-subagent-host.js
- orphan_cluster:src/dispatch-identity.js — members=1, touchpoints=run-session, authority=machine_maintainable
  - src/dispatch-identity.js
- orphan_cluster:src/merge-gate-authorization.js — members=1, touchpoints=workspace-infra, authority=machine_maintainable
  - src/merge-gate-authorization.js
- orphan_cluster:src/merge-public-projection.js — members=1, touchpoints=gate-pr/reporting/workspace-infra, authority=machine_maintainable
  - src/merge-public-projection.js
- orphan_cluster:src/process-record-store.js — members=1, touchpoints=cli/workspace-infra, authority=machine_maintainable
  - src/process-record-store.js
- orphan_cluster:src/reconciliation-action.js — members=1, touchpoints=gate-pr/reporting/workspace-infra, authority=machine_maintainable
  - src/reconciliation-action.js
- orphan_cluster:src/review-inspection-inputs.js — members=1, touchpoints=gate-pr/review, authority=machine_maintainable
  - src/review-inspection-inputs.js
- orphan_cluster:src/review-surface-violations.js — members=1, touchpoints=gate-pr/review, authority=machine_maintainable
  - src/review-surface-violations.js
- orphan_cluster:src/story-transaction-lock.js — members=1, touchpoints=workspace-infra, authority=machine_maintainable
  - src/story-transaction-lock.js
- orphan_cluster:src/task-bound-repo-control.js — members=1, touchpoints=gate-pr, authority=machine_maintainable
  - src/task-bound-repo-control.js

## 未宣言依存の仕分け

- `workspace-infra -> gate-pr` (6 edges, R-001) → **resolve** [code_change]
  - R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する
- `gate-pr -> uiux-design` (4 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `gate-pr -> scanners` (3 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `review -> gate-pr` (3 edges, R-004) → **resolve** [code_change]
  - 逆向き (gate-pr -> review) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `review -> reporting` (3 edges, R-004) → **resolve** [code_change]
  - 逆向き (reporting -> review) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `diagnosis -> architecture` (2 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `diagnosis -> evidence` (2 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `diagnosis -> spec` (2 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `evidence -> gate-pr` (2 edges, R-004) → **resolve** [code_change]
  - 逆向き (gate-pr -> evidence) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `gate-pr -> architecture` (2 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `story -> reporting` (2 edges, R-004) → **resolve** [code_change]
  - 逆向き (reporting -> story) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `story -> task` (2 edges, R-004) → **resolve** [code_change]
  - 逆向き (task -> story) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `workspace-infra -> reporting` (2 edges, R-001) → **resolve** [code_change]
  - R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する
- `workspace-infra -> review` (2 edges, R-001) → **resolve** [code_change]
  - R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する
- `architecture -> gate-pr` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `diagnosis -> cli` (1 edges, R-002) → **resolve** [code_change]
  - R-002: cli 以外のモジュールは cli に依存しない。宣言では解消できない
- `diagnosis -> gate-pr` (1 edges, R-004) → **resolve** [code_change]
  - 逆向き (gate-pr -> diagnosis) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `diagnosis -> task` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `evidence -> run-session` (1 edges, R-004) → **resolve** [code_change]
  - 逆向き (run-session -> evidence) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `gate-pr -> cli` (1 edges, R-002) → **resolve** [code_change]
  - R-002: cli 以外のモジュールは cli に依存しない。宣言では解消できない
- `reporting -> scanners` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `review -> diagnosis` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `review -> run-session` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `run-session -> gate-pr` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `run-session -> review` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `scanners -> evidence` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `scanners -> graph` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `scanners -> skills` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `spec -> diagnosis` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `spec -> evidence` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `spec -> gate-pr` (1 edges, R-004) → **resolve** [code_change]
  - 逆向き (gate-pr -> spec) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `story -> architecture` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `story -> cli` (1 edges, R-002) → **resolve** [code_change]
  - R-002: cli 以外のモジュールは cli に依存しない。宣言では解消できない
- `story -> diagnosis` (1 edges, R-004) → **resolve** [code_change]
  - 逆向き (diagnosis -> story) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `story -> gate-pr` (1 edges, R-004) → **resolve** [code_change]
  - 逆向き (gate-pr -> story) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる
- `story -> run-session` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `story -> uiux-design` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `uiux-design -> graph` (1 edges, R-004) → **declare_candidate** [human_adjudicated]
  - R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要
- `workspace-infra -> cli` (1 edges, R-001) → **resolve** [code_change]
  - R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する
- `workspace-infra -> evidence` (1 edges, R-001) → **resolve** [code_change]
  - R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する
- `workspace-infra -> run-session` (1 edges, R-001) → **resolve** [code_change]
  - R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する

## 人間裁定が必要な項目

- [new_allowed_dependency] architecture -> gate-pr (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] diagnosis -> architecture (2 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] diagnosis -> evidence (2 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] diagnosis -> spec (2 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] diagnosis -> task (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] gate-pr -> architecture (2 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] gate-pr -> scanners (3 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] gate-pr -> uiux-design (4 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] reporting -> scanners (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] review -> diagnosis (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] review -> run-session (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] run-session -> gate-pr (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] run-session -> review (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] scanners -> evidence (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] scanners -> graph (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] scanners -> skills (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] spec -> diagnosis (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] spec -> evidence (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] story -> architecture (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] story -> run-session (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] story -> uiux-design (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_allowed_dependency] uiux-design -> graph (1 edges) — この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか
- [new_module_candidate] src/agent-completion-inbox.js, src/codex-runtime-bridge.js, src/codex-subagent-runtime-adapter.js, src/progress-deadline.js, src/verification-runner.js — このクラスタを新モジュールとして新設するか、既存モジュールへ吸収するか
- [new_module_candidate] src/atomic-file.js, src/canonical-persistence.js, src/decision-outcome-ledger.js, src/outcome-manager.js — このクラスタを新モジュールとして新設するか、既存モジュールへ吸収するか
- [new_module_candidate] src/codex-runtime-output-contract.js, src/codex-subagent-host-worker.js — このクラスタを新モジュールとして新設するか、既存モジュールへ吸収するか
- [rule_inversion] diagnosis -> cli (1 edges, R-002) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] gate-pr -> cli (1 edges, R-002) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] story -> cli (1 edges, R-002) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] workspace-infra -> cli (1 edges, R-001) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] workspace-infra -> evidence (1 edges, R-001) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] workspace-infra -> gate-pr (6 edges, R-001) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] workspace-infra -> reporting (2 edges, R-001) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] workspace-infra -> review (2 edges, R-001) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
- [rule_inversion] workspace-infra -> run-session (1 edges, R-001) — 逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）
