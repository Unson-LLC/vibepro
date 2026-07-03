---
story_id: story-vibepro-story-journey-diagnose
title: Story Journey Diagnosis Architecture
parent_design: vibepro-story-journey-diagnose
---

# Architecture

## Decision

Story status/report/diagnose output gains a read-only `journey_context` section for UI or UX-oriented Stories.

The section summarizes whether the default product Journey is required, whether a curated Journey artifact exists, whether only machine-derived context exists, and what command should create or hand off the missing artifact. The Story layer reads existing Journey status; it does not create Journey authority or change PR Gate DAG enforcement.

## Public Contract

The public CLI and report contract is additive:

- Existing Story commands, options, fields, and exit behavior remain unchanged.
- Existing Markdown and HTML sections remain unchanged; `Journey Context` is appended as additional report content.
- `journey_context.required=false` and `status=not_required` are emitted for backend-only Stories so non-UI work is not forced through Journey curation.
- UI/UX Stories without a curated Journey surface `status=missing` with next actions rather than silently passing.
- Machine-derived Journey context is labelled separately from curated Journey artifacts.

## Architecture Quality

- Alternatives considered: keep Journey visibility only in PR Gate DAG, add a new Journey-only diagnosis command, or append read-only Journey status to existing Story diagnosis. The additive Story output was selected because issue #265 is about Story diagnosis visibility, not Journey ownership.
- Compatibility impact: Existing consumers can ignore the new section and keep reading the previous Story fields and report sections. No existing command is removed or renamed.
- Rollback plan: Revert the Story manager, HTML renderer, tests, Story doc, spec doc, this architecture doc, and Design SSOT link in one scoped commit.
- Boundary: `journey-map.js` remains authoritative for Journey artifact status. `pr-manager.js` remains authoritative for PR Gate DAG Journey requirements. Story diagnosis only presents the current status and next action hints.
- Accepted followups: none.

## Verification Contract

Compatibility and output expectations are covered by focused Story diagnose tests and the full CLI/Journey regression suite:

- Missing Journey context is visible in CLI, Markdown, and HTML outputs.
- Machine-derived and curated Journey artifacts are distinguished.
- Backend-only Stories do not receive Journey next actions.
- Existing PR Gate DAG Journey behavior remains unchanged.
