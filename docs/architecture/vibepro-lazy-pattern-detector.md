---
story_id: story-vibepro-lazy-pattern-detector
title: VibePro Lazy Pattern Detector Architecture
---

# Architecture

## Decision

A standalone, pure module `src/lazy-pattern-detector.js` exports `detectLazyPatterns({ files })`. Each pattern is encoded as a literal object in a `PATTERNS` array, holding `id`, `severity`, `applies_to(filePath)`, `match(line) → { snippet, fix_hint }|null`, and `message`. The detector iterates files × patterns × lines, so adding a new pattern is a single append.

## Boundaries

- The module owns: pattern catalog, detection loop, finding shape.
- The module does NOT own: git diff extraction, calling git, reading files, integrating with `pr-manager.js` or `agent-review.js`. Those are caller responsibilities and are explicitly out-of-scope for this story.

## Pattern composition

```js
const PATTERNS = [
  {
    id: 'merge_conflict_marker',
    severity: 'critical',
    applies_to: () => true,
    requires_file_level_check: true, // needs all three markers
    file_check(addedLines) { /* return finding or null */ }
  },
  {
    id: 'debug_print_left_in',
    severity: 'high',
    applies_to: (p) => !isTestPath(p) && /\.(js|ts|jsx|tsx|mjs|cjs|py|rs)$/.test(p),
    match(line, filePath) { /* return { snippet, fix_hint } or null */ }
  },
  // ... 6 more
];
```

The `file_check` hook is for patterns that need to look at the file as a whole (only `merge_conflict_marker` today); `match` is the common per-line hook.

## Failure Modes

- Unknown file extension → `applies_to` returns false; no findings produced. Caller can extend later.
- Pattern regex throws → detection skips that file/pattern combination silently and continues; tests assert this resilience.

## Reasoning

Lazy patterns are exactly the class of failure that humans miss in PR review (skimming added lines, eye-skipping `TODO`s) but a regex catches every time. Keeping the detector pure and isolated lets it be reused by `pr prepare`, `review prepare`, or future CLI subcommands without coupling to any of them. Wiring is intentionally a separate story so this can be tested and shipped as a primitive first.
