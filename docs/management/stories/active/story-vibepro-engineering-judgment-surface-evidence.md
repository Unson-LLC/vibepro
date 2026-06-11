---
story_id: story-vibepro-engineering-judgment-surface-evidence
title: "Engineering Judgment subcheckをdiff surface別の根拠種別で判定する"
view: dev
period: 2026-06
source:
  type: value-audit
  id: VP-VALUE-AUDIT-2026-06-10-JUDGMENT-SURFACE
  title: "generic test evidenceだけではcurrent_realityとfailure_modesを満たせない"
related_stories:
  - story-vibepro-engineering-judgment-spine-evidence
  - story-vibepro-path-surface-matrix-gate
  - story-vibepro-bdd-scenario-coverage
architecture_docs:
  - ../../../architecture/vibepro-engineering-judgment-surface-evidence.md
spec_docs:
  - ../../../specs/vibepro-engineering-judgment-surface-evidence.md
status: active
created_at: 2026-06-11
updated_at: 2026-06-11
---

# Engineering Judgment subcheckをdiff surface別の根拠種別で判定する

## User Story

**As a** VibeProのEngineering Judgment Gateを信頼してPR判断する開発者  
**I want to** `current_reality` や `failure_modes` がdiff surfaceに合った証跡で満たされるようにしたい  
**So that** genericなテスト通過だけで、runtime/workflow/authなど異なる壊れ方を見たことにしない

## 背景

共通Engineering Judgment spineは、意図・現状・不変条件・境界・failure mode・done evidenceを扱えるようになった。しかし監査では、`current_reality` がgeneric test commandや広いCLI testで満たされる傾向が残っていた。

熟練エンジニアの判断では、変更面によって必要な根拠が違う。runtime changeなら実行pathまたはfocused test、workflow changeならflow replayやscenario clause、auth/network changeなら拒否・権限・境界条件、docs-onlyなら参照先整合性が必要になる。

## Scope

- diff surfaceごとに、Engineering Judgment subcheckが受け入れる証跡種別を定義する
- `current_reality`, `failure_modes`, `done_evidence` を中心に判定を強化する
- PR body / Gate DAG / review cockpitに「どのsurfaceが、どの根拠で満たされたか」を表示する

## 受け入れ基準

- [ ] runtime source変更では、focused test、runtime path evidence、または該当実行pathを含むintegration/e2e evidenceがない限り `current_reality` は `needs_evidence` になる
- [ ] workflow/agent orchestration変更では、flow replay、artifact replay、またはscenario clauseに紐づくE2E evidenceがない限り `done_evidence` は `needs_evidence` になる
- [ ] auth/permission/session/token/network boundary変更では、許可系だけでなく拒否系または境界条件のevidenceがない限り `failure_modes` は `needs_evidence` になる
- [ ] docs/spec/story-only変更では、参照先整合性、Story/Spec ID整合、または影響範囲説明で軽量passできる
- [ ] 各subcheckは `surface`, `required_evidence_kind`, `matched_evidence`, `missing_evidence` を持つ
- [ ] genericな`npm test`や広範なCLI testだけでは、高リスクsurfaceの `current_reality` を単独passにしない
- [ ] PR bodyは「Engineering Judgment: pass」だけでなく、surface別の根拠要約と不足を表示する
- [ ] テストは runtime/workflow/auth/docs-only の代表ケースを含む

## 非目標

- LLMが自由文で十分そうと言っただけでevidence kindを満たすこと
- 全リポジトリに同じsurface分類を固定すること
- 既存のrisk-adaptive Gate DAGを置き換えること
