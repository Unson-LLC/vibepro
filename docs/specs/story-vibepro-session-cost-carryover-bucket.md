---
story_id: story-vibepro-session-cost-carryover-bucket
title: Design Diagrams for story-vibepro-session-cost-carryover-bucket
parent_design: vibepro-session-cost-carryover-bucket
---

# Design Diagrams

### threat_model

```mermaid
flowchart LR
  Actor[Codex compacted entry payload.replacement_history] --> Surface[summarizeSessionExposureEntry classification]
  Surface --> Asset[audit_evidence_tokens used-for-decision metric]
  Threat[Carryover replay text mentioning .vibepro/docs/test paths] --> Surface
  Surface --> Control[COMPACTION_REPLAY_ENTRY_TYPES check takes precedence, forces replayed_context bucket]
```

- Trust boundary: text extracted from a `compacted` entry's `replacement_history`
  is treated as carryover, not fresh evidence, regardless of its content.
- Spoofing risk: none introduced; the bucket routing is keyed on the JSONL
  entry's own `type` field, not on freeform text content.
- Tampering risk: non-compaction entries keep their existing pattern-based
  classification unchanged.
