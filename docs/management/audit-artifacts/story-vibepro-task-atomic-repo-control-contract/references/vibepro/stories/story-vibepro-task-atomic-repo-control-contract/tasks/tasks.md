# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | Task依存グラフに束縛されたrepo-controlをatomic単一PRとしてfail-closedに裁定する |
| Story ID | story-vibepro-task-atomic-repo-control-contract |
| Run ID | 2026-07-30T100933Z |
| Gate | needs_review |
| タスク数 | 2 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| TAR-TASK-01 | - | high | 8件 | tdd | done |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-by-graph-community | todo |

## TAR-TASK-01: Task-bound repo-control atomic判定をfail-closedで実装する

- Source: accepted_spec / story-vibepro-task-atomic-repo-control-contract
- Execution: tdd / mutates_repository=true
- Target files: src/pr-manager.js, test/task-bound-repo-control.test.js, test/vibepro-cli.test.js, test/e2e/story-vibepro-task-atomic-repo-control-contract-main.spec.ts, docs/management/stories/active/story-vibepro-task-atomic-repo-control-contract.md, docs/architecture/story-vibepro-task-atomic-repo-control-contract.md, docs/specs/story-vibepro-task-atomic-repo-control-contract.md, docs/specs/story-vibepro-task-atomic-repo-control-contract.vibepro.json
- Target groups: requirements-ssot(0), runtime-policy(0), contract-tests(0)
- Read first: src/pr-manager.js, test/vibepro-cli.test.js, docs/architecture/story-vibepro-task-atomic-repo-control-contract.md
- Recommended strategy: tdd

完了条件:
- TAR-S-1からTAR-S-6を満たす
- Taskなし・不正Taskはfail-closedを維持する
- machine-readable evidenceにTask bindingを残す

## VP-TASK-ARCH-001: responsibility split campaignをStory化する

- Source: action_candidate / VP-ACTION-ARCH-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/session-efficiency-audit.js
- Target groups: -
- Read first: src/session-efficiency-audit.js, src/cli.js, src/workspace.js, src/run-context-capsule.js, src/canonical-audit.js, src/run-lineage.js, src/evidence-cost-budget.js, src/merge-manager.js
- Recommended strategy: split-by-graph-community

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。
