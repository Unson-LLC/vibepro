---
story_id: story-vibepro-responsibility-authority-registry
title: 責務ごとの設計SSOTを解決するResponsibility Authority Registryを追加する
view: dev
period: 2026-06
source:
  type: github-issue
  id: "#226"
  title: "Story単位SSOTだけでは横断状態契約のデグレを防げない"
  url: https://github.com/Unson-LLC/vibepro/issues/226
architecture_docs:
  - docs/architecture/vibepro-responsibility-authority-registry.md
spec_docs:
  - docs/specs/vibepro-responsibility-authority-registry.md
status: active
created_at: 2026-06-25
updated_at: 2026-06-25
---

# 責務ごとの設計SSOTを解決するResponsibility Authority Registryを追加する

## 背景

VibeProはStory / Architecture / Spec / Gate DAG / Agent Review / current-head evidenceを使って、AI実装とPR readinessを制御している。この流れはStory単位では有効だが、状態遷移、cleanup/recovery、worker、権限、課金、送信のような横断責務では弱い。

SalesTailor STR-121では、FORMサンプル承認後の本生成待ちタスクが `GenerationTask.PENDING + metadata.awaitingProductionGenerationStart=true` のまま保持されるべきだった。しかし旧cleanup/recovery実装は親Projectの状態だけを見て `Project status is not processable` と判断し、大量のタスクを `CANCELED` にした。後続Storyで局所的なRegression Guardは追加できたが、別Storyや別branchが同じcleanup/state周辺を触った時に、その横断契約を必ず再評価する仕組みはまだない。

必要なのは単なる「全体SSOT設計書」ではない。任意の責務について「今この場面の設計SSOTは何か」「どのContract/Spec/Architectureが正本か」「現在HEADで証跡が有効か」「未登録ならunknownとして扱うべきか」を機械的に答えるRegistryである。

## User Story

**As a** VibeProで横断的な状態・権限・worker契約を壊さずにAI実装を進める開発者  
**I want to** 任意の責務から設計SSOT、所有surface、関連Contract、必要証跡を解決できるようにしたい  
**So that** Story-localなACやRegression Guardだけでは検出できない横断契約のデグレをPR前に止められる

## 方針

- `Responsibility Authority Registry` を追加し、責務IDから設計Authorityを解決する。
- `Domain Contract` はRegistry配下の機械可読Contractとして扱い、状態遷移・cleanup/recovery・worker・権限・課金・送信などの横断不変条件を登録する。
- Story / Architecture / Spec / Policy は引き続き重要な正本だが、横断責務ではRegistryが「どれがprimary authorityか」を指す。
- `pr prepare` は差分のpath / symbol / risk surface / Graphify contextから関連責務を引き当て、該当ContractをGate DAGへ載せる。
- 関連Contractにcurrent-head evidenceがない場合、`ready_for_review` にしない。
- Story/SpecのRegression Guardは自然文で終わらせず、再変更時に参照可能なcontract clauseへ昇格できる。
- Registryに該当責務がない場合は推測で埋めず、`no_registered_authority` / `unknown` としてGateまたはreview findingに出す。

## Acceptance Criteria

- [x] repo内に責務ID、primary authority、supporting docs、owned surfaces、required evidence、fallback policyを持つResponsibility Authority Registryを登録できる。
- [x] 状態遷移やcleanup/recoveryのような横断契約を、Story単位ではなくrepo/domain単位のDomain Contractとして登録できる。
- [x] `pr prepare` が差分に含まれるpath / symbol / risk surfaceから関連責務とDomain Contractを解決し、Gate DAGへ `gate:responsibility_authority` または同等のcontract gateを追加する。
- [x] 関連Contractに対するcurrent-head verification evidenceがない場合、PR readinessは `ready_for_review` にならない。
- [x] Story/SpecのRegression Guardをcontract clause候補として昇格し、再変更時に機械的に参照できる。
- [x] `requirements-ssot` laneが新Storyの文書有無だけでなく、関連する既存Responsibility/Domain Contractとの矛盾または未登録を明示する。
- [x] Registryで解決できない責務は、推測された設計SSOTとして扱わず `unknown` / `no_registered_authority` としてPR artifactに出る。
- [x] docs/README/helpから、Story-local SSOTとResponsibility Authority Registryの役割分担が発見できる。
- [x] テストはSalesTailor STR-121相当の「cleanupが状態契約に触る」fixtureを含み、Contract evidenceなしではGateが通らないことを確認する。

## 実装メモ

- `responsibility-authority.json` と `docs/contracts/vibepro-responsibility-authority.json` で、VibePro自身の Responsibility Authority Gate / Gate DAG orchestration を self-dogfood contract として登録する。
- 初回実装では Story-local Regression Guard を自動でファイルへ書き込むのではなく、Domain Contract clauseとして登録・参照可能な機械可読形へ昇格する。
- 未登録の高リスクsurfaceは primary authority を推測確定せず、`no_registered_authority` として PR artifact / gate に残す。

## Out of Scope

- SalesTailor固有のFORM生成バグをVibePro repo内で修正すること。
- 全責務を初回実装で網羅すること。
- Graphifyを必須依存にすること。
- Markdownの全体設計書だけでPR readinessを満たすこと。
- AIがRegistry未登録の責務を推測でprimary authorityとして確定すること。
