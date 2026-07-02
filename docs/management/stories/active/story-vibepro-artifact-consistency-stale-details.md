---
story_id: story-vibepro-artifact-consistency-stale-details
title: Artifact Consistency Gateでstale artifactの原因と復旧手順を出す
status: active
parent_design: vibepro-artifact-consistency-stale-details
reason: "Existing Artifact Consistency Gate public_contract change only; alternatives considered were a separate ADR or a new artifact type, rejected because compatibility impact stays inside existing CLI/JSON contract extension; rollback plan is revert this commit and rerun pr prepare; boundary scope is src/pr-manager.js plus generated review artifact text with no runtime side effect; accepted followups are none and non-blocking."
source:
  type: github_issue
  id: "271"
architecture_docs:
  - docs/architecture/vibepro-artifact-consistency-stale-details.md
spec_docs:
  - docs/specs/vibepro-artifact-consistency-stale-details.md
---

# Story

Artifact Consistency Gateがstale evidenceを検出した時、現状は「何かが古い」ことは分かるが、どのartifactをどの順に復旧すればよいかがPR準備結果だけでは読み取りにくい。

VibeProはPR作成前の判断ブリーフとして、stale artifactごとの原因、影響、再実行すべきVibeProコマンドを機械可読・人間可読の両方で提示する。

## Acceptance Criteria

- `gate:artifact_consistency` がstale artifactごとにartifact path、artifact type、stale reason、root cause、blocking status、remediation commandを出す。
- verification evidenceとagent review resultが混在してstaleになっても、それぞれの復旧コマンドが区別される。
- `gate_status.critical_unresolved_gates` とexecution gate actionからも、どのartifactを復旧すべきか追える。
- `pr prepare` の人間向けサマリに、stale artifactの短い一覧と復旧コマンドが表示される。
- 既存の `inconsistent_artifacts` 互換フィールドは維持する。
- 新規詳細フィールドはadditiveで、既存JSON consumerの読み取り契約を壊さない。

## Non-goals

- Agent Reviewの最小再dispatch計画そのものは、このStoryでは実装しない。
- stale evidenceを自動で再実行しない。
