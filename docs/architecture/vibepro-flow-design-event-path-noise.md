---
story_id: story-vibepro-flow-design-event-path-noise
title: Flow Design Event Path Noise Architecture
---

# Flow Design Event Path Noise Architecture

`flow_design` remains a static UI reliability scanner, but it should model operation risk rather than all JavaScript control flow.

## Boundary

- Static source scanning is acceptable for triage.
- The scanner does not build a full TypeScript call graph.
- It does build a shallow event graph: JSX event attributes identify root handlers, and direct calls from those handlers identify one-hop helper functions that still belong to the user operation path.

## Classification

- Production UI files contribute gate findings.
- Test/spec/mock files may be scanned later for test quality, but they do not contribute production interactive contract findings.
- Pure helper names (`format*`, `*Label`, `getLatest*`, `createId`, `summarize*`, `flatten*`) are treated as value-return helpers unless directly connected to an event path.
- Early return findings include `event_path`, `handler`, and optional `mitigation` so reports explain why a finding remained or was downgraded.
