---
story_id: story-vibepro-skills-pack
title: VibeProが100%性能を発揮するためのSkills Packを配布する
status: active
view: dev
period: 2026-W19
architecture_ref: docs/architecture/vibepro-skills-pack-architecture.md
spec_ref: docs/specs/vibepro-skills-pack-spec.md
---

# Story: VibePro Skills Pack

## 背景

VibePro CLIは単体でも診断、Graphify連携、PR準備、レビューCockpitを生成できる。一方で、AI agentがVibeProの意図通りに動くには、Story -> Architecture -> Spec の順序、Graphifyの使いどころ、Gate未解決時の判断、`human-review.json` の扱いを毎回正しく思い出す必要がある。

## ユーザー価値

VibeProをAI agentと使う開発者として、対象リポジトリにVibePro専用Skillを任意導入し、agentが正しい順序と判断基準でVibePro成果物を使えるようにしたい。

## 受け入れ基準

- [ ] VibePro packageに専用Skillを同梱できる
- [ ] `vibepro skills list` で同梱Skillを確認できる
- [ ] `vibepro skills install <repo>` で対象repoの `.claude/skills/` に導入できる
- [ ] 既存Skillは既定で上書きせず、`--force` で明示上書きできる
- [ ] `vibepro skills verify <repo>` で導入状態を確認できる
- [ ] READMEとhelpから100%性能時の導線が分かる
