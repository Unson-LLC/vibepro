---
story_id: story-vibepro-codex-instructions
title: VibeProをCodexでも正しい手順で使えるようにする
status: active
view: dev
period: 2026-W19
architecture_ref: docs/architecture/vibepro-codex-instructions-architecture.md
spec_ref: docs/specs/vibepro-codex-instructions-spec.md
---

# Story: VibePro Codex Instructions

## 背景

VibePro Skills PackはClaude向けには `.claude/skills/` として導入できる。一方でCodexは `SKILL.md` を自動参照する前提ではないため、VibeProの100%性能に必要なStory -> Architecture -> Spec、Graphify、Gate、HTML cockpitの判断基準が抜ける可能性がある。

この差は、診断パッケージとperformance evidence frameworkでさらに大きくなる。Codexが `SKILL.md` を読まない環境でも、`vibepro check ...` と `vibepro performance ...` の判断基準が `AGENTS.md` のVibePro管理ブロックから読める必要がある。

## ユーザー価値

VibeProをCodexと使う開発者として、対象リポジトリの `AGENTS.md` にVibeProの運用ルールを導入し、Codexがリポジトリ固有指示と矛盾なくVibeProを使えるようにしたい。

## 受け入れ基準

- [ ] VibePro packageにCodex向けAGENTSテンプレートを同梱できる
- [ ] `vibepro codex install <repo>` で対象repoの `AGENTS.md` に管理ブロックを追加できる
- [ ] 既存 `AGENTS.md` は壊さず、VibePro管理ブロックだけを追加・更新できる
- [ ] `--dry-run` と `--force` で導入予定確認と明示更新ができる
- [ ] `vibepro codex verify <repo>` で未導入・差分あり・導入済みを判定できる
- [ ] Codex向けAGENTSテンプレートに `vibepro check` の診断パッケージ導線が含まれる
- [ ] Codex向けAGENTSテンプレートに `vibepro performance define/record/compare` とユーザー体感/サーバー内部を分けるルールが含まれる
- [ ] READMEとhelpからCodex向け導線が分かる
