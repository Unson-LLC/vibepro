---
story_id: story-vibepro-artifact-value-ledger
title: artifactが支えた判断をledger化する
view: dev
period: 2026-07
parent_design: vibepro-artifact-value-ledger
architecture_docs:
  - docs/architecture/vibepro-artifact-value-ledger.md
spec_docs:
  - docs/specs/vibepro-artifact-value-ledger.md
status: active
created_at: 2026-07-01
updated_at: 2026-07-01
---

# artifactが支えた判断をledger化する

## 背景

日次価値監査ではartifact量が大きいこと自体を価値またはfake-valueとして扱いがちだった。
しかし価値は、artifactがどのconsumerに読まれ、どの判断を支えたかで決まる。

## 受け入れ基準

- [ ] `evidence-reuse.json` が `artifact_value_ledger` を持つ
- [ ] ledgerがartifact path、consumer、decision_supported、head bindingを保持する
- [ ] senior gap judgmentがledger状態をcost contextとdecision cardへ出す
- [ ] usage reportがdecision-bound artifact数とconsumer数を集計する
