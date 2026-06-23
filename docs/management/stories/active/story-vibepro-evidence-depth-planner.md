---
story_id: story-vibepro-evidence-depth-planner
title: "証跡生成前にevidence depthを決める"
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-23-DEPTH-PLANNER
  title: "summary depthは定義されたが、pr prepare/review prepare前に巨大artifact生成を止めていない"
related_stories:
  - story-vibepro-evidence-cost-budget
  - story-vibepro-engineering-judgment-activation-precision
  - story-vibepro-pr-route-gate-dag
architecture_docs:
  - docs/architecture/vibepro-evidence-depth-planner.md
spec_docs:
  - docs/specs/vibepro-evidence-depth-planner.md
created_at: 2026-06-23
updated_at: 2026-06-23
---

# Story

VibeProは `summary` / `standard` / `full` のevidence depthを持ち始めたが、
実際のPR flowでは `pr prepare` の時点で巨大なGate DAG HTML、full JSON、review cockpitなどが
生成されている。canonical保存を圧縮しても、生成とLLM読込が同じならtoken/timeは減らない。

VibeProは高価なartifact生成の前にStory、diff、risk surface、既存証跡からdepthを決める必要がある。
低リスクではsummaryから始め、赤信号があるsurfaceだけtargeted fullへ昇格する。

## User Story

**As a** VibeProでPR readinessを作るengineer<br>
**I want to** 高価な証跡を作る前に必要なevidence depthが決まってほしい<br>
**So that** Engineering Judgmentを弱めずに、不要なartifact生成とLLM読込を減らせる

## Scope

- `pr prepare` の最初に `evidence-plan` を作り、生成するartifact種別を決める
- `summary` depthではHTML、full Gate DAG dump、full review lifecycle dump、raw transcript/provider logを生成しない
- `standard` depthではmachine-readable decision indexと必要なgate/review/verification summaryを生成する
- `full` depthはrisk signal、missing/stale evidence、blocking finding、waiver、traceability gap、operator overrideでのみ生成する
- Engineering Judgment gateのリスク検知はsummary depthでも実行し、検知結果をcompact summaryに残す

## Acceptance Criteria

- [ ] `pr prepare` は高価なartifact生成前に `evidence-plan.json` を作り、`evidence_depth` と生成対象を記録する。
- [ ] low-risk storyではdefault depthが `summary` になり、HTML/full dump/raw log系artifactは生成されない。
- [ ] normal product/code変更ではdefault depthが `standard` になり、decision indexとgate summaryは生成される。
- [ ] high-risk surface、missing evidence、accepted waiver、unresolved reference、blocking/needs_changes finding、traceability gapは該当surfaceだけ `full` または targeted full へ昇格する。
- [ ] `--evidence-depth full` のようなoperator overrideは、manual requestとして理由とconsumerを記録する。
- [ ] summary depthでもEngineering Judgment risk signalsは抑制されず、検知されたriskはdecision indexに残る。
- [ ] regression testはsummary時にHTML/full dumpが作られないこと、high-risk時だけtargeted fullが作られることを確認する。

## Non Goals

- Gateそのものを省略してPRを通しやすくすること。
- missing/stale evidenceをpass扱いにすること。
- canonical auditのdiff統計計算。
- 同一PR内のsummary/index再利用キャッシュ。
