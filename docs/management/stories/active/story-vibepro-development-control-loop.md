---
story_id: story-vibepro-development-control-loop
title: 開発予算と構造差分を次バッチ判断へ接続するDevelopment Control Loop
status: active
development_intent: simplification
source:
  type: user_feedback_and_repository_retrospective
  id: development-control-loop
architecture_docs:
  - docs/architecture/story-vibepro-development-control-loop.md
spec_docs:
  - docs/specs/vibepro-development-control-loop.md
reason: >-
  旧delivery-efficiency guardrailの全面復活、PR Gate追加、Story単位の手動予算上書きを比較した。
  既存の並列実行能力とPR互換性を維持しつつ、採用済みbatchの計測を次batch admissionへだけ効かせる。
  問題時はenforcementをshadowへ戻せ、既存のStory/PR flowは継続できる。
  correctnessや価値判断は予算だけでは証明せず、Senior Judgmentと既存evidenceが境界を持つ。
---

# Story

VibeProは並列に高速開発できる一方、開発量・検証量・修復回数・構造増加が積み上がっても、次の開発batchを価値追加から簡素化へ切り替える自動トリガーを持っていない。

過去のdelivery-efficiency機能は消費量を測れたが、Storyごとの巨大な上書きとGate/review途中停止を生み、予算超過を予算増額で追認する構造になった。全面復活ではなく、採用済みbatchを一度だけsnapshotし、その結果をSenior Judgmentへ入力して次batchのintentを`VALUE`、`VALIDATE`、`SIMPLIFY`へ制約する制御ループとして作り直す。

## Acceptance Criteria

- `development_intent`は`value`、`validation`、`simplification`のいずれかとしてStory planへ投影される。
- 採用済みbatchについて、構造予算と消費予算を分離したimmutable snapshotを生成できる。
- 構造予算はbaseline比のLOC、file count、import edge、dependency cycle、workflow-control surfaceを評価する。
- 消費予算はtoken、agent execution、repair batch、expensive verification、verification durationを評価し、不明値を0として扱わない。
- 履歴が十分なら直近5件medianと20件p95からcapを導出し、不十分ならbootstrap capを使う。
- `judgment status`、`judgment snapshot`、`judgment outcome record`で現在判断、採用batch固定、outcome記録を操作できる。
- 最初の採用batchはshadowとして記録し、次batchからStory plan、PR prepare、PR createのadmissionに同じ判断を使う。削除済みの旧`execute merge` commandは復活させない。
- `SIMPLIFY`時も並列実行を禁止せず、次batchのintentだけを簡素化へ制約する。
- Story単位の予算上書き、review途中停止、strict-HEAD再計測ループ、新しいGate DAG nodeを導入しない。
- baselineはoutcome receiptが改善を示したbatchでのみ前進する。
- 過去の肥大化commitをreplayし、構造増加や制御面増加が`SIMPLIFY`を再現することをテストする。
