---
story_id: story-vibepro-native-design-system
title: VibePro-native Design System artifacts from existing product evidence
status: active
architecture_docs:
  reason: Existing design-modernize evidence extraction and Graphify import boundaries are reused; no new external runner, storage service, or implementation authority is introduced.
specs:
  - ../../../specs/vibepro-native-design-system.md
---

# VibePro-native Design System

## 背景

VibeProの `design-modernize derive-system` はStory単位でDerived Design Systemを作れるが、既存プロダクトのDSそのものを `.vibepro/design-system/<ds-id>/` に正本化する機能がない。

既存システムでは、Graphify evidence、route code、CSS/token files、現在のCTA/state/data dependencyから、先にDesign Systemの判断空間を作る必要がある。そのDSを画面別modernize、実装spec、DS drift gateが参照する。

## 方針

- `vibepro design-system derive <repo> --id <ds-id>` を追加する。
- 既存route、component、state、CTA、data dependency、navigation、style/token evidence、任意のGraphify artifactからVibePro-native DSを導出する。
- 成果物は `.vibepro/design-system/<ds-id>/` に保存する。
- 外部生成候補は実装正本ではなく、VibePro-native DS、現行コード、Graphify evidence、Gate DAGを正本にする。

## 受け入れ基準

- [ ] `vibepro design-system derive <repo> --id <ds-id> --from-code` が `design-system.json` と分解artifactを作る
- [ ] artifactに product semantics、theme tokens、semantic tokens、component roles、component states、screen patterns、CTA policy、density/navigation policy、anti-patterns、implementation mapping、evidence coverage、DS gate が含まれる
- [ ] 既存のroute codeとstyle/token filesから証跡を集め、Graphify artifactがある場合はsource evidenceに反映する
- [ ] DS gateは明示的で、fallbackを許可しない
- [ ] `design-modernize` の既存挙動を壊さない
- [ ] 新規コード・docs・PR文面に特定外部生成サービス名を残さない
- [ ] `npm test` と `npm run typecheck` が通る
