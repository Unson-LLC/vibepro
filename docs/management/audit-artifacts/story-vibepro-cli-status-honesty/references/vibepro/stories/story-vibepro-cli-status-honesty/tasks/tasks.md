# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | story-vibepro-cli-status-honesty |
| Story ID | story-vibepro-cli-status-honesty |
| Run ID | 2026-07-10T073818Z |
| Gate | pass |
| タスク数 | 1 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-cli-status-honesty-source-alignment-review | - | medium | 12件 | source-alignment-review | todo |

## story-vibepro-cli-status-honesty-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-cli-status-honesty-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/ci-evidence.js, src/evidence-cost-budget.js, src/evidence-depth-planner.js, src/evidence-reuse.js, src/explore-evidence.js, src/nocodb-story-sync.js, src/performance-evidence.js, src/repo-status.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js
- Target groups: -
- Read first: src/ci-evidence.js, src/evidence-cost-budget.js, src/evidence-depth-planner.js, src/evidence-reuse.js, src/explore-evidence.js, src/nocodb-story-sync.js, src/performance-evidence.js, src/repo-status.js
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している