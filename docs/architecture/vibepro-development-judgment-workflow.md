---
story_id: story-vibepro-development-judgment-workflow
title: Development Judgment Workflow Architecture
status: active
---

# Development Judgment Workflow Architecture

## 決定

Senior Engineering Judgmentを判断評価器、Development Judgment DAGを判断履歴の正本モデルとして接続する。

```text
Frame -> Story -> Event
                  |
                  v
         judgment prepare
                  |
                  v
       Senior Judgment Evaluator
                  |
                  v
       Development Judgment DAG
          |                 |
          v                 v
   PR advisory projection  Outcome append
```

この接続はMeaning Planeを自動採択せず、Control Planeへ新しいblocking authorityも追加しない。判断DAGはKnowledge / Meaning上の説明可能な履歴であり、PR readiness、review、merge、releaseの権限は既存境界に残る。

## 責務

### `judgment prepare`

Story、現在のGit差分、既存の判断runを読み、Senior Judgment入力ドラフトを生成する。

- GoalはStoryから取得する
- Observationは現在の変更ファイルから作る
- 前回runがあれば`parent_run_id`へ結ぶ
- 問題設定は`uncertain`とする
- 判断軸は明示的にinactiveで開始する
- 意味、原因、選択肢を自動採択しない

したがって、prepareはContext収集であり、Judgmentそのものではない。

### Senior Judgment Evaluator

既存のVALUE / SIMPLIFY / VALIDATE、問題設定、仮説、証拠、選択肢剪定を評価する。ここは現在の詳細な判断ロジックを所有する。

### Development Judgment compiler

Senior Judgmentの評価結果を次の小さな因果DAGへ投影する。

```text
goal_contract
  -> problem_frame
    -> development_mode
      -> option_pruning
        -> recommendation
```

DAGは評価器の内部グラフを複製しない。長期的に残すべき判断因果だけを正本モデルへ圧縮する。

### Outcome append

Recommendationに対して次を追記する。

- human decision: accepted / modified / rejected
- judgment effect: changed_plan / changed_review_focus / escalated_to_human / no_effect
- outcome status: confirmed / mixed / falsified / unknown
- evidence references
- observed outcomes

過去runはimmutableとし、Outcomeはcurrent projectionと独立Outcome artifactへ追記する。悪い判断を後から書き換えて正しい判断に見せない。

### PR projection

`pr prepare`は最新判断の次だけを表示する。

- run id
- development mode
- recommendation
- unknown count
- outcome count
- latest outcome status
- artifact path
- advisory / blocking境界

投影は常に`blocking=false`であり、存在しない場合は`not_recorded`、読取不能時は`unavailable`として表示する。

## 不変条件

1. FrameとStoryの採択は既存の人間権限に残す。
2. prepareはrepository factsから意味を推定しない。
3. Senior JudgmentとDevelopment Judgmentを別々の競合するOntologyとして成長させない。
4. Development Judgmentのimmutable runはOutcome記録で変更しない。
5. PR投影は`gate_status`、`blocking_reasons`、merge権限へ影響しない。
6. 判断artifactの欠落や破損は、判断投影だけをunavailableにする。
7. Outcomeは判断が実装・レビューへ与えた効果を明示する。

## Brainbaseとの境界

VibeProは開発Bounded Context内の詳細判断を保持する。会社全体へ影響する判断のBrainbase昇格は後続のpromotion policyで扱う。

このStoryでは自動同期を実装しない。まずVibePro内で実判断とOutcomeが十分に蓄積されることを優先する。

## Operating loop completion

The advisory DAG is now activated through an explicit lifecycle: applicability -> prepare -> input adoption -> evaluation -> Story plan binding -> disposition -> Outcome -> next-run feedback. The lifecycle remains non-blocking and is never auto-run by PR preparation. See `docs/architecture/vibepro-development-judgment-operating-loop.md`.
