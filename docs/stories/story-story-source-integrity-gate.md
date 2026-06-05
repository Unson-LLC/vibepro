---
story_id: story-story-source-integrity-gate
title: Story Source Integrity Gateで誤Story混入を止める
architecture_docs:
  - path: docs/architecture/ADR-story-source-integrity-gate.md
    status: required
specifications:
  - path: docs/specs/story-source-integrity-gate.md
---

# Story Source Integrity Gateで誤Story混入を止める

## 背景

VibeProのPR準備では、変更されたStory文書が選択中のStoryと一致していない場合でも、単一のStory文書であればPR本文や要件証跡の正本として採用される経路があった。
この状態では、レビュアーがPR本文を読んだときに、実装差分とは別Storyの背景・受け入れ基準を信頼してしまう。

## 受け入れ基準

- 選択Storyと変更Story文書が一致しない場合、Story Source Integrity Gateがcritical blockerになる。
- 誤って混入したStory文書の受け入れ基準はPR本文に採用されない。
- `story-pr-prepare` と `STR-001-pr-prepare.md` のように同一slugを持つ旧形式Story文書は、誤検知として止めない。
- Gate DAGの接続は `story -> gate:story_source_integrity -> gate:engineering_judgment_route` で再現できる。

