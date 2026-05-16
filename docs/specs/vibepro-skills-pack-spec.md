---
story_id: story-vibepro-skills-pack
title: VibePro Skills Pack Spec
story_ref: docs/stories/vibepro-skills-pack-story.md
architecture_ref: docs/architecture/vibepro-skills-pack-architecture.md
---

# Spec: VibePro Skills Pack

## 同梱Skill

- `vibepro-workflow`
- `vibepro-story-refactor`
- `vibepro-human-review`

## CLI

```bash
vibepro skills list [--json]
vibepro skills install [repo] [--dry-run] [--force] [--json]
vibepro skills verify [repo] [--json]
```

## install

コピー先:

```text
<repo>/.claude/skills/<skill-name>/SKILL.md
```

既定では既存ファイルを上書きしない。既存ファイルが同梱版と異なる場合は `skipped` として報告する。`--force` 指定時のみ上書きする。`--dry-run` 指定時は書き込まず、`would_install` または `would_overwrite` を返す。

## verify

状態:

- `ok`: 対象repoのSkillが同梱版と一致する
- `missing`: 対象repoに存在しない
- `outdated`: 存在するが同梱版と異なる

全Skillが `ok` の場合は `overall_status: ok`、それ以外は `overall_status: needs_install` とする。
