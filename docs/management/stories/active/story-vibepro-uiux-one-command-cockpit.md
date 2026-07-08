---
story_id: story-vibepro-uiux-one-command-cockpit
title: UI/UX one-command preparation and cockpit
status: active
view: dev
period: 2026-07
parent_design:
  - vibepro-uiux-one-command-cockpit
source:
  - operator feedback
  - https://qiita.com/yusuke_ando_vj/items/dd17a285217a15841a3a
related_stories:
  - story-vibepro-ui-journey-e2e-dogfood
  - story-vibepro-visual-evidence-gate-ux
  - story-vibepro-design-modernize-journey-context
created_at: 2026-07-08
updated_at: 2026-07-08
---

# UI/UX one-command preparation and cockpit

## Story

The UI/UX modernization path currently exists as several commands:
`design-system`, `design-modernize`, `journey`, `verify flow`,
`verify record`, and `pr prepare`. A user starting from a UI-heavy story needs
one preparation surface that runs read-only checks, assembles artifact links,
and shows remaining gaps.

## User Story

As a VibePro user starting UI/UX improvement, I want one command and a cockpit,
so that I can see intake, IA, Design System, evidence, gates, and next commands
without guessing which artifact to open first.

## Scope

- Add `uiux prepare` or equivalent orchestrator that reads existing Story,
  Journey, native Design System, intake, IA map, screenshots, verification
  artifacts, and PR gate artifacts.
- Write `.vibepro/uiux/<story-id>/uiux-readiness.json`.
- Write `.vibepro/uiux/<story-id>/uiux-cockpit.html`.
- Cockpit sections: intake coverage, IA flow map, DS/token coverage, style
  preset, responsive/a11y matrix, visual hypotheses, blocking gates, concrete
  next commands.
- The command must not mutate app source code.

## Acceptance Criteria

- UIOC-S-1: `vibepro uiux prepare <repo> --id <story-id>` creates readiness JSON
  and cockpit HTML for UI-heavy stories.
- UIOC-S-2: Readiness reports `ready`, `needs_evidence`, `needs_intake`,
  `needs_journey`, `needs_design_system`, or `blocked` with reasons.
- UIOC-S-3: Cockpit links to source artifacts instead of embedding full JSON
  dumps.
- UIOC-S-4: `pr prepare --view design-ssot` or a new bounded view can point
  reviewers to the UI/UX cockpit without making HTML source of truth.
- UIOC-S-5: Orchestrator is idempotent and safe to rerun on dirty worktrees.

## Non Goals

- No auto-fixing UI code.
- No creating or merging PRs from the cockpit.
- No replacing gate artifacts with HTML.
