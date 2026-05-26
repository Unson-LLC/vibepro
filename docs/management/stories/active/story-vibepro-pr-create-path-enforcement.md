---
story_id: story-vibepro-pr-create-path-enforcement
title: PR作成をraw ghではなくVibePro経由に寄せる
status: active
source:
  type: local_log_audit
  id: codex-claude-vibepro-gate-audit-2026-05-23
architecture_docs:
  - docs/architecture/vibepro-pr-create-path-enforcement.md
spec_docs:
  - docs/specs/vibepro-pr-create-path-enforcement.md
---

# Story

Claude Codeログでは、`vibepro pr prepare` で `needs_verification` が出ていても、raw `gh pr create` に進むケースがあった。

VibeProはPR作成経路の指示と診断で、raw `gh pr create` がGateを迂回することを明示し、`vibepro pr create` を標準経路にする必要がある。

## Acceptance Criteria

- Skills / agent instructions は `vibepro pr create` を標準経路として明示する。
- raw `gh pr create` を推奨する文言をself-dogfoodで検出できる。
- 否定文の「raw gh pr createを使わない」はfalse positiveにしない。
- GitHub上の既存PR本文がVibePro形式でない場合、self-dogfoodがblocking findingにする。
- GitHub PRに対応する `.vibepro/pr/<story-id>/pr-create.json` がない場合、self-dogfoodがblocking findingにする。

## Tasks

- [x] self-dogfood scannerにinstruction bypass language検出を追加する。
- [x] 否定文をfalse positiveにしない。
- [x] skills / agent instructionsのPR作成方針を維持する。
- [x] GitHub PR本文とVibePro PR作成証跡の対応をself-dogfoodで監査する。
