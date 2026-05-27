---
story_id: story-vibepro-lazy-pattern-detector
title: VibePro Lazy Pattern Detector Spec
---

# Spec

## Required Behavior

- VibePro provides a pure detection function `detectLazyPatterns({ files })` exported from `src/lazy-pattern-detector.js`.
- Input shape: `files = [{ path: string, added_lines: [{ line_number: number, content: string }] }]`. The function inspects only `added_lines` so it grades the NEW work, not the legacy state of the file.
- Output shape: `{ schema_version: '0.1.0', findings: [{ pattern_id, severity, file, line_number, snippet, message, fix_hint }] }`.
- The initial pattern set is fixed and high-signal — it MUST detect at least these 8 categories on the appropriate file types:
  - `merge_conflict_marker` (severity `critical`): `<<<<<<<`, `=======` followed by `>>>>>>>` markers in any source/docs file.
  - `commit_marker_left_in` (severity `high`): `REMOVE BEFORE COMMIT`, `DO NOT COMMIT`, `DEBUG ONLY` text in any non-test file.
  - `debug_print_left_in` (severity `high`): `console.log(`, `console.debug(`, `debugger;`, `print(` (only in `.py` files), `dbg!` (only in `.rs` files) inside non-test source files.
  - `silent_catch` (severity `high`): empty catch blocks `catch (\w*) {}` (JS/TS), `except\s*:\s*pass` (Python), `catch {}` (JS/TS) in non-test source files.
  - `todo_fixme_marker` (severity `medium`): `TODO`, `FIXME`, `XXX` (case-sensitive) in committed source — NOT in markdown TODO lists.
  - `eslint_disable_without_reason` (severity `medium`): `eslint-disable` directives whose comment lacks a trailing reason (no text after the rule name).
  - `placeholder_text` (severity `medium`): `lorem ipsum`, `Acme Corp`, `John Doe`, `foo@bar.com`, `example.com` in committed prose or source string literals.
  - `em_dash_in_prose` (severity `low`): em-dash character `—` (U+2014) in Markdown files — a known AI tell.
- Each finding MUST include: `pattern_id` (kebab-case stable id), `severity` (`critical|high|medium|low`), `file` (path), `line_number` (1-based number from `added_lines`), `snippet` (the added line, trimmed to ≤120 chars), `message` (one-line description), `fix_hint` (one-line suggested fix).

## Invariants

- `INV-LPD-1`: Detection is a pure function with no I/O. Callers gather the added lines.
- `INV-LPD-2`: Test files (paths matching `test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`) MUST be exempted from `debug_print_left_in` and `silent_catch` (tests legitimately log and swallow errors).
- `INV-LPD-3`: An empty `files` array MUST return `{ schema_version, findings: [] }` — never throw.
- `INV-LPD-4`: `merge_conflict_marker` requires the FULL three-marker triplet (`<<<<<<<`, `=======`, `>>>>>>>`) within the same file's added lines to count, so isolated `=======` in a Markdown header rule does not false-positive.
- `INV-LPD-5`: A line containing both `TODO` and `eslint-disable` MAY produce two findings; pattern detections are independent.

## Non Goals

- VibePro does not auto-fix detected patterns.
- The detector does not call out style preferences beyond the listed 8 categories (no opinion on indentation, naming, or formatting).
- The detector does not currently integrate with `pr-manager.js` or `agent-review.js` — wiring is left to a follow-up story so this can ship as a tested primitive first.
