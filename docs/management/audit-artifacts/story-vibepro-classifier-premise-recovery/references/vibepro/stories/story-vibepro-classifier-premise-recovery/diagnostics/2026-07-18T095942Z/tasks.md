# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | 誤ったclassifier premiseを訂正して再裁定できるようにする |
| Story ID | story-vibepro-classifier-premise-recovery |
| Run ID | 2026-07-18T095942Z |
| Gate | needs_review |
| タスク数 | 2 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-classifier-premise-recovery-source-alignment-review | - | high | 12件 | source-alignment-review | done |
| VP-TASK-ARCH-001 | VP-ARCH-001 | medium | 1件 | split-runtime-boundaries | todo |

## story-vibepro-classifier-premise-recovery-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-classifier-premise-recovery-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/change-risk-classifier.js, src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js, src/cli.js, src/workspace.js, src/pr-manager.js, src/diagnostic-engine.js, src/architecture-profiler.js
- Target groups: -
- Read first: src/change-risk-classifier.js, src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js, src/cli.js
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している

## VP-TASK-ARCH-001: responsibility split campaignをStory化する

- Source: action_candidate / VP-ACTION-ARCH-001
- Execution: proposal_only / mutates_repository=false
- Target files: src/session-efficiency-audit.js
- Target groups: -
- Read first: src/session-efficiency-audit.js, src/cli.js, src/workspace.js, src/run-context-capsule.js, src/evidence-cost-budget.js, src/merge-manager.js
- Recommended strategy: split-runtime-boundaries

完了条件:
- campaign内の機会がStory単位として実装順に並んでいる。
- 最初に直す機会と後続に回す機会の判断根拠がscore/reasonで説明できる。
- 修正後のVibePro診断で対象findingまたはopportunityの件数差分を確認できる。
- 混在していた責務が読み取れる単位へ分離されている。
- 既存テストまたは型検査で入出力互換性が確認されている。
- VibePro診断で責務混在候補の根拠が減っている。