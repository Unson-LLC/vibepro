---
story_id: story-vibepro-development-judgment-workflow
title: Development Judgment DAGを実利用フローへ接続する
status: active
view: dev
---

# Development Judgment DAGを実利用フローへ接続する

## 背景

VibeProには、構造化された入力を評価するSenior Engineering Judgmentと、判断履歴をappend-onlyなDAGとして保持するDevelopment Judgment DAGが存在する。

しかし両者は独立しており、Senior Judgmentの評価結果はDevelopment Judgment DAGの正本へ接続されていない。また、評価入力を毎回手作業で作る必要があり、判断が実装・レビューへ影響したか、後日のOutcomeが判断を支持したかも継続的に記録できない。

この状態では、判断DAGの安定性は検証できても、開発成果への価値は検証できない。

## Story

開発責任者として、Storyと現在のリポジトリ事実から判断入力のドラフトを作り、Senior JudgmentをDevelopment Judgment DAGへ変換し、人間判断と実結果を後から追記したい。

それにより、判断をPRの強制Gateに戻さず、判断が実際に何を変え、結果として正しかったかを検証できる。

## Acceptance Criteria

- `judgment prepare`はStory、変更ファイル、既存判断を読み、Senior Judgment入力の保守的なドラフトを生成する。意味の採択は行わず、問題設定は`uncertain`で残す。 <!-- ac:DJW-001 -->
- `judgment evaluate`は既存Senior Judgmentを実行した後、その結果を汎用Development Judgment DAGへ変換し、immutable runとcurrent projectionを保存する。 <!-- ac:DJW-002 -->
- Development Judgment DAGはgoal、problem frame、development mode、option pruning、recommendationの因果順序を保持し、cycleを作らない。 <!-- ac:DJW-003 -->
- `judgment outcome record`はhuman decision、judgment effect、Outcome評価をappend-onlyでcurrent DAGへ追記し、immutable runを書き換えない。 <!-- ac:DJW-004 -->
- `pr prepare`は最新Development Judgmentの要約をPR artifactと本文へ表示するが、判断の有無・内容・Outcomeは`gate_status`またはPR作成可否を変更しない。 <!-- ac:DJW-005 -->
- 判断成果物が欠落・破損していても、PR準備は判断投影を`unavailable`として扱い、判断機能そのものを新しいblocking authorityにしない。 <!-- ac:DJW-006 -->

## Non-goals

- 旧汎用Gate DAGの復活
- Judgmentによる自動waiver、merge、deploy
- FrameまたはStoryの自動採択
- Brainbaseへの全判断自動同期
- FX、keiba、Brainbaseとの共有package抽出
