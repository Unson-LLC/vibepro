# Test Plan: Guarded Autonomy Hardening

## Acceptance matrix

| Scenario | Expected outcome | Evidence |
|---|---|---|
| success | current HEAD reaches `pr_ready` only after Gate readiness | Guarded Run orchestration tests |
| human decision | `waiting_for_human`, typed decision, same-Run resume | human checkpoint tests |
| repair/no progress | bounded escape or typed stop; no infinite loop | next-best-action and repair-loop tests |
| quota/timeout/CI pending | retry policy persists typed codes; stop is not success | policy schema and safe-action tests |
| budget/deadline | typed `blocked` stop with observed and limit | GAH-S-1 unit test |
| critical gate | no waiver or merge action is available | safe-action closed-registry tests |
| cancel | terminal, idempotent cancellation | lifecycle tests |
| restart | authority artifact resumes the same Run | fresh-process tests |
| HEAD drift | rebind plus fresh `pr prepare`; otherwise typed block | changed-HEAD tests |
| unknown usage | cockpit prints `unknown`, never zero | GAH-S-8/9 unit test |

## Commands

- `node --test test/guarded-run-session.test.js test/safe-action-orchestrator.test.js test/story-run-portfolio.test.js`
- `node --test --test-concurrency=2`
- `node bin/vibepro.js skills lint .`
- `cmp -s CLAUDE.md AGENTS.md`
