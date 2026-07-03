---
story_id: story-vibepro-story-journey-diagnose
title: Story診断でJourney未整理を見落とさない
view: dev
period: 2026-07
spec_docs:
  - ../../../specs/story-vibepro-story-journey-diagnose.md
status: active
created_at: 2026-07-03
updated_at: 2026-07-03
reason: "alternatives considered: new ADR, broader PR Gate DAG Journey enforcement, or additive Story diagnosis output; selected additive Story output. compatibility impact: CLI/Markdown/HTML output gains journey_context without removing existing fields, commands, schema defaults, or PR Gate contracts. rollback plan: revert src/story-manager.js, src/story-html.js, test/vibepro-cli.test.js, this Story, the spec, and design-ssot links in one commit. boundary and scope: Story status/report/diagnose reads existing Journey status only; Journey curation authority remains in journey-map.js and PR Gate DAG remains in pr-manager. accepted followups: none for this PR."
---

# Story診断でJourney未整理を見落とさない

## 背景

UI/Journeyに関係するStoryは、Story作成直後や`story diagnose`の時点でJourneyが未作成か、機械生成のcontext packだけか、curated Journeyまで整っているかを区別できる必要がある。

現状はPR Gate DAGではUI source changeに対して`gate:journey_context`が効くが、docs-onlyのUI StoryやStory診断段階ではJourney不足が見えにくい。そのため、実装前のStory運用でJourney作成・handoff・curated Journey作成の次アクションに進みにくい。

## 受け入れ基準

- [ ] UI/Journeyに関係するStoryでは、`story diagnose`とStory report/statusにJourney状態が出る
- [ ] Journey未作成は`missing`として表示し、次アクションに`vibepro journey derive .`、`vibepro journey handoff .`、curated Journey作成を出す
- [ ] 機械生成の`journey_context_pack`とcurated Journeyを区別して表示する
- [ ] backend/docs/opsなどJourney非対象Storyでは`not_required`となり、Journey作成の摩擦を出さない
- [ ] 既存のPR Gate DAG挙動は維持し、`gate:journey_context`はUI source changeだけで必須になる
- [ ] テストでmissing、machine-derived、curated、non-Journeyの各状態を固定する
