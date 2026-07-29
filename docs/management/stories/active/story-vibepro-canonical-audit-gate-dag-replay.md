---
story_id: story-vibepro-canonical-audit-gate-dag-replay
title: Summary depthのCanonical Audit Replayを欠損なく引き継ぐ
status: active
parent_design: vibepro-canonical-audit-gate-dag-replay
related_architecture:
  - ../../../architecture/vibepro-canonical-audit-gate-dag-replay.md
related_specs:
  - ../../../specs/vibepro-canonical-audit-gate-dag-replay.md
reason: full Gate DAGの常時生成ではなく既存のsummary-depth代替契約をcanonical auditにも適用し、full-depth互換性を維持する。問題時は判定helperとテストをrevertでき、変更境界はcanonical audit promotionに限定する。
---

# Summary depthのCanonical Audit Replayを欠損なく引き継ぐ

## User Value

summary depthで正しく生成されたPR証跡をmergeした後も、canonical auditが存在しないfull Gate DAGを欠損と誤判定せず、将来のhandoffで判断結果を再生できる。

## Acceptance Criteria

- `CAGR-AC-001`: evidence planが`gate-dag.json`を明示的にskipし、`evidence-plan.json`と`decision-index.json`が存在する場合、canonical auditはgate DAG欠損を未解決参照として扱わない。
- `CAGR-AC-002`: summary-depth代替契約が不完全な場合、従来どおりgate DAG参照を未解決としてfail closedする。
- `CAGR-AC-003`: full depthで`gate-dag.json`が存在する場合、canonical replay bundleへ`gate_dag`として収録する。
- `CAGR-AC-004`: summary-depth代替artifactのJSONが不正な場合、canonical auditは代替不成立として処理を継続せずparse failureを返す。

## Non Goals

- full Gate DAGをsummary depthでも常時生成しない。
- canonical auditの圧縮・hash・cost accounting契約は変更しない。
