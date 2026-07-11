# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | story-vibepro-workspace-status-derive-only |
| Story ID | story-vibepro-workspace-status-derive-only |
| Run ID | 2026-07-11T140119Z |
| Gate | pass |
| タスク数 | 1 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-workspace-status-derive-only-source-alignment-review | - | high | 12件 | source-alignment-review | todo |

## story-vibepro-workspace-status-derive-only-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-workspace-status-derive-only-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/architecture-readiness.js, src/managed-worktree-gate.js, src/managed-worktree.js, src/nocodb-story-sync.js, src/oss-readiness-scanner.js, src/pre-spec-readiness.js, src/public-discovery-scanner.js, src/repo-status.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js
- Target groups: -
- Read first: src/architecture-readiness.js, src/managed-worktree-gate.js, src/managed-worktree.js, src/nocodb-story-sync.js, src/oss-readiness-scanner.js, src/pre-spec-readiness.js, src/public-discovery-scanner.js, src/repo-status.js
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している