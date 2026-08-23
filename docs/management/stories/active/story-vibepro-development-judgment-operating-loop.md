---
story_id: story-vibepro-development-judgment-operating-loop
title: Development Judgmentを標準計画とOutcome学習へ接続する
status: active
view: dev
period: 2026-08
---

# Development Judgmentを標準計画とOutcome学習へ接続する

## 背景

PR #481で、Senior Engineering JudgmentをDevelopment Judgment DAGへ変換し、PRへ非blockingに投影し、Outcomeを追記するCLIが揃った。しかし標準`vibepro-workflow`に発火条件がなく、`story plan`も判断を消費せず、採択と後日のOutcomeが同じコマンドに混在している。

その結果、エージェントが正しく標準手順へ従ってもJudgmentは実行されず、実行されてもPR本文へ表示されるだけで計画を変えず、Outcomeも次の判断入力へ戻らない。これは閉ループではなく、閉ループを構成できる部品が存在する状態である。

## Story

開発責任者として、Development Judgmentの適用要否、意味入力の採択、評価、Story計画への消費、人間の採否、後日のOutcome、次回判断へのfeedbackを一つの明示的な運用ライフサイクルとして扱いたい。

それにより、旧Gate DAGを復活させず、Development Judgmentが実際に計画を変え、その結果から次の判断を更新するかを測定できる。

## Acceptance Criteria

- Judgmentの適用要否を理由付きで記録でき、非該当も無言の省略ではなく明示状態になる。 <!-- ac:DJO-001 -->
- `judgment prepare`は適用判断済みStoryだけで実行でき、前回Outcomeを次の`development_cycle`へfeedbackする。 <!-- ac:DJO-002 -->
- 自動生成draftはそのまま評価できず、問題設定・制約・選択肢をレビューした入力を`judgment input adopt`でprovenance付きに採択してから評価する。 <!-- ac:DJO-003 -->
- `judgment status`は`not_started`から`closed`までの運用ライフサイクルと次アクションを返す。 <!-- ac:DJO-004 -->
- actionableなJudgmentは`story plan`へbindingされ、mode別の判断タスクとplan effectを生成する。非該当・unactionableはタスクを注入しない。 <!-- ac:DJO-005 -->
- 人間の採否・計画影響を`judgment disposition record`、後日の結果を`judgment outcome record`として時間分離して記録する。 <!-- ac:DJO-006 -->
- disposition済みでOutcome未記録のStoryを`judgment pending`で再浮上できる。 <!-- ac:DJO-007 -->
- confirmed/mixed/falsified/unknown Outcomeが次回`judgment prepare`のhistory boundaryまたはadopted batchへ反映される。 <!-- ac:DJO-008 -->
- `pr prepare`はlifecycle、plan binding、disposition、pending outcomeを表示するが、Judgmentは常にadvisory/nonblockingでreadinessを変更しない。 <!-- ac:DJO-009 -->
- 同梱`vibepro-workflow`は診断後・Story plan前に適用判断から評価までを実行し、plan後にdisposition、merge後または観測後にOutcomeを閉じる手順を持つ。 <!-- ac:DJO-010 -->

## Non-goals

- `pr prepare`からの自動Judgment実行
- JudgmentによるPR block、waiver、merge、deploy
- 問題設定やStoryの自動採択
- 旧汎用Gate DAG、予算統制、review lifecycle会計の復活
- Brainbaseへの全判断自動昇格
- FX・keiba・Brainbaseとの共有package抽出
