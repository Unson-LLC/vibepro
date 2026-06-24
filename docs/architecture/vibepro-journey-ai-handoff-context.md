---
summary: "Architecture for treating mechanical Journey derivation as AI handoff context rather than authoritative Journey state."
read_when:
  - Changing Journey derivation semantics
  - Changing Journey status or PR context
  - Designing curated Journey workflow
---

# Journey AI Handoff Context

VibePro can infer a candidate Journey from Story docs, Story catalog entries, Spec clauses, Graphify surfaces, and PR gate evidence. That inference is useful context, but it is not enough to decide the product Journey. Product Journey decisions need interpretation of user intent, business loop closure, core vs supporting Stories, and missing judgment.

## Boundary

`journey_context_pack` is machine-derived evidence for AI/human interpretation. It is not the authoritative product Journey.

`curated_journey` is the interpreted artifact that `journey status`, PR context, and UI/UX gates can treat as settled Journey evidence.

## Artifact Model

- `.vibepro/journey/latest-journey.json`: candidate Journey context pack, backward-compatible path, not authoritative.
- `.vibepro/journey/latest-journey.md`: human-readable context pack summary.
- `.vibepro/journey/latest-handoff.md`: AI-readable handoff prompt and evidence summary.
- `.vibepro/journeys/<journey-id>.json`: curated Journey artifact produced by AI or human review.

## Status Rules

- No context pack: `missing`.
- Context pack exists but no curated Journey: `needs_curated_journey`.
- Curated Journey exists and has conflicts: `conflict`.
- Curated Journey exists and walking skeleton needs evidence: `needs_evidence`.
- Curated Journey exists and no blocking state remains: `available`.

The context pack still carries candidate placement, walking skeleton, conflict, and open question data so that AI can create the curated Journey without losing evidence.

## PR Context

PR context keeps the existing Journey section but adds explicit provenance:

- `artifact_kind`
- `curated`
- `curated_journey_path`
- `handoff_available`
- `curation_status`

That lets UI/UX gates distinguish a settled curated Journey from a handoff-only state.
