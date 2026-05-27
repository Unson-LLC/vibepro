---
story_id: story-vibepro-lazy-pattern-detector
title: VibePro should detect mechanically-checkable lazy code/copy patterns in diffs
architecture_docs:
  - docs/architecture/vibepro-lazy-pattern-detector.md
spec_docs:
  - docs/specs/vibepro-lazy-pattern-detector.md
---

# Story: VibePro should detect mechanically-checkable lazy code/copy patterns in diffs

## Background

Taste-skill (Leonxlnx/taste-skill, 21k stars) makes the bet that AI agents systematically leak the same low-signal patterns into their output — em-dashes in prose, leftover `TODO`s, placeholder text like `Acme Corp`, silent `} catch {}` blocks — and that a checklist of mechanical grep-able rules removes most of them before they reach human review.

VibePro already has two mandatory review lenses (`regression_guard`, `path_surface_coverage`) that depend on a subagent's judgment. Mechanical pattern detection is a different category: it's deterministic, cheap, and produces findings that a reviewer would otherwise miss while skimming. This story adds the detection primitive without wiring it into pr-prepare yet, so it can ship and be tested as a pure module before any consumer takes a dependency.

## Acceptance Criteria

- `src/lazy-pattern-detector.js` exports `detectLazyPatterns({ files })` matching the spec input/output shape.
- The 8 categories listed in the spec are all implemented and each has at least one positive and one negative test case.
- Test files are exempt from `debug_print_left_in` and `silent_catch` (INV-LPD-2).
- An empty `files` array returns `{ schema_version: '0.1.0', findings: [] }` without throwing (INV-LPD-3).
- `merge_conflict_marker` requires all three markers in the same file (INV-LPD-4).
- Each finding includes all required keys: `pattern_id`, `severity`, `file`, `line_number`, `snippet` (≤120 chars), `message`, `fix_hint`.
- Tests cover: each pattern positive/negative, test-path exemption, empty input, snippet length cap.

## Out of Scope

- Wiring detector output into `pr-manager.js` pr-prepare.json — separate follow-up.
- Surfacing findings in `parallel-dispatch.md` for subagent context — separate follow-up.
- Auto-fix behavior.
- Style/lint patterns beyond the 8 categories.
