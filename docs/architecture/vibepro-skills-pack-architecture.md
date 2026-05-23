---
story_id: story-vibepro-skills-pack
title: VibePro Skills Pack Architecture
story_ref: docs/stories/vibepro-skills-pack-story.md
spec_ref: docs/specs/vibepro-skills-pack-spec.md
---

# Architecture: VibePro Skills Pack

## 方針

VibePro CLIはSkillなしでも使える状態を維持する。AI agentが100%性能を発揮するための手順記憶は、任意導入のSkills Packとして配布する。

## 責務境界

- `skills/`
  - npm packageに同梱するVibePro専用Skillの正本
  - 診断パッケージとperformance evidence frameworkの運用ルールもここに含める
- `vibepro skills list`
  - 同梱Skillの一覧を表示する
- `vibepro skills install`
  - 対象repoの `.claude/skills/` にSkillをコピーする
  - 既存ファイルは既定で上書きしない
- `vibepro skills verify`
  - 対象repoのSkillが同梱版と一致するか確認する

## 判断

`vibepro init` ではSkillsを自動導入しない。対象repoへの変更を最小化し、100%性能が必要な時だけ `vibepro skills install` でopt-inする。

external portfolio dashboardなど特定repoの `.claude/skills/` を直接更新しても、それは配布正本ではない。VibeProの配布正本はpackage内の `skills/` であり、`vibepro skills install` はこの正本から対象repoへコピーする。
