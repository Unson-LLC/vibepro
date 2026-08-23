---
story_id: story-vibepro-development-judgment-operating-loop
title: Development Judgment Operating Loop Architecture
status: active
---

# Development Judgment Operating Loop Architecture

## 決定

Development Judgmentを任意CLIの集合から、標準開発フローが明示的に実行・消費・評価するoperating loopへ昇格する。ただし意味の採択とControl Planeを分離し、JudgmentはPR readinessを変更しない。

```text
Story selected
  -> diagnosis / architecture / spec context
  -> applicability record
       -> not applicable: reason is durable, planning continues
       -> applicable
            -> prepare conservative input
            -> human/delegated-agent input adoption
            -> Senior Judgment evaluation
            -> Development Judgment DAG
            -> Story plan binding
            -> disposition
            -> delivery / merge / observation
            -> Outcome
            -> next prepare feedback
```

## 境界

### Meaning Plane

- applicabilityを判断する
- draftのproblem frame、constraint、axes、hypotheses、optionsをレビューする
- `judgment input adopt`で誰がどの権限根拠により意味を採択したかを固定する

自動生成draftは観測材料であり、採択済みの意味ではない。

### Judgment Plane

Senior JudgmentがVALUE / SIMPLIFY / VALIDATE、仮説、選択肢、推薦を評価し、Development Judgment DAGへ圧縮する。評価結果はadvisoryであり、計画に参照されてもPR権限を持たない。

### Planning Plane

`story plan`はactionableな最新Judgmentを最初の実消費者としてbindingする。

- VALUE: 価値制約を直接解く最小の選択肢を優先する
- SIMPLIFY: 削除・統合・再設計を優先し、構造増加を避ける
- VALIDATE: 本実装より先に識別的な証拠を得る

planはrun ID、input hash、source HEAD、mode、recommendation、effectを持つ。

### Feedback Plane

採択とOutcomeを時間分離する。

```text
Disposition (before/while delivery)
  accepted | modified | rejected
  changed_plan | changed_review_focus | escalated_to_human | no_effect

Outcome (after evidence exists)
  confirmed | mixed | falsified | unknown
```

Outcomeは次回prepareへ戻す。

- confirmed: `verified_external_outcome`または`simplification_baseline`へ境界を進める
- mixed: previous batchのexternal outcomeを`unchanged`として残す
- falsified: `regressed`として残す
- unknown: `unknown`として残し、次回判断をVALIDATEへ寄せる材料にする

## Lifecycle

```text
not_started
  -> applicable_not_prepared | not_applicable
  -> draft_prepared
  -> input_reviewed
  -> evaluated_unactionable | evaluated_actionable
  -> consumed_by_plan
  -> outcome_pending
  -> closed
```

各状態は`judgment status`から取得し、次の実行コマンドを返す。状態は運用可視化でありGateではない。

## Artifact layout

```text
<review-root>/development-judgment/
  applicability/
  drafts/
  inputs/
  adoptions/
  evaluations/
  runs/
  plan-bindings/
  dispositions/
  outcome-receipts/
  feedback/current.json
  current.json
  current.md
```

immutable historyとcurrent projectionを分ける。過去の判断・採択・Outcomeを上書きして正しかったように見せない。

## 不変条件

1. `pr prepare`はJudgmentを自動実行しない。
2. draft生成はMeaning adoptionではない。
3. CLI評価はadopted inputのhashと一致しなければ拒否する。
4. Story planだけがこのStoryにおける最初の実消費者である。
5. dispositionとOutcomeを同一時点の事実として扱わない。
6. Outcomeは次回判断入力へfeedbackする。
7. Judgmentの欠落・非該当・unactionable・pendingはPR readinessを変更しない。
8. 旧Gate DAG、予算、merge authorityを復活させない。
