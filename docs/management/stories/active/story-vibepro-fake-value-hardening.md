---
story_id: story-vibepro-fake-value-hardening
title: "VibePro fake-value hardening"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-15-FAKE-VALUE
  title: "green gates can hide missing evidence and unreconstructable review handoffs"
related_stories:
  - story-vibepro-senior-judgment-multi-axis-dag
  - story-vibepro-review-judgment-delta-handoff
  - story-vibepro-review-inspection-required-gate
architecture_docs:
  - docs/architecture/vibepro-fake-value-hardening.md
spec_docs:
  - docs/specs/vibepro-fake-value-hardening.md
status: active
created_at: 2026-06-15
updated_at: 2026-06-15
---

# VibePro fake-value hardening

## User Story

**As a** VibeProでPR readinessを判断するengineer  
**I want to** missing evidenceを持つ条件付き通過と再構成不能なagent reviewを、ただのgreen gateとして見せない  
**So that** テスト通過や形式上のreviewではなく、senior engineerが次に見るべき未解決リスクを信頼できる

## 背景

価値監査では、Engineering Judgment axisがmissing evidenceを持ったままaccepted waiverで`passed`表示になり、cockpitやPR bodyでは通常通過と区別しづらいことが分かった。またAgent Reviewは`agent_id`だけで強いprovenance扱いになり得るため、別engineer/agentが「どのsubagent実行を見ればよいか」を再構成できない。

VibeProはhuman review必須化ではなく、エージェントループを維持したまま、gate表示とagent handoff artifactの最低要件を上げる必要がある。

## Scope

- Engineering Judgment axisの`active_accepted_followup`をGate DAG上で`passed`に潰さない
- accepted follow-upとして使うdecision recordには、現在安全性の理由とartifact linkを必須にする
- Codex/Claude Code subagent reviewの強いprovenanceは、agent idだけでなくthread/session/call idまたはtranscript artifactを必要にする
- `gate_evidence` passはinspection summaryだけでなく、inspection inputsとjudgment deltaを必須にする

## Acceptance Criteria

- [ ] active axisにmissing evidenceが残る場合、Gate DAG node statusは`passed`ではなく`accepted_followup`または`needs_evidence`になる
- [ ] `accepted_followup`はPR readinessを止めないが、Gate DAG/PR artifact上で通常の`passed`と区別できる
- [ ] axis waiver decisionにartifact linkまたはcurrent-safety artifactがない場合、missing evidenceは`active_needs_evidence`のまま残る
- [ ] Codex/Claude Code subagent reviewは`agent_id`だけではverifiedにならず、thread/session/call idまたはtranscript artifactが必要になる
- [ ] required gate evidence reviewの`pass`は、inspection summary、inspection inputs、judgment deltaがない場合に記録時点で拒否される
- [ ] 既存review artifactの読み取り互換性は壊さず、新規pass記録の最低要件だけを厳格化する

## 非目標

- human reviewを必須化すること
- accepted follow-upを全面的にblocking gateへ変えること
- subagent transcriptの内容を自動採点すること
