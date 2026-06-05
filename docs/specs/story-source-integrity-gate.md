---
story_id: story-story-source-integrity-gate
architecture_ref: docs/architecture/ADR-story-source-integrity-gate.md
---

# Spec: Story Source Integrity Gate

## Contract

- `pr prepare` は選択Storyと変更Story文書の同一性を評価し、結果を `pr_context.story_source_integrity` に保存する。
- Story文書が選択Storyに一致しない場合、`gate:story_source_integrity` は `story_source_mismatch` になり、PR作成のcritical blockerになる。
- Story文書が不一致の場合、VibeProはその文書をPR本文・Requirement Gate・受け入れ基準の正本として扱わない。
- 同一性判定は `story_id`、`vibepro_story_id`、ファイル名slug、titleの順に使い、旧形式の `STR-001-<slug>.md` と `story-<slug>` の対応を許可する。

## Verification

- 不一致Story文書を含むPR準備で `story_source_mismatch` を検出する回帰テストを持つ。
- 既存の旧形式Story文書fixtureは、同一slugまたは `vibepro_story_id` により正しくStory sourceとして扱われる。
- Gate DAG connectivity testはStory Source Integrity Gateを経由するedgeを検証する。
