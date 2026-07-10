---
story_id: story-vibepro-decision-record-evidence-summary
title: Design Diagrams for story-vibepro-decision-record-evidence-summary
parent_design: vibepro-decision-record-evidence-summary
---

# Design Diagrams

### threat_model

```mermaid
flowchart LR
  Actor[decision record --status accepted] --> Surface[recordDecision buildVerificationEvidenceSummary]
  Surface --> Asset[decision-records.json inline verification_evidence_summary]
  Threat[Missing or corrupt verification-evidence.json] --> Surface
  Surface --> Control[best-effort read degrades to count 0 entries empty, never throws]
```

- Trust boundary: `verification-evidence.json` is read read-only and best-effort;
  a missing or corrupt file degrades to an empty summary instead of failing the
  decision record command.
- Spoofing risk: the summary only reflects what `verify record` already wrote
  for the same story id; it does not accept externally-supplied evidence text.
- Tampering risk: non-accepted decisions (`open`/`rejected`/`superseded`) are
  unaffected and get `verification_evidence_summary: null`.
