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
updated_at: 2026-07-22
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
- [ ] IRO-S-8: 現行`origin/main`のtarget architecture conformance baseline（69 violations。PR #378時点の68件に、後続mainで1件追加）を悪化させない。新規コードはrun-session owner境界内に置き、`cli.js`への逆呼び出しとbaseline超過を追加しない。

## Scenarios

- S-001: Given required review roles are pending, when Guarded Run advances the review action, then roles are prepared and dispatched in serial stages with parallel roles, and every start/poll/close/record transition is journaled exactly once.
- S-002: Given dispatch or polling is interrupted, unauthorized, timed out, or returns invalid provenance, when the same Run resumes, then the deterministic operation key prevents duplicate reviewer execution, any started lifecycle is closed, and a typed stop remains visible instead of becoming a pass.

## Non Goals

- required Reviewの省略またはmanual passへの置換。
- 実装agentをreviewerとして再利用すること。
- target architectureの既存69 violationsをこのStory内で解消すること。
