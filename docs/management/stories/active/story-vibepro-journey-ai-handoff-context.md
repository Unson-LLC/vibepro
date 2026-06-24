---
story_id: story-vibepro-journey-ai-handoff-context
title: "Journey機械集計をAI handoff contextとして扱う"
source:
  type: github_issue
  id: "221"
  title: "Journey should create AI handoff context instead of treating mechanical story aggregation as authoritative"
architecture_docs:
  - ../../../architecture/vibepro-journey-ai-handoff-context.md
spec_docs:
  - ../../../specs/vibepro-journey-ai-handoff-context.md
status: active
view: dev
horizon: week
period: 2026-06
created_at: 2026-06-24
updated_at: 2026-06-24
---

# Story: Journey機械集計をAI handoff contextとして扱う

## User Story

**As a** VibeProでStory群からプロダクトJourneyを判断する開発者
**I want to** 機械的なStory集計をJourney正本ではなくAI handoff contextとして受け取りたい
**So that** Story metadataだけでは再現できないプロダクト意図、loop closure、未確定判断をAIに解釈させ、PRやUI Gateが未確定Journeyを完了扱いしないようにできる

## Background

`vibepro journey derive` は Story / Spec / gate evidence からPatton式の候補Journeyを生成できる。しかしこの出力は、どの業務loopが重要か、どのStoryがcore stepか、何をもってloop closedとするかまでは判断できない。機械集計をそのまま `available` なJourneyとして扱うと、AIまたは人間が解釈すべき問いが隠れる。

## Acceptance Criteria

- [ ] `vibepro journey derive` が生成するJSON/Markdownは `journey_context_pack` として、authoritative Journeyではないことを明示する
- [ ] `vibepro journey handoff <repo>` がAIに渡せるJourney handoff Markdownを出力し、同じ内容を `.vibepro/journey/latest-handoff.md` に保存する
- [ ] `journey status` は curated Journey が存在しない場合 `needs_curated_journey` を返し、機械集計だけで `available` にしない
- [ ] `.vibepro/journeys/<journey-id>.json` の curated Journey が存在する場合、`journey status` とPR contextは curated artifact を区別して表示する
- [ ] PR Journey sectionは `curated`, `handoff_available`, `artifact_kind` を表示し、UI/UX変更で機械集計だけがある場合はJourneyが未確定であることを示す
- [ ] 既存のJourney placement / conflict / walking skeleton evidenceは handoff context 内に残り、AIが解釈できる

## Verification

- `node --test --test-name-pattern 'journey .*handoff|curated Journey|pr prepare embeds latest Journey' test/journey-map.test.js`
- `npm run typecheck`
