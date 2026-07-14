# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | gate evidence機構をmalformed workspaceとextra bag衝突に対して堅牢化する |
| Story ID | story-vibepro-gate-evidence-edge-robustness |
| Run ID | ger-design-input |
| Gate | needs_review |
| タスク数 | 1 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-by-graph-community | todo |

## VP-TASK-ARCH-001: responsibility split campaignをStory化する

- Source: action_candidate / VP-ACTION-ARCH-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/session-efficiency-audit.js
- Target groups: -
- Read first: src/session-efficiency-audit.js, src/cli.js, src/workspace.js, src/evidence-cost-budget.js, src/merge-manager.js
- Recommended strategy: split-by-graph-community

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。