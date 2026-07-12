---
title: Evidence decision ledger architecture
status: active
parent_design:
  - vibepro-artifact-value-ledger
---

# Evidence decision ledger architecture

`buildArtifactValueLedger`を唯一の生成境界とし、artifact keyとstory idから安定した判断IDを作る。consumerは互換保持し、gate参照を別フィールドに正規化する。判断変化を観測していない生成時点では`null`とし、未使用やfalseと推測しない。
