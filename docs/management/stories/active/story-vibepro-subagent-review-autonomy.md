---
story_id: story-vibepro-subagent-review-autonomy
title: Agent Review Gateをユーザー許可待ちではなく自律レビュー指示にする
status: active
source:
  type: local_log_audit
  id: codex-claude-vibepro-gate-audit-2026-05-23
architecture_docs:
  - docs/architecture/vibepro-subagent-review-autonomy.md
spec_docs:
  - docs/specs/vibepro-subagent-review-autonomy.md
---

# Story

Agent Review Gateが出た時に、AIが「サブエージェントを実行してよいか」とユーザーに聞いて止まるケースがあった。

VibeProはrunnerではないが、Gate出力とSkillsは「runtimeにサブエージェント能力があるなら自然に並列レビューを実行し、結果を記録する」指示として読める必要がある。
また、レビューに使ったサブエージェントを開きっぱなしにすると thread limit や古い文脈混入の原因になるため、VibeProのレビュー契約は「結果を受け取ったら記録前にclose/shutdownし、close済みとしてrecordする」ことまで含める必要がある。

## Acceptance Criteria

- `review prepare` の出力が permission wait を示唆しない。
- `gate:agent_review` の required actions が parallel subagent dispatchを明示する。
- `review prepare` の出力が、結果を受け取った後、記録前にレビュー用subagentをclose/shutdownすることを明示する。
- required Agent Review Gateのpassには、parallel subagent provenanceに加えて `--agent-closed` lifecycle証跡が必要になる。
- manual reviewは監査メモとして扱い、required Agent Review Gateのpass代替にしない。
- Codex / Claude Code のインストール指示も同じ方針になる。

## Tasks

- [x] `agent-review` のdispatch contractを更新する。
- [x] `pr-manager` のAgent Review Gate文言を更新する。
- [x] skills / Codex instructionsを更新する。
- [x] manual_reviewをGate pass代替から外す。
- [x] review recordにsubagent close済みlifecycle証跡を追加する。
- [x] unit testを更新する。
