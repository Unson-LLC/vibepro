---
story_id: story-vibepro-engineering-judgment-spine-evidence
title: Engineering Judgment共通spineを証跡ベースの判定にする
view: dev
period: 2026-06
source:
  type: codex-log-audit
  id: VP-EJD-AUDIT-002
  title: "Common judgment spine was present but effectively always passed"
architecture_docs:
  - ../../../architecture/vibepro-engineering-judgment-spine-evidence.md
spec_docs:
  - ../../../specs/vibepro-engineering-judgment-spine-evidence.md
status: active
created_at: 2026-06-04
updated_at: 2026-06-04
---

# Engineering Judgment共通spineを証跡ベースの判定にする

## 背景

Engineering Judgment DAGは `gate:common_judgment_spine` を持つが、直近調査ではこのspineが実質的に常時 `passed` として扱われていた。これでは「熟練エンジニアの思考順序」は表示できても、「その判断が証跡で裏付けられているか」は検査できない。

熟練エンジニアは変更タイプに関係なく、意図、現在状態、不変条件、境界、壊れ方、完了条件を確認してから実装やPR作成へ進む。VibeProはこの共通spineを説明文ではなく、証跡不足で止まれるDAG nodeにする必要がある。

## User Story

**As a** VibeProでEngineering Judgment DAGを使う開発者
**I want to** 共通判断spineがStory、Spec、差分、検証証跡に基づいてpass/needs_evidenceを返すようにしたい
**So that** route-specific gateに入る前に、熟練エンジニアが必ず見る基礎判断の抜けを検出できる

## 方針

- `gate:common_judgment_spine` を常時passではなく、複数のsub-checkを持つgateにする。
- 最低限のsub-checkは `intent`, `current_reality`, `invariants`, `boundaries`, `failure_modes`, `done_evidence` とする。
- 各sub-checkはStory/Spec/Architecture/git diff/verification evidence/review evidenceのいずれかに根拠を持つ。
- 根拠がない場合は `needs_evidence` とし、PR bodyに不足した問いを人間向けに表示する。

## 受け入れ基準

- [ ] `gate:common_judgment_spine` にsub-check配列が出力される
- [ ] Storyの目的またはAcceptance Criteriaを取得できない場合、`intent` は `needs_story` になる
- [ ] 差分対象の現状確認証跡がない場合、`current_reality` は `needs_evidence` になる
- [ ] Spec/Architecture/既存テストから不変条件が抽出できない高リスク変更では、`invariants` が `needs_evidence` になる
- [ ] public API、DB、auth、agent workflow、runtime surfaceを触る変更で境界証跡がない場合、`boundaries` が `needs_evidence` になる
- [ ] failure modeまたはdone evidenceが空のまま高リスク変更がreadyにならない
- [ ] PR本文のEngineering Judgment説明は、route名だけでなく各sub-checkの根拠と不足を表示する
- [ ] light/docs-only変更では必要最小限のspine checkに縮退し、過剰にblockしない

## 非目標

- 人間の全思考を完全再現すること
- LLMの自由記述だけを根拠にspineをpassさせること
