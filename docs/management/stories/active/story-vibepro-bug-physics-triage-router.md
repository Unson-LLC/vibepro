---
story_id: story-vibepro-bug-physics-triage-router
title: Bug physics triage router must select gate profiles
status: active
related_issue: https://github.com/Unson-LLC/vibepro/issues/131
architecture_docs:
  - ../../../architecture/vibepro-bug-physics-triage-router.md
specs:
  - ../../../specs/vibepro-bug-physics-triage-router.md
---

# Bug physics triage router

## 背景

VibeProのGate DAGは、Storyや差分のリスクに応じてPR前の証跡を増やしてきた。しかし、実際のbugには「同じ症状に見えても検証物理が違う」ものがある。race condition、illegal state、terminal byte sequence、observability欠落、deployment artifact不一致は、同じE2E greenではfixedを意味しない。

そのため、DAGの前段にbug physics triageを置き、分類結果が下流gate profileを実際に選ぶ必要がある。分類は飾りではなく、required gateとtyped N/A gateを変える。

## 方針

- triage outputは固定enumのmulti-label `class[]`: `timing`, `state-invariant`, `deterministic-byte`, `observability`, `deployment`。
- triageは推測だけで通さない。`phase-decomposition`, `violation-rate`, `real-byte fixture`, `authoritative signal`, `version-stamp` などのprobe evidenceを要求する。
- classごとにrequired gateを追加する。
- 意味のないgateはwaiveではなく、typed N/A with reasonとしてDAGに残す。
- selected harnessがbugを再現できない場合はmisclassificationとしてtriageへ戻るfeedback edgeをDAGに出す。

## 受け入れ基準

- [ ] Gate DAGに `gate:bug_physics_triage` が出る
- [ ] triage outputが固定enum `class[]` のmulti-labelになる
- [ ] classが変わるとrequired gate profileが変わる
- [ ] typed N/A with reasonがwaiveと別のgate outcomeとしてDAGに出る
- [ ] triage entry conditionとしてprobe evidenceがないbug storyはPR readinessを止める
- [ ] contradiction feedback edgeがselected harness failureからtriageへ戻る
- [ ] deploymentまたはobservability storyで、code/E2E gateがtyped N/Aとしてbypassされる
