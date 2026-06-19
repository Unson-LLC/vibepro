---
story_id: story-vibepro-canonical-audit-bundle-replay
title: Canonical audit bundleをmain checkoutで再生可能にする
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-19-CANONICAL-REPLAY
related_stories:
  - story-vibepro-canonical-audit-artifacts
architecture_docs:
  - docs/architecture/vibepro-canonical-audit-bundle-replay.md
spec_docs:
  - docs/specs/vibepro-canonical-audit-bundle-replay.md
---

# Story

VibeProの `story-vibepro-canonical-audit-artifacts` は、merge後に監査コアJSONを
`docs/management/audit-artifacts/<story-id>/` へ昇格する設計を持っている。

しかし2026-06-19の価値監査では、最新main checkoutに
`docs/management/audit-artifacts/` が存在せず、`vibepro usage report . --subagent-roi --json`
の `artifact_counts.canonical_audit` は `0` だった。これでは、設計上の価値はあっても
別engineer/agentがmain checkoutだけでStory-to-PR-to-merge判断を再構成できない。

VibeProは、merge成功後のcanonical audit bundleを、実際にmain checkoutで読み直せる
tracked artifactとして残し、fresh checkoutでも同じ監査経路を再生できる必要がある。

## Acceptance Criteria

- 成功した `vibepro execute merge` 後に、対象storyの
  `docs/management/audit-artifacts/<story-id>/audit-bundle.json` が作られる。
- `audit-bundle.json` は `pr-prepare.json`、`pr-create.json`、`gate-dag.json`、
  `verification-evidence.json`、`traceability.json`、`pr-merge.json` のコピー結果を列挙する。
- review artifact が存在する場合、`review-summary.json`、`review-result-*.json`、
  `lifecycle.json` のコピー結果も列挙する。
- fresh checkoutで `.vibepro/pr/<story-id>` が無くても、canonical bundleだけから
  merged storyのPR URL、merge commit、verification evidence、review summaryを再構成できる。
- `usage report` の `artifact_counts.canonical_audit` がcanonical bundleを検出し、
  対象storyを `traceability_missing_pr_artifact` として扱わない。
- bundleにはHTML、raw transcript、一時dispatch scratch、途中状態を含めない。

## Non Goals

- `.vibepro/` 全体をtrackedにすること。
- すべての過去storyをこのStory内でbackfillすること。
- raw provider logやsubagent transcriptをcanonical bundleに保存すること。
