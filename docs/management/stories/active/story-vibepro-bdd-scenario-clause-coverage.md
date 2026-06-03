---
story_id: story-vibepro-bdd-scenario-clause-coverage
title: BDDをVibeProのscenario clauseと受け入れカバレッジとして組み込む
view: dev
period: 2026-06
architecture_docs:
  - ../../../architecture/vibepro-bdd-scenario-clause-coverage.md
spec_docs:
  - ../../../specs/vibepro-bdd-scenario-clause-coverage.md
status: active
created_at: 2026-06-03
updated_at: 2026-06-03
---

# BDDをVibeProのscenario clauseと受け入れカバレッジとして組み込む

## 背景

VibeProのコア価値は、AI駆動開発でStoryからPRまでの最後の詰めを曖昧にせず、要求、設計、実装、検証、レビュー証跡をつないで、必要なGateが揃うまでPR作成を止めることである。

現状でもVibeProは `invariant`、`scenario`、`contract`、`sla` のSpec clauseを持ち、StoryのAcceptance CriteriaとE2E証跡をGateに接続できる。一方で、Storyの受け入れ基準やIA/Architectureから、具体的な「Given / When / Then 相当の振る舞い」に落とす導線はまだ明示的ではない。

そのため、IA設計書やArchitectureが存在していても、ユーザー状態、操作、例外、失敗時、権限境界、複数画面をまたぐ導線がSpec/TestCodeへ十分に投影されない場合がある。結果として、AIエージェントは実装対象の構造を理解できても、どの振る舞いを満たせば完了なのかを曖昧にしたままCodeへ進めてしまう。

BDDをVibeProに組み込む目的は、CucumberやGherkinを中心にした別プロセスを追加することではない。BDDの有用な部分である「具体的な利用者状態、操作、期待結果」を、VibeProの `scenario` clause、TestCode、Gate evidenceへ接続することである。

## 方針

- BDDを独立フェーズとして追加せず、Specの `scenario` clause強化として扱う。
- StoryのAcceptance CriteriaとArchitectureのIA / flow / state / boundaryから、Given / When / Then 相当のscenario候補を生成する。
- 生成されたscenarioは人間が手書きする長文仕様書ではなく、AIが整合性検査に使う機械検証可能なSpec clauseとして保存する。
- TestCodeはscenario clause IDまたはAcceptance Criteria IDを明示し、PR GateがSpec/Test coverageの不足を検出できるようにする。
- workflow-heavy、認証、決済、権限、状態遷移、非同期処理、複数surfaceをまたぐ変更ではscenario coverageを必須にする。
- docs-only、軽微なcopy修正、単一の静的UI変更では過剰にBDD scenarioを要求しない。
- 外部BDD runnerやCucumber導入はこのStoryの範囲外とし、既存のUnit / Integration / E2E / Flow Verification evidenceに接続する。

## User Story

**As a** VibeProでAIエージェントに実装を渡す開発者
**I want to** StoryとArchitectureから具体的な振る舞いscenarioをSpecとTestCodeに接続したい
**So that** IAや設計の存在だけでは見逃されるユーザー状態、操作、失敗時、権限境界、複数画面導線をPR Gateで検査できる

## 受け入れ基準

- [x] `vibepro spec fingerprint --include-instructions` の入力文脈に、Story Acceptance CriteriaとArchitecture由来のflow / state / boundary情報からscenario clauseを生成する指示が含まれる
- [x] AIが生成するSpecでは、BDD相当の振る舞いは `type: "scenario"` clauseとして表現され、statementには利用者状態、操作、期待結果が1つずつ明確に含まれる
- [x] `scenario` clauseは少なくとも1つの `origin.story_refs[]` またはArchitecture由来の根拠を持ち、根拠なしの想像scenarioは `open_questions[]` に落ちる
- [x] TestCode内で `S-<n>`、`AC-<n>`、またはAcceptance Criteria本文によってscenario / acceptance coverageを明示できる
- [x] `pr prepare` のGate DAGは、workflow-heavy変更でscenario clauseが存在しない場合、release readyにせず不足理由を表示する
- [x] `pr prepare` のGate DAGは、scenario clauseがあるが対応するTestCodeまたはcurrent verification evidenceがない場合、該当scenarioをmissing coverageとして表示する
- [x] light/docs-only変更ではscenario coverage Gateをcritical化せず、過剰にworkflow-heavy扱いしない
- [x] READMEまたはspec authoring instructionsに、BDDは外部BDD runner導入ではなくVibeProのscenario clause / acceptance coverageとして扱うことが明記される
- [x] 既存の `node --test` が通る

## Implementation Notes

- 対象候補:
  - `src/spec-prompt-template.md`
  - `src/spec-schema.json`
  - `src/spec-validator.js`
  - `src/spec-drift.js`
  - `src/pr-manager.js` またはGate DAG生成箇所
  - `test/spec-pipeline.test.js`
  - `test/e2e/*acceptance*.test.js`
- `scenario` clauseの文面は自由なGherkin本文にせず、既存schemaに収まる1文のmachine-checkable statementを維持する。
- Given / When / Thenは保存形式の必須フィールドにせず、statementまたはrationaleの生成規約として扱う。schema拡張が必要な場合も後方互換を優先する。
- scenario coverageの検出は、既存のAcceptance Criteria coverage検出と同じ思想で、`S-1`、`scenario:1`、`AC-1`、`acceptance:1`、本文一致を候補にする。
- workflow-heavy判定は既存のRisk-adaptive Gate DAGと連携し、BDD導入だけで全PRを重くしない。

## 非目標

- Cucumber、Gherkin、SpecFlowなどのBDD runnerを必須依存として追加すること
- 人間が長文のBDD仕様書を手で保守する運用にすること
- Story、Architecture、Specとは別にBDDフェーズを増やすこと
- すべての変更にE2E scenarioを義務化すること
