---
story_id: story-vibepro-codex-instructions
title: VibePro Codex Instructions Architecture
story_ref: docs/stories/vibepro-codex-instructions-story.md
spec_ref: docs/specs/vibepro-codex-instructions-spec.md
---

# Architecture: VibePro Codex Instructions

## 方針

Codex向けの100%性能導線は、対象repoの既存 `AGENTS.md` を正本として尊重し、その中にVibePro管理ブロックを追加する。`vibepro init` では自動導入せず、明示的な `vibepro codex install` だけが対象repoを書き換える。

## 責務境界

- `agent-instructions/codex/`
  - npm packageに同梱するCodex向けVibePro運用ルールの正本
  - Codexが `.claude/skills/SKILL.md` を自動参照しない環境でも必要なVibePro判断基準を保持する
- `vibepro codex install`
  - 対象repoの `AGENTS.md` にVibePro管理ブロックを作成・追記・明示更新する
  - 既存のリポジトリ固有指示は保持する
- `vibepro codex verify`
  - 対象repoのVibePro管理ブロックが同梱版と一致するか確認する

## 判断

Claude向けSkills PackとCodex向けAGENTS導線は分離する。両者は同じVibePro operating modelを共有するが、導入先とagentの読み取り方式が異なるため、CLIコマンドも `skills` と `codex` に分ける。

したがって、診断パッケージやperformance evidence frameworkを追加した場合は、Claude向け `skills/` とCodex向け `agent-instructions/codex/AGENTS.vibepro.md` の両方を更新対象にする。
