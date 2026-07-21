# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | Guarded Autonomyを予算・独立Review・成果指標で本番運用可能にする |
| Story ID | story-vibepro-guarded-autonomy-hardening |
| Run ID | 2026-07-21T025324Z |
| Gate | pass |
| タスク数 | 3 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-guarded-autonomy-hardening-spec-recovery | - | low | 11件 | spec-recovery | todo |
| story-vibepro-guarded-autonomy-hardening-architecture-recovery | - | low | 11件 | architecture-recovery | todo |
| story-vibepro-guarded-autonomy-hardening-source-alignment-review | - | high | 12件 | source-alignment-review | todo |

## story-vibepro-guarded-autonomy-hardening-spec-recovery: Spec正本を復元する

- Source: story_plan_candidate / story-vibepro-guarded-autonomy-hardening-spec-recovery
- Execution: proposal_only / mutates_repository=false
- Target files: src/agent-review.js, src/guarded-run-session.js, src/nocodb-story-sync.js, src/review-finding-repair-loop.js, src/review-repair.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-run-portfolio.js, src/story-task-generator.js
- Target groups: -
- Read first: src/agent-review.js, src/guarded-run-session.js, src/nocodb-story-sync.js, src/review-finding-repair-loop.js, src/review-repair.js, src/story-candidate-generator.js, src/cli.js, src/workspace.js, src/pr-manager.js, src/language.js
- Recommended strategy: spec-recovery

完了条件:
- missing_spec が残る理由を確認済みにする
- Storyのwho/problem/outcomeが人間レビュー済みになる
- Spec草案の受け入れ基準がコード分岐と対応する
- 必要なら仕様書またはNocoDB Storyを作る

## story-vibepro-guarded-autonomy-hardening-architecture-recovery: Architecture/ADR正本を復元する

- Source: story_plan_candidate / story-vibepro-guarded-autonomy-hardening-architecture-recovery
- Execution: proposal_only / mutates_repository=false
- Target files: src/agent-review.js, src/guarded-run-session.js, src/nocodb-story-sync.js, src/review-finding-repair-loop.js, src/review-repair.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-run-portfolio.js, src/story-task-generator.js
- Target groups: -
- Read first: src/agent-review.js, src/guarded-run-session.js, src/nocodb-story-sync.js, src/review-finding-repair-loop.js, src/review-repair.js, src/story-candidate-generator.js, src/cli.js, src/workspace.js, src/pr-manager.js, src/language.js
- Recommended strategy: architecture-recovery

完了条件:
- Architecture/ADRが必要か、不要なら理由が明示されている
- API/Auth/Billing/Data/外部連携の境界判断がGraph文脈と対応する
- Requirement GateでArchitecture SourceまたはADR不要理由を追跡できる

## story-vibepro-guarded-autonomy-hardening-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-guarded-autonomy-hardening-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: src/agent-review.js, src/guarded-run-session.js, src/nocodb-story-sync.js, src/review-finding-repair-loop.js, src/review-repair.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js, src/story-manager.js, src/story-run-portfolio.js, src/story-task-generator.js, src/cli.js
- Target groups: -
- Read first: src/agent-review.js, src/guarded-run-session.js, src/nocodb-story-sync.js, src/review-finding-repair-loop.js, src/review-repair.js, src/story-candidate-generator.js, src/story-catalog-generator.js, src/story-html.js
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している