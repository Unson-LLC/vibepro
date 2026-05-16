---
story_id: story-vibepro-worktree-pr-scope-isolation
title: "VibePro自己改善: PR対象差分と作業中dirtyを分離する"
source:
  type: codex-log-audit
  id: VP-SELF-003
  title: "明示base/headのPR準備に無関係dirty fileが混入した"
architecture_docs:
  - ../../architecture/vibepro-self-dogfood-control-loop-architecture.md
spec_docs:
  - ../../specs/vibepro-self-dogfood-control-loop.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Story: VibePro自己改善: PR対象差分と作業中dirtyを分離する

## User Story

**As a** VibeProでPR準備と分割計画を作るユーザー
**I want to** PR対象のcommitted diffと、ローカルのdirty / staged / generated artifactが分離される
**So that** 無関係な作業中ファイルがPR対象やsplit laneやgate主判定へ混ざらない

## Background

`vibepro pr prepare --base <ref> --head <ref>` で明示headを指定したにもかかわらず、head差分に含まれないdirty fileが `git.changed_files` やsplit planへ混ざり、`needs_clean_branch` 判定になった。

この問題は一部修正済みだが、VibePro自身のStoryとして正本化し、今後のPR evidence / verification evidenceの一般的な堅牢性改善として扱う必要がある。

## Acceptance Criteria

- [ ] `--head` 明示時の `changed_files` は `base..head` の差分だけになる
- [ ] dirty worktreeは `dirty_files` として別枠に残り、PR対象のsplit plan laneには混ざらない
- [ ] staged diff、unstaged diff、untracked file、VibePro生成物を別々に表示できる
- [ ] dirty fileがあるだけで、明示headのPR prepareを `needs_clean_branch` にしない
- [ ] `--head` 未指定でworking copyを対象にする場合は、従来どおりdirtyを対象に含められる
- [ ] `git status --porcelain` の先頭空白やrename表記を壊さず解析する回帰テストがある

## Implementation Notes

- 対象候補: `src/pr-manager.js`, `src/git-utils.js`
- 最新修正の回帰条件をSpecへ固定し、将来の変更で戻らないようにする
