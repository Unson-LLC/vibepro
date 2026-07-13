# VibePro 生成タスク

| 項目 | 内容 |
|------|------|
| Story | 責務Authorityの誤fan-outを防ぐ |
| Story ID | story-vibepro-responsibility-authority-match-precision |
| Run ID | story-plan |
| Gate | unavailable |
| タスク数 | 3 |

| ID | Finding | 優先度 | 対象 | 方針 | 状態 |
|----|---------|--------|------|------|------|
| story-vibepro-responsibility-authority-match-precision-spec-recovery | - | low | 0件 | spec-recovery | todo |
| story-vibepro-responsibility-authority-match-precision-architecture-recovery | - | low | 0件 | architecture-recovery | todo |
| story-vibepro-responsibility-authority-match-precision-source-alignment-review | - | high | 0件 | source-alignment-review | todo |

## story-vibepro-responsibility-authority-match-precision-spec-recovery: Spec正本を復元する

- Source: story_plan_candidate / story-vibepro-responsibility-authority-match-precision-spec-recovery
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: -
- Recommended strategy: spec-recovery

完了条件:
- missing_spec が残る理由を確認済みにする
- Storyのwho/problem/outcomeが人間レビュー済みになる
- Spec草案の受け入れ基準がコード分岐と対応する
- 必要なら仕様書またはNocoDB Storyを作る

## story-vibepro-responsibility-authority-match-precision-architecture-recovery: Architecture/ADR正本を復元する

- Source: story_plan_candidate / story-vibepro-responsibility-authority-match-precision-architecture-recovery
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: -
- Recommended strategy: architecture-recovery

完了条件:
- Architecture/ADRが必要か、不要なら理由が明示されている
- API/Auth/Billing/Data/外部連携の境界判断がGraph文脈と対応する
- Requirement GateでArchitecture SourceまたはADR不要理由を追跡できる

## story-vibepro-responsibility-authority-match-precision-source-alignment-review: Story/Spec/ADR不整合をレビューする

- Source: source_alignment_finding / story-vibepro-responsibility-authority-match-precision-source-alignment-review
- Execution: proposal_only / mutates_repository=false
- Target files: -
- Target groups: -
- Read first: -
- Recommended strategy: source-alignment-review

完了条件:
- 各潜在バグ候補について、Story/Spec/ADR/コードのどれを修正するか判断している
- Graphifyのhub/communityを読んだ上で影響範囲を説明できる
- 要件が正しい場合はレビュー済み理由を正本またはPR本文に残している