---
story_id: story-vibepro-flow-design-event-path-noise
title: flow_designの通常return/test mock誤検知を減らす
issue: https://github.com/Unson-LLC/vibepro/issues/58
spec_docs:
  - ../../specs/vibepro-flow-design-event-path-noise.md
architecture_docs:
  - ../../architecture/vibepro-flow-design-event-path-noise.md
---

# Story: flow_designの通常return/test mock誤検知を減らす

## 背景

VibeProのUI診断 `flow_design` は、押しても何も起きないUIや操作契約の欠落を拾うために使う。
一方で、AitleのAI検索UI診断では、通常の値返却helperやtest mockのbuttonまで `needs_review` として拾い、人間が見るべきUI操作リスクが埋もれた。

## 目的

`silent_noop` はユーザー操作経路にある早期returnへ絞り、formatter/selector/helperの通常returnを除外する。
また、test/spec/mock内のinteractive elementは本番UI契約とは分離し、review gateを汚さない。

## 受け入れ基準

- `createId`, `format*`, `*Label`, `getLatest*`, selector系helperの通常returnは `silent_noop` にしない。
- `onClick`, `onSubmit`, `onChange`, `onKeyDown` などイベントhandler、またはhandlerから直接呼ばれる関数の早期returnは診断対象に残る。
- disabled/loading/error表示が近傍にある早期returnは、mitigation情報つきで低severity化する。
- `*.test.tsx`, `*.spec.tsx`, `__mocks__` 内のbutton/mockは本番interactive contractのreview gateに入れない。
- Issue #58 相当のfixtureで、実バグ候補だけが残る。
- `diagnostic-engine` の変更は `VP-FLOW-002` のflow_design silent noop finding化に限定し、authorization order / network / security / database など非flow診断分岐は既存挙動を変えない。

## タスク

- [x] Story / Architecture / Spec を追加する。
- [x] flow_design scannerをイベント経路中心にする。
- [x] test/mock UIを本番UI契約から分離する。
- [x] Issue #58 相当の回帰テストを追加する。
- [ ] VibePro gate / tests を通してPR化する。
