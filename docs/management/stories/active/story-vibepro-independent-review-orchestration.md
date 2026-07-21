---
story_id: story-vibepro-independent-review-orchestration
parent_design: vibepro-autonomous-implementation-closure-roadmap
vibepro_story_id: story-vibepro-autonomous-implementation-closure-roadmap
title: Required Reviewを独立agentへ自動dispatchして記録する
status: active
view: dev
period: 2026-07
category: quality
related_stories:
  - story-vibepro-autonomous-action-dag
  - story-vibepro-production-runtime-connectors
  - story-vibepro-agent-review-independence-provenance
  - story-vibepro-review-dispatch-preflight-dag
  - story-vibepro-agent-review-lifecycle-control
reason: "selected automated lifecycle composition using existing review contracts instead of weakening required Agent Review. compatibility: review prepare/start/close/record and provenance gates remain authoritative. rollback: emit the existing dispatch instruction and wait for runtime. boundary: orchestration only; verdict content remains the independent reviewer result."
created_at: 2026-07-21
updated_at: 2026-07-21
---

# Required Reviewを独立agentへ自動dispatchして記録する

## Acceptance Criteria

- [ ] IRO-S-1: Gate DAGが要求するroleをprepareし、role単位の別agentへ可能な範囲で並列dispatchする。
- [ ] IRO-S-2: Reviewはread-only、別identity、別session、closed lifecycleを必須とする。
- [ ] IRO-S-3: start、poll、close、recordをRun journalへexactly-onceで記録する。
- [ ] IRO-S-4: `pass`、`needs_changes`、`block`を改変せず集約する。
- [ ] IRO-S-5: runtime不足、auth、timeout、invalid provenanceはGate passにせず型付き停止する。
- [ ] IRO-S-6: parallel success、needs_changes、block、same-session rejection、restartのE2Eがある。
- [ ] IRO-S-7: `needs_changes`は既存Review LifecycleとRepair Loopへ渡し、新しいverdict/finding schemaを作らない。

## Non Goals

- required Reviewの省略またはmanual passへの置換。
- 実装agentをreviewerとして再利用すること。
