---
story_id: story-vibepro-codex-instructions
title: VibePro Codex Instructions Spec
story_ref: docs/stories/vibepro-codex-instructions-story.md
architecture_ref: docs/architecture/vibepro-codex-instructions-architecture.md
---

# Spec: VibePro Codex Instructions

## 同梱テンプレート

- `agent-instructions/codex/AGENTS.vibepro.md`

## CLI

```bash
vibepro codex install [repo] [--dry-run] [--force] [--json]
vibepro codex verify [repo] [--json]
```

## install

導入先:

```text
<repo>/AGENTS.md
```

`AGENTS.md` が存在しない場合は作成する。存在するがVibePro管理ブロックがない場合は末尾へ追記する。VibePro管理ブロックが存在し同梱版と異なる場合、既定では `skipped` として上書きしない。`--force` 指定時のみ管理ブロックを同梱版へ更新する。`--dry-run` 指定時は書き込まず、`would_install`、`would_append`、または `would_overwrite` を返す。

管理ブロック:

```text
<!-- VIBEPRO_CODEX_START -->
...
<!-- VIBEPRO_CODEX_END -->
```

## verify

状態:

- `ok`: 対象repoの管理ブロックが同梱版と一致する
- `missing`: `AGENTS.md` または管理ブロックが存在しない
- `outdated`: 管理ブロックが存在するが同梱版と異なる

`ok` の場合は `overall_status: ok`、それ以外は `overall_status: needs_install` とする。

## 内容要件

Codex向け管理ブロックは、Codexが `.claude/skills/SKILL.md` を読まない環境でもVibeProの現行運用を再現できるよう、以下を含む。

- Story -> Architecture -> Spec -> Task -> Code -> Gate -> PR の順序
- `vibepro check list`
- `vibepro check ui|security|performance|architecture|pr-readiness|launch-readiness`
- `vibepro performance define|record|compare`
- DB/server性能とユーザー体感性能を別metricにするルール
- server logだけでuser-perceived改善を断定しないguardrail
- performance comparison不能時に改善率不明と不足証跡を明示するルール
