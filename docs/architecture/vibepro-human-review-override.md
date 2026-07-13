---
title: Human review override architecture
status: active
---

# Human review override architecture

`human-review.json`を推奨の正本、`decision-records.json`をoverride責任の正本とする。共通policy moduleをPR作成とmergeの副作用前に呼び、`human-review:<recommendation>` source、accepted status、理由、reviewer、current HEAD bindingを同一規則で検証する。

```mermaid
flowchart LR
  H[human-review recommendation] --> P[override policy]
  D[current HEAD decision ledger] --> P
  P --> C[PR create]
  P --> M[merge]
```
