---
story_id: story-vibepro-engineering-judgment-blocking-criteria
title: Engineering Judgment Blocking Criteria Architecture
---

# Architecture

## Decision

Engineering Judgment axisのstatus解決を、単なる missing evidence 判定から
`blocker evaluation` を含む4段階へ拡張する。

判定順序は以下に固定する。

1. axis activation
2. matched evidence classification
3. blocker evaluation
4. follow-up / waiver resolution
5. final axis status emission

これにより「証拠不足」と「今止めるべき条件一致」を分離する。

## Status Model

- `active_passed`: 必須evidenceを満たし、blocker不一致
- `active_accepted_followup`: blocker不一致で、未充足evidenceが安全にdefer可能
- `active_needs_evidence`: blocker不一致だが、未充足evidenceがあり安全deferも成立しない
- `active_blocked`: blocker一致。PR create/merge判断を止める

## Boundary

- `active_blocked` は「missing evidence がある」だけでは発火しない
- `active_accepted_followup` は blocker を打ち消すために使ってはいけない
- waiver は follow-up の別名ではなく、blocker source に紐づく明示判断とする

## Flow

```mermaid
flowchart TD
  A["active axis"] --> B["classify evidence"]
  B --> C{"blocking criteria matched?"}
  C -->|yes| D["active_blocked"]
  C -->|no| E{"required evidence complete?"}
  E -->|yes| F["active_passed"]
  E -->|no| G{"safe follow-up proven?"}
  G -->|yes| H["active_accepted_followup"]
  G -->|no| I["active_needs_evidence"]
```

## Tradeoff

この変更は false block のリスクを持つため、初期実装では
blocker一致根拠を必ず artifact 上に出す。
止める精度を監査できない blocker は導入しない。
