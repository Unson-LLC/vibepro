---
story_id: story-vibepro-canonical-audit-gate-dag-replay
title: Canonical Audit Gate DAG Replay Architecture
---

# Architecture

## Decision

canonical audit inventoryは、Gate DAGの物理ファイルだけでなく、evidence-depth plannerが定義するsummary-depth最終Gate契約を解釈する。

`evidence-plan.json`が`gate-dag.json`のskipを明示し、`evidence-plan.json`と`decision-index.json`の生成・実在が確認できる場合に限り、Gate DAG参照を代替契約で解決済みとする。条件が欠ける場合は従来どおり未解決参照としてfail closedする。full depthの実ファイルは従来どおりcanonical bundleへ収録する。

## Boundary

- 変更: `canonical-audit.js`のsource inventoryと参照解決入力
- 再利用: self-dogfood scannerと同じsummary-depth契約条件
- 非変更: evidence-depth planner、Gate DAG生成、圧縮bundle、hash検証、merge persistence

## Rollback

判定helperとinventory filteringをrevertすれば、従来の全参照必須動作へ戻る。既存canonical bundleのschemaは変更しない。
