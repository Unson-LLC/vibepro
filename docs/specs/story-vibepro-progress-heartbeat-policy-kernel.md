---
story_id: story-vibepro-progress-heartbeat-policy-kernel
title: Progress Heartbeat Policy Kernel Spec Pointer
parent_design: vibepro-progress-heartbeat-policy-kernel
last_reviewed_root_hash: 4bae50e8f8f01c556137ebd18d0358700152c816509ea7c84007df9e7fdee99a
---

# Progress Heartbeat Policy Kernel — Spec Pointer

正本Spec: [.vibepro/spec/story-vibepro-progress-heartbeat-policy-kernel/spec.json](../../.vibepro/spec/story-vibepro-progress-heartbeat-policy-kernel/spec.json)

- INV-001: 重複進捗値はno-progressデッドラインを延長しない（単調進捗のみが延命）
- INV-002: 5種のkill causeコードと優先順位の保存、policy kill / external signal の区別
- CON-001: evaluateProgressBounds の外形契約保存（CDI-S-5系テスト無変更通過）
- S-001: graphify子プロセスの SIGTERM→猶予→SIGKILL、stop_reason証跡、stdout上限
- S-002: verification runnerのストリーミング進捗延命と外部SIGTERMの timed_out=false 帰属

設計正本: [docs/architecture/story-vibepro-progress-heartbeat-policy-kernel.md](../architecture/story-vibepro-progress-heartbeat-policy-kernel.md)
