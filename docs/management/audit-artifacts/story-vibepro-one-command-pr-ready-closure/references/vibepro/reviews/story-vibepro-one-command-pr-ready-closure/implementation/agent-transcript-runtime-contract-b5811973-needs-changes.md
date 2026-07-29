# Final runtime_contract review

- HEAD: `b58119737513b6a5ebe15fdc8f597ca47e44dcb3`
- Result: `needs_changes`
- Reviewer: `/root/final_runtime_contract`

## Finding

`RUNTIME-RECOVERY-001` (medium): provider start authorization failures such as
`auth_denied`, permission waits, and read-only review unavailability can persist
`waiting_for_runtime` without the same-Run recovery contract. The public guarded
Run summary then falls back to `execute status` instead of preserving provider
binding, missing/required capabilities, and an exact
`vibepro execute resume ... --run-id <same-run> --until pr-ready` command.

Use a shared recovery-details merger for every pre-start/permission typed wait,
preserve branch-specific details, and add public JSON/human/resume regression
coverage.

## Inspected inputs

- `src/agent-runtime-adapter.js`
- `src/one-command-pr-ready-closure.js`
- `src/guarded-run-session.js`
- `test/agent-runtime-adapter.test.js`
- `test/guarded-run-session.test.js`
- `test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts`
- Story, Architecture, Spec, and test plan runtime contracts

The focused 165-test suite passed, but did not cover this public recovery branch.
