---
story_id: story-vibepro-derived-design-system
title: VibeProで既存UI改善用のDerived Design Systemを生成する
view: dev
period: 2026-05
architecture_docs:
  - ../../../architecture/vibepro-design-cognition-loop-architecture.md
spec_docs:
  - ../../../specs/vibepro-derived-design-system.md
reason: 既存のDesign Cognition Loop / design-modernize DAG内でDerived Design System制約を追加する変更であり、新しい外部生成器、runner、storage boundary、実装authorityを導入しないため新規ADRは不要。
status: active
created_at: 2026-05-25
updated_at: 2026-05-25
---

# VibeProで既存UI改善用のDerived Design Systemを生成する

## 背景

MoonchildでAitle Design Systemを作った時に強かったのは、画面をいきなり生成することではなく、先にプロダクト意味、semantic token、component role、composition rule、anti-patternを固定したことだった。

VibeProの `design-modernize` は既存画面の情報構造を守るためのDesign Quality DAGを持つが、外部Design System bundleがない場合に、VibePro自身が「そのプロダクトで許されるデザイン判断の空間」を作る力が弱い。

既存UI改善では、画像生成や外部DSは参照材料であり、VibePro内で導出したDesign System制約、現行コード、現行スクリーンショット、Graphify/Codex evidence、Gate DAGが実装判断の正本になる必要がある。

## 方針

- `design-modernize derive-system` を追加し、product briefと現行UI証跡からDerived Design Systemを生成する。
- `design-modernize plan` も同じDerived Design Systemを内包し、screen spec / visual hypothesis / implementation specへ渡す。
- Derived Design Systemは、theme値だけでなくproduct semantics、semantic color roles、state semantics、CTA hierarchy、component responsibilities、composition rules、anti-pattern、visual hypothesis policyを持つ。
- 画像生成は実装正本ではなくvisual hypothesis explorationとして扱い、候補ごとのpreserved UX、design moves、risky/rejected moves、implementation notes、DS drift risksを要求する。
- `ds-gate.json` は明示的なpass/fail clauseを持ち、implicit fallbackを許可しない。

## Architecture Decision

このStoryは既存のDesign Cognition Loop / `design-modernize` DAGの中に、Derived Design System導出とDS Gate artifactsを追加する。新しい外部生成器、runner、永続化境界、実装authorityは導入しない。

実装境界は `src/design-modernize.js` と `src/cli.js` に閉じ、成果物は既存の `.vibepro/design-modernize/<story-id>/` 配下へ保存する。Moonchildや画像生成は候補探索の入力であり、実装判断の正本はVibePro spec、現行コード、現行スクリーンショット、Graphify/Codex evidence、Gate DAGに固定する。

## 受け入れ基準

- [ ] `vibepro design-modernize derive-system <repo> --id <story-id>` が外部生成器なしで `design-system-derivation.json` を作る
- [ ] Derived Design Systemに `product_semantic_model`、`derived_design_system`、`component_role_map`、`composition_guidelines`、`ds_gate` が含まれる
- [ ] `design-modernize plan` がDerived Design System artifactsを `.vibepro/design-modernize/<story-id>/` に保存する
- [ ] Aitleのようなhotel discovery briefでは `premium_utility_travel`、AI電話CTA、plan type、availability、geo/distance、urgency semanticsを導出する
- [ ] `visual_hypothesis_policy` は画像生成を候補探索として扱い、実装authorityをVibePro spec/current code/screenshots/gate evidenceへ固定する
- [ ] `ds_gate` は identity、semantics、component roles、composition、visual hypothesis、anti-pattern を明示的に検査し、fallbackを許可しない
- [ ] CLI helpとREADMEに `derive-system` とVibePro-derived Design Systemの位置づけが出る
- [ ] `npm test` と `npm run typecheck` が通る
