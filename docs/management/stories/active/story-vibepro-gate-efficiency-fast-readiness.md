---
story_id: story-vibepro-gate-efficiency-fast-readiness
title: "Focused PR readiness views stay lightweight"
parent_design: vibepro-bounded-artifact-view
status: active
view: dev
period: 2026-07
source:
  type: operator_feedback
  title: "VibePro gate evidence feels heavy when an agent only needs the next blocker"
related_stories:
  - story-vibepro-bounded-artifact-view
  - story-vibepro-agent-review-minimal-recovery-plan
spec_docs:
  - docs/specs/story-vibepro-gate-efficiency-fast-readiness-spec.md
created_at: 2026-07-05
updated_at: 2026-07-05
---

# Story

Focused `pr prepare` views should preserve Gate DAG safety while avoiding heavy
HTML and full DAG artifacts when the caller asked only for a bounded readiness
projection. When a gate still blocks, the projection should include the concrete
next command VibePro already knows.

## User Story

**As a** VibePro user or AI coordinator checking PR readiness<br>
**I want** `--summary-json` and focused `--view` calls to use summary-depth
evidence unless I explicitly request full evidence, and to expose concrete next
commands for blockers<br>
**So that** routine blocker checks stay fast and actionable without weakening
the full PR gate

## Scope

- Default focused PR prepare projections to summary evidence depth.
- Preserve explicit `--evidence-depth full|standard|summary` overrides.
- Keep full `--json` behavior risk-adaptive for durable PR evidence.
- Record why the summary-depth override happened for auditability.
- Extract command-shaped actions from unresolved gate `required_actions`.
- Preserve existing human-readable gate guidance.
- Add a concrete fallback command for overall-status blockers with no node details.

## Acceptance Criteria

- [x] GEFR-S-1: `pr prepare --view readiness` uses summary evidence depth even when the default risk profile is standard.
- [x] GEFR-S-2: Focused views skip heavy HTML and standalone Gate DAG dumps under summary depth.
- [x] GEFR-S-3: `pr prepare --json` keeps the existing risk-adaptive depth.
- [x] GEFR-S-4: Explicit `--evidence-depth` still wins over the focused-view default.
- [x] GEFR-S-5: A gate action containing a backticked VibePro command exposes that command as `primary_next_command`.
- [x] GEFR-S-6: `next_commands` deduplicates command-shaped actions while preserving order.
- [x] GEFR-S-7: Overall-status fallback blockers point to `pr prepare --view blocking-gates`.
- [x] GEFR-S-8: Focused readiness projections keep the next-command metadata.

## Non Goals

- Removing required gates from PR creation.
- Making full artifact generation unavailable.
- Changing the Gate DAG readiness decision model.
- Auto-executing recovery commands.
- Treating a suggested command as a waiver.
