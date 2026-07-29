---
story_id: story-vibepro-routing-profiles-rendered-projections
title: Story別routing profileとlineage付きprojectionでfeature packetを正本化する
parent_design: vibepro-artifact-output-routing
artifact_profile: feature_packet
feature_slug: routing-profiles-rendered-projections
view: dev
period: 2026-07
source:
  type: github-issue
  id: "359"
  url: https://github.com/Unson-LLC/vibepro/issues/359
architecture_docs:
  - ../../../architecture/story-vibepro-routing-profiles-rendered-projections.md
spec_docs:
  - ../../../features/routing-profiles-rendered-projections/02_functional_spec.md
status: active
created_at: 2026-07-21
updated_at: 2026-07-21
reason: "CLIごとのprofile引数ではproducerとconsumerのroutingが再び乖離するため、Story catalogにprofileとfeature_slugを永続化し共通resolverで解決する。既存repository-global artifacts設定はdefault profile相当として後方互換を維持し、schemaを戻せばrollbackできる。境界は永続artifactのrouting、projection rendering、ownership、migrationであり、UI/UX判断の自動生成や複数editable SSOTは対象外とする。"
---

# Story別routing profileとlineage付きprojectionでfeature packetを正本化する

## 背景

#341でrepository-levelのartifact path templateとgenerated projectionを導入したが、全Storyが同じrouting設定を使い、projectionはcanonical contentのbyte copyに限られる。feature lifecycleとcross-cutting governanceで異なる配置契約を持つrepositoryでは、Storyごとにprofileを選べず、人間向けMarkdownを別途手管理する必要がある。

## User Story

**As a** 独自のfeature packetとgovernance領域を持つrepositoryの開発者
**I want to** Story metadataでrouting profileを選び、machine canonicalからlineage付きhuman viewを再生成したい
**So that** 一つのdirectoryから実装・テスト・review・releaseを理解でき、editable SSOTを重複させない

## 方針

- `.vibepro/config.json`に複数のnamed routing profileを定義し、既存`artifact_routing.artifacts`は後方互換なdefaultとして扱う。
- `.vibepro/config.json`の`brainbase.stories[]`を`artifact_profile`と`feature_slug`のauthorityとする。named profileを選ぶStoryではStory frontmatterを必須mirrorとし、不在または不一致なら共通resolverは書込前にfail closedする。profile metadataを持たないlegacy/unconfigured Storyではmirrorを任意とする。
- projectionは`renderer`と`ownership`を持ち、generated viewにsource path、SHA-256、renderer/schema version、direct-edit prohibitionを埋め込む。
- `human_owned`はVibeProが上書きせず、`curated`は自動上書き対象外として明示的な運用境界を返す。
- migration dry-runはprofile変更、move/collision、stale projection、human-owned overwrite riskをread-onlyで報告する。
- taskのmachine authorityは現行`.vibepro/stories/{story_id}/tasks/tasks.json`を維持し、Tasks Markdownは決定論的なgenerated projectionとする。
- `artifact_routing` schema `0.2.0`でnamed profileとownership/renderer contractを導入し、新CLIは`0.1.0`をlegacy defaultとして互換解決する。旧CLIは`0.2.0`をunsupported schemaとしてsilent fallbackせず停止する。

## 受け入れ基準

- [ ] AC-1: repositoryが二つ以上のnamed artifact-routing profileを定義できる
- [ ] AC-2: 各Storyが`artifact_profile`と明示的`feature_slug`を永続的に選択できる
- [ ] AC-3: Story discovery、Architecture、Spec、Task、Graphify、Review、Gate、PR prepare/create/merge、status、migrationが同じprofileを解決する
- [ ] AC-4: profile未定義、必須変数不足、相互矛盾するmetadataは書込前にfail closedする
- [ ] AC-5: Accepted Spec JSONを決定論的なFunctional Spec Markdownへrenderできる
- [ ] AC-6: machine task modelを決定論的なTasks Markdownへrenderできる
- [ ] AC-7: Evidence/Test PlanとGate/Release viewが`generated`、`curated`、`human_owned`のownershipを明示する
- [ ] AC-8: generated projectionがsource path、source hash、renderer version、direct-edit prohibitionを含む
- [ ] AC-9: VibeProがhuman-owned packet fileを上書きしない
- [ ] AC-10: semantic artifactごとにwritable canonicalは一つだけでprojectionはread authorityにならない
- [ ] AC-11: `artifacts resolve`がprofile、variables、canonical、projection、ownership、rendererを報告する
- [ ] AC-12: `artifacts migrate --dry-run`がprofile変更、move、collision、stale projection、human-owned overwrite riskを編集せず報告する
- [ ] AC-13: feature profileとgovernance profileをfresh checkout E2Eで検証する
- [ ] AC-14: profile未設定repositoryと既存`artifact_routing.artifacts`設定の後方互換を維持する

## 非目標

- accepted sourceなしでproductまたはUI/UX判断を生成すること
- feature packetの全ファイルをmachine-ownedにすること
- Story、Architecture、Spec、task modelのeditable copyを複数許可すること
