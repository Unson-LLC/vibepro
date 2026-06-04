---
story_id: story-vibepro-pr-scope-judgment-gate
title: PRのレビュー可能粒度とStory分割判断をGate化する
view: dev
period: 2026-06
source:
  type: codex-log-audit
  id: VP-EJD-AUDIT-006
  title: "Review logs blocked broad multi-story diffs that were not gate-ready as a single PR"
architecture_docs:
  - ../../../architecture/vibepro-pr-scope-judgment-gate.md
spec_docs:
  - ../../../specs/vibepro-pr-scope-judgment-gate.md
status: active
created_at: 2026-06-04
updated_at: 2026-06-04
---

# PRのレビュー可能粒度とStory分割判断をGate化する

## 背景

直近レビューでは、101 files規模の多ストーリー混在差分が「個別の検証不足」以前に、単一PRとしてreview/gate-readyではないとしてblockされた。

これは熟練エンジニアが早い段階で行う判断である。PRが大きすぎる、複数の目的が混ざっている、Story境界をまたいでいる、release riskをまとめすぎている場合、どれだけ個別testがあってもレビュー品質は落ちる。既存のworktree scope isolationはdirty file混入を扱うが、レビュー可能粒度そのものの判断は別のGateとして扱う。

## User Story

**As a** VibeProでPRを作る開発者
**I want to** 単一PRとしてレビュー可能な粒度か、Story分割が必要かをGate DAGで判断したい
**So that** 大きすぎる変更や複数目的の混在を、証跡不足レビューに入る前に止められる

## 方針

- `gate:pr_scope_judgment` をEngineering Judgment DAGの早い段階に追加する。
- changed files、Story id、Spec refs、route分類、risk surface、review roles、verification evidenceの分散を見てscopeを分類する。
- 分類は `focused`, `large_but_coherent`, `multi_story`, `mixed_unrelated`, `needs_split` などを持つ。
- `needs_split` はcritical gateとしてPR createを止め、split laneまたは次に切るべきStory候補を出す。

## 受け入れ基準

- [ ] `gate-dag.json` に `gate:pr_scope_judgment` が出る
- [ ] 複数Story idまたは複数Spec領域にまたがる差分は `multi_story` として表示される
- [ ] unrelated docs/generated/runtime/source変更が混在する場合、`mixed_unrelated` として表示される
- [ ] file count、directory spread、risk surface数が閾値を超える場合、`large_but_coherent` または `needs_split` に分類される
- [ ] `needs_split` の場合、PR createは止まり、split suggestionが出る
- [ ] 単一Storyでsurfaceが多いが一貫したworkflow変更の場合は、過剰にsplitせず `large_but_coherent` として追加evidence要求に落とす
- [ ] `vibepro pr prepare` のPR bodyにscope judgmentとsplit理由が表示される
- [ ] 回帰テストは、focused small PR、single workflow large PR、multi-story PR、unrelated mixed PRを含む

## 非目標

- file countだけで機械的にPRを拒否すること
- 自動でgit commitを分割すること
