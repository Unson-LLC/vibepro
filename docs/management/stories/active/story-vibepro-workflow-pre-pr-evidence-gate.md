---
story_id: story-vibepro-workflow-pre-pr-evidence-gate
title: workflow-heavy PR gateのpre-PR evidence loopを解消する
status: active
view: dev
period: 2026-06
source:
  type: github_issue
  id: "202"
  url: https://github.com/Unson-LLC/vibepro/issues/202
architecture_docs:
  - docs/architecture/vibepro-workflow-pre-pr-evidence-gate.md
spec_docs:
  - docs/specs/vibepro-workflow-pre-pr-evidence-gate.md
---

# Story

workflow-heavy storyでは、VibeProがPR作成前にhosted preview由来の証跡を要求すると、通常のPR preview生成フローと循環し、PR作成そのものが止まる。

VibeProはpre-PRで必要なworkflow replay evidenceと、PR作成後のpreview smoke evidenceを分けて扱う必要がある。pre-PRでは current Flow Verification、または明示的にflow replayを記録したcurrent E2E evidenceでGateを閉じられるべきである。

## Acceptance Criteria

- `preview:preview_smoke` をPR作成前の必須reviewにしない。
- UI変更ではPR作成前に `preview:human_usability` を維持し、hosted preview smokeはPR作成後の証跡として扱う。
- current E2E evidenceが `flow_replay` と `scenario_clause_e2e` のobservationを明示している場合、Workflow Flow Replay Gateはpassできる。
- Flow Verificationがzero-probeの場合、Gate DAGに `flow_design.runtime_probes[]` 登録導線を出す。
- zero-probe Flow Verificationはpass扱いにしない。
- Basic Auth付きのFlow Verificationでも、credential値は証跡に保存せず、`basic_auth_env` の変数名だけを記録する。

## Non Goals

- preview smokeそのものを不要にすること。
- VibePro CLIがhosted previewを自動作成すること。
- marker-only E2Eをworkflow replay evidenceとして認めること。
