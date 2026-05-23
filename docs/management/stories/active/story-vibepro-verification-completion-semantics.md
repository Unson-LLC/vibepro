---
story_id: story-vibepro-verification-completion-semantics
title: verify recordを完了ではなくGate入力証跡として扱う
status: active
source:
  type: local_log_audit
  id: codex-claude-vibepro-gate-audit-2026-05-23
architecture_docs:
  - docs/architecture/vibepro-verification-completion-semantics.md
spec_docs:
  - docs/specs/vibepro-verification-completion-semantics.md
---

# Story

`vibepro verify record` はテストや検証の証跡を保存するだけで、Storyが完了したことを意味しない。

VibeProは、verify evidenceをGate DAGの入力として扱い、完了判定は `pr prepare` / checkpoint / `pr create` に集約する必要がある。

## Acceptance Criteria

- self-dogfood findingが「verify recordだけでは完了不可」と説明する。
- PR body / Gate文言は `pr prepare` と `gate-dag` を完了判定として扱う。
- skillsは `verify record` 後に `pr prepare` を再実行する順序を維持する。

## Tasks

- [x] self-dogfood findingに完了不可の説明を入れる。
- [x] Agent Review後の次アクションを `review status` / `pr prepare` に戻す。
- [x] testsでverify evidenceのみの状態を検出する。
