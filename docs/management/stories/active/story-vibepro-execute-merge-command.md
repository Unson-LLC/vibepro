---
story_id: story-vibepro-execute-merge-command
title: VibePro管理のmerge経路を追加する
status: active
priority: high
owner: codex
created_at: 2026-06-07
updated_at: 2026-06-07
tags:
  - cli
  - pr
  - execution
  - managed-worktree
---

# 背景

- したいこと: `vibepro pr create` の後に、merge判断とmerge実行もVibeProのartifactに残したい
- 困っていること: 現状はGitHub CLIや人間の手作業でmergeしており、最終判断の根拠が `.vibepro` に残らない
- 目的: PR作成からmergeまでの一本道をVibeProで監査可能にし、raw運用への逸脱を減らす

# 受け入れ条件

- [ ] `vibepro execute merge <repo> --story-id <id>` を追加する
- [ ] `execute merge` は `pr create` から暗黙実行せず、明示コマンドでのみ動く
- [ ] PR URLは `pr-create.json` または明示指定から解決し、未解決ならblockingで止める
- [ ] `execute merge` は Gate DAG ready、base freshness、remote PR head一致、non-workspace dirtyなし、required checks完了を確認し、未達ならmergeを拒否する
- [ ] merge結果を `.vibepro/pr/<story-id>/pr-merge.json` と `pr-merge.html` に記録する
- [ ] `vibepro-manifest.json` に最新merge artifactを記録する
- [ ] execution state / execution DAG の `merge_ready` と `merged_or_closed` が `not_applicable` 固定ではなく current state を反映する
- [ ] `managed_worktree=required` では `execute merge` も管理worktree外から拒否する

# メモ

- merge strategy はまず `merge|squash|rebase` の明示指定を受け、既定値は `merge` にする
- branch deletion は opt-in に留め、削除失敗は merge成功と分離して記録する
