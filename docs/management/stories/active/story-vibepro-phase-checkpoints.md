---
story_id: story-vibepro-phase-checkpoints
title: Gate DAGをPR直前だけでなく開発フェーズごとのチェックポイントにする
status: active
source:
  type: user_feedback
  id: phase-checkpoints
architecture_docs:
  - docs/architecture/vibepro-phase-checkpoints.md
spec_docs:
  - docs/specs/vibepro-phase-checkpoints.md
---

# Story

VibeProを使うAI駆動開発では、PR作成直前だけでGateを確認しても遅い。
Story、Architecture、Spec、サブエージェントレビュー、検証証跡が揃っていないまま実装へ進むと、
最後に大量の抜けが見つかり、Vibe Codingの残り20%が重くなる。

VibeProは、各開発フェーズの入口/出口で「次へ進んでよいか」を明示的に判定できる必要がある。

## Acceptance Criteria

- `vibepro checkpoint` で利用可能な checkpoint stage を確認できる。
- `story` checkpoint は Story / Architecture / Spec の未解決を block する。
- `implementation-start` checkpoint は Story / Architecture / Spec / Requirement と planning/spec 系 Agent Review 未完了を block する。
- `test-plan` checkpoint は test plan Agent Review 未完了を block する。
- `implementation-complete` checkpoint は runtime gate と implementation Agent Review 未完了を block する。
- `verification` checkpoint は verification gate と gate Agent Review 未完了を block する。
- `pr` checkpoint は PR作成前の全 required Gate DAG 未解決を block する。
- checkpoint の失敗は exit code 2 で返し、自動化が止められる。
- `task execute` は実装入口の `execution.json` / `execution.md` に progressive checkpoint plan を出し、development-phase Agent Review をPR直前ではなく各checkpointでdispatchできるようにする。
