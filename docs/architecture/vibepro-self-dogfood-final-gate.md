---
story_id: story-vibepro-self-dogfood-final-gate
title: Self-Dogfood Final Gate Architecture
---

# Architecture

`vibepro check self-dogfood` は、VibePro repoの `.vibepro/pr/<story-id>` を監査する診断パッケージとして実装する。

この診断はPR作成処理そのものを変更せず、既存の `pr prepare` / `gate-dag` / `verify record` artifactの関係を読む。これにより、他repoの通常診断には影響させず、VibePro自身のdogfood品質だけを独立して可視化する。

## Decisions

- `verify record` は完了条件ではなく入力証跡として扱う。
- 完了判定は `gate-dag.overall_status` を正とする。
- 古い履歴を壊さないため、check packはfindingを出すだけでartifactを自動修復しない。
- `--story-id` がある場合は対象Storyだけを監査する。
