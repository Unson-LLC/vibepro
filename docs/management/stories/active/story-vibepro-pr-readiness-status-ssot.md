---
story_id: story-vibepro-pr-readiness-status-ssot
title: PR readiness statusをGate DAG overall_statusに一本化する
view: dev
period: 2026-06
source:
  type: github-issue
  id: "#170"
  title: "Gate証跡のfingerprint/lifecycle不整合でPR作成が長時間化する"
architecture_docs:
  reason: 既存のPR Gate DAGとexecution stateの整合性修正であり、新しいrunnerや永続化方式は追加しないため
spec_docs:
  - ../../../specs/vibepro-pr-readiness-status-ssot.md
status: active
created_at: 2026-06-10
updated_at: 2026-06-10
---

# PR readiness statusをGate DAG overall_statusに一本化する

## 背景

VibeProの監査で、`gate_dag.overall_status=needs_verification` なのに `pr_prepare.gate_status.ready_for_pr_create=true` と `execution_state.completion_status=ready_for_pr_create` が共存するartifactが見つかった。

この状態はIssue #170の「Gate証跡の不整合でPR作成が長時間化する」問題を悪化させる。実装者は追加レビューを重ねるべきか、単に証跡を再生成すべきかを判断しづらくなる。

## User Story

**As a** VibeProでPR作成前のGateを確認する実装者
**I want to** `ready_for_pr_create` が常にGate DAGの最終状態から導かれるようにしたい
**So that** `needs_verification` のままPR作成可能に見える矛盾で、不要なレビューや証跡再記録を繰り返さない

## 方針

- PR作成可否の正本は `gate_dag.overall_status === ready_for_review` とする。
- `overall_status !== ready_for_review` の場合、未解決gate詳細が空でも `ready_for_pr_create=false` にする。
- 未解決gate詳細が欠けている場合は、新しいreview roleを増やさず、syntheticな `gate:overall_status` actionで「証跡再生成またはGate DAG status sourceの調査」を促す。
- `execution_gate.pr_create_allowed` も同じ判定に従う。
- `ready_for_review` の場合は既存のready挙動を維持する。

## 受け入れ基準

- [ ] `gate_dag.overall_status=needs_verification` なら、未解決gate詳細が空でも `pr_prepare.gate_status.ready_for_pr_create=false` になる。
- [ ] 同じ条件で `execution_gate.pr_create_allowed=false` になり、`execution_gate.status` は `ready` にならない。
- [ ] 未解決gate詳細が空の矛盾状態では `gate:overall_status` actionが出て、証跡再生成またはGate DAG status source調査を促す。
- [ ] `gate_dag.overall_status=ready_for_review` かつ未解決gateがない場合は、既存どおりPR作成可能になる。
- [ ] 追加のAgent Review roleやreview lifecycle artifactを要求しない。
- [ ] `npm run typecheck` と関連する `node --test` が通る。
