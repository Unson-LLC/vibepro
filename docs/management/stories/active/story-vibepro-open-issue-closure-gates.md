---
story_id: story-vibepro-open-issue-closure-gates
title: VibePro open issue closure gates
spec_docs:
  - docs/specs/vibepro-open-issue-closure-gates.md
architecture_docs:
  reason: Targeted detector fixes in existing PR/E2E, Requirement Consistency, and Design System scanner boundaries; no new runtime architecture boundary.
---

# VibePro open issue closure gates

## Background

The remaining open VibePro issues are not missing broad features; they are places where detector behavior still diverges from senior engineering judgment.

Closes #107.
Closes #64.
Closes #67.

## Policy

Keep the fixes detector-specific and evidence-backed. Do not loosen gates by accepting marker-only comments, broad selected-story scan noise, or unredacted Design System reference material.

## Acceptance Criteria

- [x] Playwright `expect(..., 'ac:n ...')` assertion messages can satisfy story AC coverage when the assertion also covers the AC text.
- [x] Marker-only comments and unrelated assertions still do not satisfy E2E AC coverage.
- [x] Requirement Consistency in selected-story diagnosis scans inferred spec `origin.code_refs` before falling back to broad runtime files.
- [x] Out-of-scope inherited API routes do not produce `VP-REQ-002` when the selected story spec points to narrower code files.
- [x] Design System ingest redacts free-text `api_token=value` style material without dropping normal DS token artifacts.
- [x] Design System validate blocks residual free-text secret material in persisted DS artifacts.

## Verification

- `npm run typecheck`
- `node --test test/risk-adaptive-gate.test.js`
- `node --test test/vibepro-cli.test.js`
