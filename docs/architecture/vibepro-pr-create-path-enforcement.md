---
story_id: story-vibepro-pr-create-path-enforcement
title: PR Create Path Enforcement Architecture
---

# Architecture

PR作成のhard gateは既存の `vibepro pr create` に置く。追加実装では、docs/skills/agent-instructionsの誘導文をself-dogfoodで監査し、raw `gh pr create` 推奨が混入した場合にfinding化する。

## Decisions

- `gh pr create` 自体を禁止するshell wrapperは作らない。
- VibePro artifactとSkillsで正しい経路を強制する。
- self-dogfoodは否定文やguardrail文をfindingにしない。
