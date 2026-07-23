# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | Agent Review freshnessを検査surfaceとrelease-impactに束縛する |
| Story ID | story-vibepro-surface-aware-agent-review-freshness |
| Run ID | 2026-07-23T172000Z |
| Gate | needs_review |
| タスク数 | 4 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-surface-aware-agent-review-freshness-01-surface-aware-freshness-policy | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-surface-aware-agent-review-freshness-02-rebase-and-fail-closed-regression-coverage | - | medium | 0件 | story-explicit-task | done |
| story-vibepro-surface-aware-agent-review-freshness-03-contract-and-operator-guidance | - | medium | 0件 | story-explicit-task | done |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-by-graph-community | todo |

## story-vibepro-surface-aware-agent-review-freshness-01-surface-aware-freshness-policy: Surface-aware freshness policy

- Source: story_explicit_task / story-vibepro-surface-aware-agent-review-freshness-01-surface-aware-freshness-policy
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md
- Recommended strategy: story-explicit-task

完了条件:
- gate_evidenceとrelease_riskのbuilt-in strict例外を削除する
- 理由付きrole policyとCLI strict overrideを維持する

## story-vibepro-surface-aware-agent-review-freshness-02-rebase-and-fail-closed-regression-coverage: Rebase and fail-closed regression coverage

- Source: story_explicit_task / story-vibepro-surface-aware-agent-review-freshness-02-rebase-and-fail-closed-regression-coverage
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md
- Recommended strategy: story-explicit-task

完了条件:
- unrelated main advance後のrebase/mergeでsurface不変reviewがcurrentであることを証明する
- surface変更、差分解決不能、明示strict overrideのstaleを証明する

## story-vibepro-surface-aware-agent-review-freshness-03-contract-and-operator-guidance: Contract and operator guidance

- Source: story_explicit_task / story-vibepro-surface-aware-agent-review-freshness-03-contract-and-operator-guidance
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: docs/management/stories/active/story-vibepro-surface-aware-agent-review-freshness.md
- Recommended strategy: story-explicit-task

完了条件:
- Architecture、Spec、英日guideを新しい既定freshness契約へ同期する
- #381との差分とrollback boundaryを記録する

## VP-TASK-ARCH-001: responsibility split campaignをStory化する

- Source: action_candidate / VP-ACTION-ARCH-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/session-efficiency-audit.js
- Target groups: -
- Read first: src/session-efficiency-audit.js, src/cli.js, src/workspace.js, src/run-context-capsule.js, src/run-lineage.js, src/evidence-cost-budget.js, src/merge-manager.js
- Recommended strategy: split-by-graph-community

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。