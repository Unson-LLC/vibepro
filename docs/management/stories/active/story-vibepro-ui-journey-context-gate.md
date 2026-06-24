---
story_id: story-vibepro-ui-journey-context-gate
title: "UI変更時にJourney Context Gateを必須化する"
source:
  type: user_request
  id: "2026-06-24-codex"
  title: "UI周りを触る時にはJourneyを確認するのは絶対に必要"
architecture_docs:
  - ../../../architecture/vibepro-ui-journey-context-gate.md
spec_docs:
  - ../../../specs/vibepro-ui-journey-context-gate.md
status: active
view: dev
horizon: week
period: 2026-06
created_at: 2026-06-24
updated_at: 2026-06-24
---

# Story: UI変更時にJourney Context Gateを必須化する

## User Story

**As a** VibeProでUI変更をPRにする開発者
**I want to** UI変更時に最新Journey上の対象step、衝突、未解決事項をGate DAGで必ず確認したい
**So that** 見た目だけ通った変更が、ユーザー導線やCTA優先度を壊したままPR化されることを防げる

## Background

VibeProはJourney MapをPR本文に表示できるが、現状ではUI変更時の必須Gateではない。UI変更では画面部品、CTA、空/error/loading状態、フォーカス、ナビゲーションが変わり得るため、Journey contextを見ずにVisual QAやE2Eだけで判断すると、前後stepや既存導線との衝突を見落とす。

## Acceptance Criteria

- [ ] UI experience source changeでは `gate:journey_context` がGate DAGに出る
- [ ] Journey Map未生成のUI変更は `gate:journey_context:needs_evidence` としてPR readinessを止める
- [ ] current StoryがJourney stepに配置済みで、対象stepに衝突やblocking open questionがなければGateは `passed` になる
- [ ] 対象stepにJourney conflictまたはblocking open questionがあればGateは未解決になる
- [ ] 非UI変更にはJourney Context Gateを出さない
- [ ] Gateは `gate:path_surface_matrix` から `gate:requirement` へ向かうDAG経路上に接続され、孤立ノードにならない

## Verification

- `node --test test/journey-map.test.js`
- `npm run typecheck`
