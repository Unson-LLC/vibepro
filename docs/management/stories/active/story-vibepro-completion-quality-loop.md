---
story_id: story-vibepro-completion-quality-loop
title: "VibePro自己改善: 最後の20%をE2E品質まで仕上げる"
source:
  type: codex-log-audit
  id: VP-SELF-005
  title: "E2E、human review、visual QAが完了条件に十分組み込まれていない"
architecture_docs:
  - ../../architecture/vibepro-self-dogfood-control-loop-architecture.md
spec_docs:
  - ../../specs/vibepro-self-dogfood-control-loop.md
status: active
created_at: 2026-05-16
updated_at: 2026-05-16
---

# Story: VibePro自己改善: 最後の20%をE2E品質まで仕上げる

## User Story

**As a** VibeProでAIに開発を任せたいユーザー
**I want to** AIが作ったものを、ボタンが押せる、遷移する、保存される、理解できる状態までE2E証跡つきで仕上げられる
**So that** vibe codingで毎回残る最後の20%を人間が手作業で埋め続けず、95%の実利用品質までVibeProが制御できる

## Background

Codexログ監査では、`review-cockpit.html` や `human-review.json` が欠ける、E2Eが未通過のまま成果物だけが作られる、UIを人間が触って理解できる状態まで仕上げ切れていない、という未達が繰り返し見つかった。

VibeProの価値は、AIが80%を速く作ることだけではなく、残り20%の品質詰めを、E2E / human review / visual QA / evidenceへ接続して完了判定できることにある。

## Acceptance Criteria

- [ ] UIを持つStoryでは、主要ボタン、主要遷移、入力、保存、再表示、リロード後状態がE2E証跡に含まれる
- [ ] desktop / mobileの代表viewportで、表示崩れ、重なり、操作不能がないことを証跡化する
- [ ] human reviewが必要なStoryでは `human-review.json` とreview cockpitが生成される
- [ ] E2E未達、visual QA未達、human review未達の場合、PR gateは `ready_to_merge` にならない
- [ ] 未達項目は「次のTODO」ではなく、改善Storyまたは同Story内のblocked gateとして記録される
- [ ] 完了報告には、ユーザー価値、操作証跡、残リスク、未確認範囲が含まれる

## Implementation Notes

- 対象候補: `src/flow-verifier.js`, `src/pr-manager.js`, `src/qa-evidence.js`, review cockpit生成周辺
- UIなしのCLI/ライブラリStoryでは、E2E相当の操作証跡をcommand contract / integration testに置き換える
