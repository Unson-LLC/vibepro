---
story_id: story-vibepro-patton-journey-map
title: "Patton式Journey MapをVibeProに組み込む"
source:
  type: user_request
  id: "2026-06-02-codex"
  title: "今の最新のJourneyをPatton式で保持する"
architecture_docs:
  - ../../architecture/vibepro-patton-journey-map.md
spec_docs:
  - ../../specs/vibepro-patton-journey-map.md
status: active
view: dev
horizon: month
period: 2026-06
created_at: 2026-06-02
updated_at: 2026-06-02
---

# Story: Patton式Journey MapをVibeProに組み込む

## User Story

**As a** VibeProで時系列に増えるStory群からAI実装とPR判断を進めるユーザー
**I want to** active Story、Spec、Code evidence、Gate evidenceからPatton式の最新Journey Mapを合成できる
**So that** 今のプロダクト体験、walking skeleton、release slice、体験上の抜けや衝突をStory単位ではなくJourney単位で判断できる

## Background

VibeProは現在、Storyを時系列で追加し、StoryごとにArchitecture、Spec、Verification、Agent Review、PR Evidenceへ接続できる。`story derive` / `story map` はコード、文書、Graphify evidenceからStory候補とcoverageを出せるが、出力の主目的はStory evidenceとPR制御であり、Jeff Patton式の「ユーザー活動の流れを横軸、release sliceを縦軸にした最新Journey」ではない。

そのためStoryが増えるほど、個別Storyの根拠は増える一方で「今の最新のユーザーJourneyは何か」「どのStoryがwalking skeletonを構成しているか」「新しいStoryが既存Journeyを置き換えたのか、追加したのか、衝突しているのか」が見えにくくなる。

VibeProの目的はPatton式ワークショップツールになることではなく、AI駆動開発のPRを安全に進めることである。したがってPatton式は、Story入力の品質、PR分割、workflow-heavy Gate、E2E acceptance coverageを強くするための上流・横断レイヤとして導入する。

## Concept

既存のStoryは差分、判断、実装単位として維持する。Journey Mapはそれらの代替ではなく、active Story群から合成される「現時点の最新ユーザー体験スナップショット」として扱う。

```text
active stories / specs / code evidence / gate evidence
        |
        v
latest Patton-style Journey Map
        |
        v
walking skeleton / release slices / journey conflicts / Gate DAG / split plan
```

## Acceptance Criteria

- [ ] `vibepro journey derive <repo>` は active Story、story-catalog、Spec、Graphify coverage、必要に応じてPR evidenceを読み、`.vibepro/journey/latest-journey.json` と `.vibepro/journey/latest-journey.md` を生成する
- [ ] `latest-journey.json` には `schema_version`, `journey_id`, `generated_at`, `source_story_ids`, `source_digest`, `backbone`, `release_slices`, `walking_skeleton`, `conflicts`, `open_questions` が含まれる
- [ ] `backbone` はPatton式の横軸として、ユーザー活動順の `activity` と `step` を保持し、各stepに関連Story、Spec clause、主要route/API/component、Gate evidenceを紐づける
- [ ] `release_slices` はPatton式の縦軸として、少なくとも `walking_skeleton`, `next_slice`, `hardening` を表現できる
- [ ] Storyの作成・更新時系列は入力根拠として使うが、Journey上の順序は時系列だけで決めず、Story定義、workflow position、route/API遷移、Graphify evidence、明示設定から推定する
- [ ] product/user-facing StoryはJourney stepへ配置され、architecture/security/ops/quality StoryはJourneyを成立させるenablerまたはcross-cutting evidenceとして扱える
- [ ] 同じJourney stepに矛盾する遷移、古いStoryと新しいStoryの置き換え不明、walking skeletonに必要なstep欠落がある場合は `conflicts` または `open_questions` に出る
- [ ] `latest-journey.md` はPatton式に読める形で、横軸にbackbone activity、縦軸にrelease sliceを持つ表を出す
- [ ] `vibepro pr prepare` は workflow-heavy または product journeyに関わる変更で、Journey Mapの有無、walking skeleton影響、未解決journey conflictをGate DAGまたはPR evidenceに表示する
- [ ] Journey Mapが存在しない場合でも既存のStory / Architecture / Spec / Gate workflowは壊れない
- [ ] 回帰テストで、active StoryからJourney JSON/Markdownが生成され、walking skeleton欠落と矛盾が検出できる

## Implementation Notes

- 新規候補:
  - `src/journey-map.js`
  - `src/journey-html.js` またはMarkdownのみで開始
  - `docs/architecture/vibepro-patton-journey-map.md`
  - `docs/specs/vibepro-patton-journey-map.md`
- CLI候補:
  - `vibepro journey derive <repo>`
  - `vibepro journey map <repo>`
  - `vibepro journey status <repo>`
- 出力候補:
  - `.vibepro/journey/latest-journey.json`
  - `.vibepro/journey/latest-journey.md`
  - `.vibepro/journey/history/<timestamp>.json`
- 既存接続候補:
  - `src/story-catalog-generator.js` の `workflowPositionFor` を初期backbone推定に使う
  - `src/pr-manager.js` / Gate DAG生成側で `gate:journey_map` またはJourney evidence summaryを追加する
  - `src/story-candidate-generator.js` の uncovered cluster をJourney未配置候補としても扱う

## タスク

1. Architecture判断を正本化する
   - Journey MapをStoryの代替ではなく、active Story群から合成される最新Journey snapshotとして定義する
   - Story evidence map、Patton-style journey map、Gate DAGの責務境界を明文化する
   - product journeyとarchitecture/security/ops/quality enablerの扱いを決める

2. Spec契約を正本化する
   - `latest-journey.json` のschema、backbone、release_slices、walking_skeleton、conflicts、open_questionsを定義する
   - Story、Spec、Code、Gate evidenceとのtraceabilityを機械検査可能にする
   - Journey Mapの欠落や衝突がPR readinessにどう影響するかを定義する

3. Journey deriveを実装する
   - active Story docs、story-catalog、Spec、Graphify coverageを読み込む
   - Storyごとに `journey_activity`, `journey_step`, `release_slice`, `enabler_kind` を推定する
   - 推定根拠とconfidenceをJSONへ保存する

4. Patton式Markdownを生成する
   - 横軸にbackbone activity、縦軸にrelease sliceを持つ表を出す
   - 各セルにStory ID、状態、主なGate状態、未決事項を表示する
   - Journeyに配置できないStoryを付録に出す

5. PR prepare / Gate DAGへ接続する
   - workflow-heavyまたはproduct-facing変更では、Journey Mapの影響をPR evidenceへ出す
   - walking skeletonに関わるStoryでE2E / network contract / acceptance coverageが不足していれば明示する
   - unresolved journey conflictがある場合、PR分割またはblock判断の材料にする

6. 回帰テストを追加する
   - 複数StoryからJourney Mapが生成されるfixtureを作る
   - walking skeleton欠落、同一stepの遷移衝突、enabler Storyの扱いを検証する
   - 既存の `story map` / `pr prepare` がJourney Mapなしでも後方互換で動くことを確認する
