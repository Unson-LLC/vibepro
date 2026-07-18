---
story_id: story-vibepro-classifier-premise-recovery
title: "誤ったclassifier premiseを訂正して再裁定できるようにする"
view: dev
period: 2026-07
source:
  type: github-issue
  id: "#340"
  title: "judgment_dag_adjudication lacks an honest recovery path"
parent_design: vibepro-classifier-premise-recovery
related_stories:
  - story-vibepro-judgment-dag-adjudication
architecture_docs:
  - ../../../architecture/story-vibepro-classifier-premise-recovery.md
spec_docs:
  - ../../../specs/story-vibepro-classifier-premise-recovery.md
status: active
created_at: 2026-07-18
updated_at: 2026-07-18
reason: >-
  Generic waiverやjudged_unsoundの上書きは、正しい否定裁定まで無効化するため採用しない。
  classifier_premise_unsoundだけをitem単位の訂正として記録し、元裁定を不変履歴として残した上で
  replacement evidenceとfresh independent adjudicationを要求する。既存のjudged_sound、
  needs_human_judgment、critical gateの互換性を保ち、問題時は新しい訂正イベントとresolverを
  rollbackすれば従来のfail-closed挙動へ戻せる。今回は明示baseの鮮度問題を境界外とし、別Storyで扱う。
---

# 誤ったclassifier premiseを訂正して再裁定できるようにする

## User Story

**As a** VibeProの判断DAGを運用する開発者
**I want to** 独立judgeがclassifierの誤った前提を正しく否定した場合、その項目だけ前提を訂正し、新しい証拠で再裁定できるようにしたい
**So that** `judged_unsound`を隠したりwaiveしたりせず、元の裁定系譜を保存したまま正直にGateを回復できる

## 背景

現状の `gate:judgment_dag_adjudication` は `judged_unsound` を常に実装不成立として扱う。
これは実装や証拠が不十分な場合には正しいが、上流classifierが「この変更には当該failure modeが
存在する」などの誤ったpremiseを作った場合、独立judgeが正しく否定しても回復経路がない。
さらに同一itemの裁定記録は置換されるため、元裁定と訂正・再裁定の系譜を監査できない。

## Scope

- `judged_unsound` の原因を `implementation_unsound` と `classifier_premise_unsound` に明示分類する
- `classifier_premise_unsound` のみ、対象itemに限定したpremise correctionを受理する
- correctionには元裁定参照、誤ったpremise、訂正後premise、理由、replacement evidenceを必須にする
- 元裁定・訂正・再裁定をappend-onlyの履歴として保存し、current HEADとitemへバインドする
- correction後はfresh independent adjudicationが記録されるまでGateを通さない
- resolverは最新の有効な再裁定だけをcurrent stateに使い、履歴自体は削除しない
- CLI、request template、README（日英）に安全な回復手順を追加する

## 非目標

- `judged_unsound` を一般にwaive可能にすること
- `implementation_unsound` の修正なし通過
- `needs_human_judgment` のdecision record経路変更
- 明示 `--base main` の鮮度・local/remote divergence修正（後続Story）
- classifier自体の判定アルゴリズム全面刷新

## 受け入れ基準

- [ ] `judged_unsound` 記録時に原因分類が必須で、未知値・空理由・provenance欠落を拒否する
- [ ] `implementation_unsound` は従来どおりcritical failureのままで、correctionやwaiverでは通らない
- [ ] `classifier_premise_unsound` はitem単位のcorrectionが無い限りfailedのままになる
- [ ] correctionは同じstory・item・HEADの元裁定を参照し、誤premise・訂正premise・理由・replacement evidenceを必須にする
- [ ] correctionが受理されてもfresh independent adjudicationが無ければneeds_evidenceになり、同一judgeまたはstale HEADの再裁定を拒否する
- [ ] fresh再裁定が `judged_sound` のときだけ対象itemが解決し、`judged_unsound` なら新しい理由でfailedになる
- [ ] 元裁定、correction、再裁定はappend-onlyで残り、current state resolverが最新の有効な系譜を選ぶ
- [ ] 既存の裁定artifactを読み込め、cause未指定の既存 `judged_unsound` は安全側の `implementation_unsound` として扱う
- [ ] `needs_human_judgment` のaccepted decision record経路とcritical waiver拒否は後方互換を保つ
- [ ] unit/E2Eテストが成功し、README（日英）に運用例と禁止事項が記載される

## 検証方針

最初に既存挙動を再現するRedテストを追加する。データフロー、artifact migration、
current-state resolver、CLI入力検証、Gate状態遷移を分離して検証し、最後にVibeProの
current HEADへ証跡を記録する。
