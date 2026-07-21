# Test Plan: Guarded Autonomy Hardening

## Acceptance matrix

| Scenario | Expected outcome | Evidence |
|---|---|---|
| success | current HEAD reaches `pr_ready` only after Gate readiness | Guarded Run orchestration tests |
| human decision | `waiting_for_human`, typed decision, same-Run resume | human checkpoint tests |
| repair/no progress | bounded escape or typed stop; no infinite loop | next-best-action and repair-loop tests |
| quota/timeout/CI pending/review timeout | persisted policy governs built-in and custom codes; fresh CLI recovery records a retry audit for each operational stop | `GAH-S-2 persisted retry policy...`, `GAH-S-2 persisted retry policy governs arbitrary...`, and `GAH-S-2 fresh CLI recovers...` |
| budget/deadline | typed `blocked` stop with observed and limit | GAH-S-1 unit test |
| critical gate | no waiver or merge action is available | safe-action closed-registry tests |
| cancel | terminal, idempotent cancellation | lifecycle tests |
| restart | authority artifact resumes the same Run | fresh-process tests |
| HEAD drift | rebind plus fresh `pr prepare`; otherwise typed block | changed-HEAD tests |
| unknown usage | cockpit prints `unknown`, never zero | GAH-S-8/9 unit test |
| pre-hardening 0.2.0 | advisory limits migrate before resume and cannot lock out the Run | `GAH-S-1 existing pre-hardening 0.2.0...` |
| Trusted Delivery Efficiency | Run transitions/accounting and typed completed action measurements automatically populate Story attribution; empty, failed, and text-only journal entries stay unknown | GAH-S-8/9 cockpit, `GAH-S-10 efficiency metrics use only typed...`, and SRP-S-6/GAH-S-10 tests |

## Commands

- `node --test test/e2e/story-vibepro-guarded-run-session-contract-main.test.js test/guarded-run-session.test.js test/agent-runtime-adapter.test.js test/safe-action-orchestrator.test.js test/story-run-portfolio.test.js`
- `node --test --test-concurrency=2`
- `node bin/vibepro.js skills lint .`
- `cmp -s CLAUDE.md AGENTS.md`
