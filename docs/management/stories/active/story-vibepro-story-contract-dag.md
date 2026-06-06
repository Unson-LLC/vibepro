---
story_id: story-vibepro-story-contract-dag
title: Business/Dev Story Contract DAGでStoryを開発可能な契約に変換する
architecture_docs:
  - docs/architecture/vibepro-story-contract-dag.md
spec_docs:
  - docs/specs/vibepro-story-contract-dag.md
view: dev
period: 2026-06
---

# Story: Business/Dev Story Contract DAGでStoryを開発可能な契約に変換する

## Background

VibeProのStoryは、ビジネス側の入力や既存ドキュメントをそのまま「実装すべき要求」として扱うと誤る。たとえばVibePro自身の `authorization scoring` ドキュメントは開発ツール内部の承認判断仕様だが、`story derive` は `authorization` という語だけで `story-product-auth-account-access` に寄せられる可能性がある。

必要なのは、Storyを「ユーザー視点の文章」ではなく、ビジネス意図、開発境界、リスク、受け入れ例、検証方針を揃えた開発可能な契約へ変換するDAGである。ビジネス側が詳細な技術境界を書けない前提で、VibeProが未確定点を質問、finding、task候補へ上げる。

## Who / Problem / Want / Outcome

- who: VibeProでAI/人間エンジニアにStoryを引き継ぐ開発者
- problem: Story由来の根拠が弱い場合でも、語彙一致だけでproduct storyや実装タスクへ進んでしまう
- want: Storyが開発可能な契約として、何が未確定か、どの根拠を信じてよいか、どの境界を先に確認すべきかを示してほしい
- outcome: Senior engineerがStory Map/Planを読んだ時に、実装前に止めるべき誤解と確認事項を判断できる
- business_value: VibeProがテスト通過支援ではなく、AI開発の要件誤読と引き継ぎ失敗を減らすプロダクト価値を出す

## Acceptance Criteria

- `story derive` が各Storyに `derived.story_contract` を出力する。
- `story_contract` は `story_type`、`status`、`checks`、`open_questions`、`developer_boundary_hypothesis`、`risk_surface_hypothesis`、`verification_strategy` を含む。
- `story_contract.status` は未解決checkがある場合に `needs_clarification` になり、対応する `story_contract_*` open questionを `catalog.open_questions` に出す。
- non-web/library repoでproduct template storyがdocument evidenceのみから生成された場合、`source_role_integrity` checkが `needs_clarification` になる。
- `story plan` はStory Contractの未解決をpriority score、source alignment finding、task candidateへ反映する。
- Story Mapは各StoryカードにStory Contractの要約を表示する。
- 既存の「明示的なdocument evidenceでproduct storyを作る」挙動は壊さず、誤読リスクだけを明示する。
- テストは、VibePro内部のauthorization scoringドキュメントがproduct auth storyに誤読されるケースを回帰として含む。

## Out of Scope

- LLMによる自然言語質問生成の導入。
- NocoDB同期スキーマの変更。
- PR gateのhard block化。今回のcontractはplan上の判断材料とtask候補に留める。
