# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | story-vibepro-run-context-capsule |
| Story ID | story-vibepro-run-context-capsule |
| Run ID | 2026-07-16T014141Z |
| Gate | pass |
| タスク数 | 1 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-run-context-capsule-source-alignment-review | - | high | 12件 | source-alignment-review | todo |

## story-vibepro-run-context-capsule-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-run-context-capsule-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/graph-context.js, src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js, src/cli.js, src/workspace.js, src/diagnostic-engine.js, src/architecture-profiler.js, src/playbook-exporter.js
- Target groups: -
- Read first: src/graph-context.js, src/nocodb-story-sync.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-task-generator.js, src/cli.js
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している