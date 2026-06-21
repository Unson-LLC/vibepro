---
story_id: story-vibepro-engineering-judgment-activation-precision
title: Engineering Judgment Activation Precision Architecture
---

# Architecture

## Decision

axis activation を 2 段階に分ける。

1. `activation_candidates[]`:
   Story / diff / route / scope / Graphify から拾った生 signal を残す
2. `activation_precision`:
   candidate signal をカテゴリ分解し、non-text corroboration がある場合だけ active にする

これにより、「なぜ firing したか」と「なぜ suppress したか」を同じ artifact から再構成できる。

## Signal Categories

- `text`: Story title/background/AC/spec clause 由来の語彙一致
- `changed_path`: 実際の changed file path / file content 由来
- `risk_surface`: change-risk-classifier 由来
- `pr_route`: PR route classification 由来
- `file_group`: docs/spec/tests/source grouping 由来
- `network_contract`: API/network contract scan 由来
- `scope`: reviewable / changed-file-count / split-plan 由来
- `graphify`: optional Graphify impact scope 由来

## Precision Rule

- candidate が 0 件なら inactive
- candidate が text のみなら inactive
- axis ごとに最低 1 件の non-text category を要求する
- suppress した場合でも candidate は残し、`activation_precision.status=insufficient_signal`
  として artifact に出す

## Invariants

- conservative default: text-only activation で high-risk axis を active にしない
- explainable default: suppress した理由は machine-readable に残す
- compatibility: route selection や evidence matching はそのまま維持し、activation 部分だけを厳格化する
