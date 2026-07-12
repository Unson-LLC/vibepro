---
story_id: story-vibepro-session-exposure-provenance-dedup
parent_design: vibepro-runtime-cost-gap-closure
---

# Spec

## SEXP-S-1 provenance

Given Codex session JSONL entries, when session-cost builds artifact token accounting, then each exposure has one provenance bucket from the five-value closed set.

## SEXP-S-2 digest deduplication

Given repeated normalized transcript content, when accounting is aggregated, then raw estimated tokens remain compatible while unique and duplicate estimates are reported separately by SHA-256 digest.

## SEXP-S-3 mixed tool output

Given one tool output containing signals for multiple semantic buckets, when classified, then its provenance is `mixed_tool_output` and it is not represented as an unqualified fresh read.

## SEXP-S-4 compatibility and failure boundary

Given an existing consumer that reads semantic `buckets`, when provenance accounting is added, then the existing bucket totals remain unchanged and malformed or unmatched transcript entries remain unattributed instead of being promoted to fresh evidence.

```yaml
inherited_behavior:
  - condition: "entry.type === 'session_meta'"
    classification: unchanged
    files:
      - src/session-efficiency-audit.js
  - condition: "!sessionSelection.session_id && !inferSession && sessionId !== 'auto'"
    classification: unchanged
    files:
      - src/session-efficiency-audit.js
  - condition: "!inferSession && requestedSessionId !== 'auto'"
    classification: unchanged
    files:
      - src/session-efficiency-audit.js
```

## Diagrams

### threat_model

```mermaid
flowchart LR
  J["Session JSONL"] --> X["Text extraction"]
  X --> S["Existing semantic classifier"]
  X --> D["Normalized SHA-256 digest"]
  S --> P["Provenance classifier"]
  D --> U["Window-local unique/duplicate ledger"]
  P --> U
  U --> R["Bounded session-cost report"]
  J -. "malformed or no signal" .-> N["Unattributed, not fresh evidence"]
  U -. "does not alter" .-> C["Legacy semantic bucket totals"]
```

Accounting boundary: session text is observational input only. The digest is used for window-local accounting and does not change persistence lookup or cross-session equivalence. Duplicate content remains visible in raw totals and is only excluded from the new unique estimate.

## References

- `src/session-efficiency-audit.js#buildArtifactTokenAccounting`
- `test/session-efficiency-audit.test.js`
