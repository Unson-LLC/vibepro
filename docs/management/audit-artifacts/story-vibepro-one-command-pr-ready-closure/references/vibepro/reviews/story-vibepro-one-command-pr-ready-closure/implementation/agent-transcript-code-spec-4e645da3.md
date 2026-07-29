# Final Code/Spec Alignment Review

- head: `4e645da34a6f84bba264f1663abbc26cfa5d57e3`
- reviewer: `codex/final-code-spec-4e645da3`
- status: `needs_changes`

## Findings

- `high:OCR-SPEC-001`: capability-unavailable state persists missing capabilities and provider identity but not the typed recovery boundary required by S-OCR-5. Persist an exact recovery command/boundary in the same Run and assert all three fields.
- `high:OCR-SPEC-002`: the available-provider E2E imports unit coverage and checks static contract markers; it does not exercise a production-shaped Run artifact binding managed-worktree commit, separate read-only review lifecycle, and current-HEAD final Gate. Add an executable Run-artifact scenario.

Other Story, Architecture, Spec, authority, repair, and cancellation clauses were aligned.
