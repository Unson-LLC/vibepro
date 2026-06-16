---
story_id: story-vibepro-subagent-roi-audit
title: "VibePro subagent ROI auditで並列レビューの価値と無駄を可視化する"
source:
  type: user-request
  id: codex-2026-06-16-subagent-roi
  title: "VibePro orchestratorが大量投入するsubagentの価値とtoken/time wasteを監査したい"
architecture_docs:
  - docs/architecture/vibepro-subagent-roi-audit.md
spec_docs:
  - docs/specs/vibepro-subagent-roi-audit.md
status: active
created_at: 2026-06-16
updated_at: 2026-06-16
---

# Story: VibePro subagent ROI auditで並列レビューの価値と無駄を可視化する

## ユーザーストーリー

- ユーザー: VibeProのAgent Review運用を監査する開発者
- したいこと: orchestratorが投げたsubagent reviewが実際に価値を出したかを数値で見たい
- 目的: token/timeを浪費しているroleや、merge判断を良くしたroleを継続的に区別できるようにする

## 背景

VibeProはAgent Review Gateでrole単位のparallel subagent reviewを要求できる。一方で、レビューが「実リスクを捕まえた」のか「passを増やしただけ」なのかは、review summary、lifecycle、Codex log、PR差分を人間が横断しないと判断しにくい。

## 受け入れ基準

- [x] `vibepro review record` がfinding採否とfollow-up解決refを任意で記録できる
- [x] `vibepro review record` がagent token/costの任意入力を記録できる
- [x] `vibepro usage report --subagent-roi` がsubagent reviewごとのvalue score、value signal、waste signalを返す
- [x] `vibepro usage report --subagent-roi` がstory別・全体のaccepted/resolved finding、duplicate/false positive、elapsed minutes、tokens/costを返す
- [x] `--log` / `--codex-log` / `--claude-log` の補助ログからsubagent spawn/wait/close activityを検出できる
- [x] ROI出力はGate判定を変更せず、監査・改善用の観測値として扱う

## 実装メモ

- 正本入力は `.vibepro/reviews/**/review-summary.json` と `review-result-*.json`
- Codex/Claude logは補助シグナルであり、value scoreの正本にはしない
- token実数がない既存artifactでも、lifecycle elapsedとcost tierから暫定監査できる
