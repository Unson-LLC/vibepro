---
story_id: story-vibepro-open-issue-closure-gates
title: VibePro open issue closure gates Spec
---

# VibePro open issue closure gates Spec

## Invariants

- `INV-107`: E2E AC coverage may trust `ac:n` markers only when they appear in executable assertion text and the assertion text covers the AC, not when they appear as marker-only comments.
- `INV-64`: Requirement Consistency must prefer selected story inferred spec code references before broad runtime scanning.
- `INV-67`: Design System artifacts must never persist likely secret values from external bundles or free-text DS guidance.

## Contracts

- `CON-107`: `buildStoryE2eCoverage` accepts Playwright assertion messages such as `expect(value, 'ac:1 concrete AC text')` for the matching story E2E file.
- `CON-64`: `resolveCodeFiles` uses inferred spec `origin.code_refs` and `verifiable_by.code_pattern` file references when no PR diff file group is available.
- `CON-67`: `sanitizeExternalBundle` preserves normal design token evidence while redacting secret-like key/value substrings.

## Scenarios

- `S-107`: Given a matching story E2E file with `expect(..., 'ac:1 <AC text>')`, then VibePro marks that AC covered; given only `// ac:1`, it remains `needs_evidence`.
- `S-64`: Given a selected story spec references `src/lib/candidate/value-parser.ts` and an unrelated legacy route contains `auth.authorized`, then diagnosis scans only the selected parser and avoids `VP-REQ-002` noise.
- `S-67`: Given an external DS bundle contains `api_token=value` inside guidance, then persisted DS artifacts omit the value and validation blocks any residual unredacted form.

## Verification

- `test/risk-adaptive-gate.test.js` covers `INV-107` and `S-107`.
- `test/vibepro-cli.test.js` covers `INV-64`, `INV-67`, `S-64`, and `S-67`.
