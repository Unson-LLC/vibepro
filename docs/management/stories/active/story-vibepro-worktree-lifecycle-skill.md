---
story_id: story-vibepro-worktree-lifecycle-skill
title: Ship the worktree lifecycle as reusable agent guidance
status: active
---

# Worktree lifecycle Skillを配布する

## Intent

VibeProの安全なworktree検査・閉鎖を、CLIを知っている今回の作業者だけでなく、Skills Packを導入したエージェントが毎回再現できるようにする。

## Acceptance criteria

- `vibepro-worktree-lifecycle`が同梱Skillとしてlist、install、verify、lintの対象になる。
- Skillはinspectを先行し、`safe_to_close`の場合だけcloseへ進む。
- Skillはforce removal、一括prune、owner不明worktreeの削除を禁止する。
- `vibepro-workflow`がworktree利用時の終了処理として専用Skillへ引き継ぐ。
- 閉鎖可否の判定は既存CLIを正本とし、判断DAGやSkill内へ複製しない。

## Done evidence

- bundled Skillsの対象テストとSkill lintが通る。
- install先のSkill本文とworkflowからの導線をテストで確認する。
