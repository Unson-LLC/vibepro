---
title: VibePro Worktree Lifecycle Skill Spec
status: active
story_ref: docs/management/stories/active/story-vibepro-worktree-lifecycle-skill.md
code_refs:
  - skills/vibepro-worktree-lifecycle/SKILL.md
  - skills/vibepro-workflow/SKILL.md
test_refs:
  - test/vibepro-cli.test.js
---

# VibePro Worktree Lifecycle Skill Spec

## Contracts

- `WLS-001`: bundled Skill一覧に`vibepro-worktree-lifecycle`が存在する。
- `WLS-002`: install後のSkillは`vibepro worktree inspect`と`vibepro worktree close`を案内する。
- `WLS-003`: Skillは判断DAGから独立し、CLIの`safe_to_close`判定を正本にする。
- `WLS-004`: workflow Skillはworktree利用時の終了処理をlifecycle Skillへ委譲する。
- `WLS-005`: force removal、一括prune、owner不明worktreeの削除を許可しない。

## Verification

```bash
node --test --test-name-pattern='skills commands list install and verify bundled VibePro skills' test/vibepro-cli.test.js
node bin/vibepro.js skills lint . --json
```
