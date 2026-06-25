---
story_id: story-vibepro-design-modernize-journey-context
title: Design Modernize Journey Context Spec
status: draft
created_at: 2026-06-25
updated_at: 2026-06-25
---

# Design Modernize Journey Context Spec

## Invariants

- `INV-DMJC-1`: Journey remains a top-level VibePro product-context surface; `design-modernize` only resolves and displays it.
- `INV-DMJC-2`: Machine-derived Journey artifacts MUST be represented as `journey_context_pack` and MUST NOT be treated as authoritative curated Journey.
- `INV-DMJC-3`: UI modernization plans MUST expose Journey curation status before screen-level implementation guidance.

## Contracts

- `C-DMJC-1`: `design-modernize plan` MUST create `.vibepro/design-modernize/<story-id>/journey-context.json`.
- `C-DMJC-2`: If no Journey context exists, `design-modernize plan` MUST generate `.vibepro/journey/latest-journey.json` and `.vibepro/journey/latest-handoff.md`.
- `C-DMJC-3`: The plan JSON MUST include `journey_context.artifact_kind`, `curated`, `curation_status`, `authority`, `gate.status`, and `next_commands`.
- `C-DMJC-4`: The Design Quality DAG MUST include `design:journey_context` before `design:current_ui_evidence`.

## Scenarios

- `S-DMJC-1`: Running `vibepro design-modernize plan` on a repo without Journey context returns a plan with `journey_context.generated_by=design-modernize_plan`.
- `S-DMJC-2`: When only machine-derived context exists, the plan shows `journey_context.gate.status=needs_review` and `authority=handoff_context_only`.
- `S-DMJC-3`: The generated Markdown and implementation spec include a Journey Context section.

## Anti-patterns

- `AP-DMJC-1`: Do not move curated Journey storage under `.vibepro/design-modernize/`.
- `AP-DMJC-2`: Do not let `design-modernize plan` silently pass Journey context when only machine-derived handoff evidence exists.
- `AP-DMJC-3`: Do not require an external image/design generator to resolve Journey context.

## Verification

- `V-DMJC-1`: `node --test --test-name-pattern 'design-modernize plan creates Design Cognition Loop evidence' test/vibepro-cli.test.js`
- `V-DMJC-2`: `npm run typecheck`
- `V-DMJC-3`: `node bin/vibepro.js pr prepare . --story-id story-vibepro-design-modernize-journey-context --base origin/main --json`

