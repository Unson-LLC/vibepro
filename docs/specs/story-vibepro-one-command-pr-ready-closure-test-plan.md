---
story_id: story-vibepro-one-command-pr-ready-closure
status: active
parent_design:
  - vibepro-autonomous-implementation-closure-roadmap
---

# One-command PR-ready Closure Test Plan

OCR-T-1..4 below are pre-implementation automated acceptance targets. The
implementation is not complete until each named automated case exists and fails
against `origin/main` for the contract it introduces. OCR-T-5 is the
post-implementation production dogfood proof and is validated from persisted
runtime/Gate artifacts rather than claimed as a pre-fix unit case.

## OCR-T-1 Default one-command profile and public help

Target: `test/one-command-pr-ready-closure.test.js`.

- Omitted `--action-profile` plus `--until pr-ready --autonomy guarded` selects
  the autonomous DAG through the parsed public CLI, including dry-run.
- With no provider option, the persisted policy selects `codex` first and
  `claude-code` only as a typed availability/auth/quota/probe fallback.
- Explicit `--action-profile legacy` remains legacy.
- `--disable-autonomous-actions` records the audited fallback.
- English and Japanese help describe agent-backed guarded closure and the
  explicit human authority boundary.
- Dry-run, JSON output, human output, status, and resume preserve the selected
  profile and typed stop.

## OCR-T-2 Production action-owner composition

Target: `test/one-command-pr-ready-closure.test.js`.

- The run-session composes diagnose, missing-artifact preparation,
  implementation, verification, repair, and final preparation without importing
  the CLI.
- Verification classifies current-HEAD evidence through the injected
  PR-preparation callback; bounded commands and evidence recording remain in the
  implementation/repair runtime objective.
- Only `final_prepare` can return `pr_ready`, and it uses the current managed
  worktree HEAD `pr-prepare.json` as authority.
- An unavailable owner, missing authority, or material ambiguity stops with a
  stable code and recovery command.
- A material ambiguity must provide exactly the bounded decision fields
  `type`, `question`, `choices`, `material_reason`, `impact_scope`,
  `source_refs`, and `stop_node_id`; a missing field, invalid choice shape, or a
  `waiting_for_human` result without the descriptor is rejected fail-closed
  before a decision artifact can be persisted.
- Negative boundary spies prove that the closure never invokes PR create,
  merge, critical waiver, deployment, publication, or another material external
  side effect. `final_prepare` receives only the bounded PR-prepare callback.

## OCR-T-3 Runtime commit, review, and repair convergence

Target: `test/one-command-pr-ready-closure.test.js`.

- A production-shaped implementation connector advances the real managed
  worktree commit and reports that exact HEAD.
- Independent review uses a different read-only identity and a closed provider
  session.
- `needs_changes` dispatches one bounded repair, rebinds the changed HEAD, and
  reruns verify/review; an old-HEAD production checkpoint is invalidated before
  dispatch, and pass makes repair an auditable no-op.
- A production-shaped running dispatch is polled to completion without changing
  its dispatch identity, and adding the objective payload does not change the
  persisted legacy dispatch-id formula.
- Final prepare exposes the prepared HEAD for the post-run authoritative HEAD
  check; a missing, stale, or raced binding cannot reach `pr_ready`.

## OCR-T-4 Typed-stop and resume matrix

Target: `test/one-command-pr-ready-closure.test.js`.

Each row has a path-specific typed producer assertion plus the shared
Guarded-Run persistence and public JSON/human rendering contract. A row only
duplicates the public-surface assertion when its recovery fields differ from
that shared transport contract; this keeps the test matrix compositional while
still proving every stop crosses the public boundary unchanged.

| Path | Expected outcome | Resume assertion |
|---|---|---|
| success | current-HEAD `pr_ready` | no incomplete suffix |
| process restart | durable incomplete suffix | resumes first incomplete action |
| material decision | valid seven-field descriptor becomes `waiting_for_human` plus persisted decision artifact and `pending_decision`; missing or malformed descriptor fails closed | exact answer and `reflected_in` paths are journaled before resuming `prepare_artifacts` |
| verification failure | typed correction-required stop | explicit correction/resume reruns verification |
| repeated `needs_changes` | bounded convergence stop | no silent infinite loop |
| no progress | `no_progress` decision/stop | explicit recovery action |
| quota | `quota_exceeded` | provider fallback or explicit retry |
| timeout | typed runtime timeout | dispatch is contained before retry |
| CI pending | `ci_pending` | imported CI evidence resumes final prepare |
| cancellation | `cancelled`, with every active runtime dispatch contained | a stale in-flight dispatch/poll preserves terminal authority and no automatic suffix continuation occurs |

Path-specific producer coverage is split deliberately: the one-command owner
tests assert `verification_failed`, `repair_convergence_exhausted`,
`no_progress`, and `ci_pending`; inherited Guarded Run/runtime tests assert
restart, quota, timeout, cancellation, decision persistence, resume cursor, and
the shared state-to-JSON/human renderer. The production owner factory also
rejects PR-create, merge, waiver, deploy, publish, and generic material-effect
dependencies before any supplied spy can run. Legacy safe-autopilot human stops
remain compatible without the autonomous seven-field decision descriptor.

## OCR-T-5 Production smoke and dogfood evidence

Target artifacts:

- `test/e2e/story-vibepro-one-command-pr-ready-closure-runtime.spec.ts`
- `.vibepro/verification/story-vibepro-one-command-pr-ready-closure.json`
- `.vibepro/executions/story-vibepro-one-command-pr-ready-closure/runs/<run-id>/state.json`
- `.vibepro/pr/story-vibepro-one-command-pr-ready-closure/pr-prepare.json`
- `docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md`
- `docs/management/stories/active/story-vibepro-production-runtime-connectors.md`
- `docs/management/stories/active/story-vibepro-independent-review-orchestration.md`
- `docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md`

When a production provider exposes the required capability, the smoke must bind
the implementation pre/post HEAD, implementation identity/session, independent
review identity/session/lifecycle, verification commands, and final Gate status
to one Run. When every selected provider lacks a required capability, the same
smoke instead passes only if it stops before mutation and binds provider,
missing capability, recovery boundary, and typed stop to the Run. The
available-provider commit/review path remains mandatory production-shaped E2E
regression evidence through the same production action owner selected by the
public CLI; it must not be described as a real provider execution. These are
the two explicit branches of OCR-S-2/OCR-S-6, so an environment-backed
capability stop is not misreported as a failed available-provider execution.
The Story dogfood run must finish at current-HEAD Trusted PR-ready or a typed
evidence-backed stop.

OCR-S-8 pre-PR acceptance must cite merged PR #372, #377, and #382 for the
three predecessor Stories without changing or duplicating their implementation.
It must also prove that the final Story and parent roadmap remain `active` in
the initial PR candidate and that a separate staged delivery record exists.
PR creation, CI evidence, closure commit, rereview, and merge artifacts are not
inputs to this pre-PR acceptance.

## Post-PR Delivery Closure Record (operational, not OCR-S-8 acceptance)

After VibePro creates the PR, record initial CI import, a focused same-branch
closure commit marking the final Story and parent roadmap complete, AIC-S-1..5
traceability to all four Story/PR evidence sets, current-HEAD evidence rebind,
Gate reverification, independent rereview, and CI re-import. Finally record the
explicit `vibepro execute merge`, `pr-merge.json`, canonical audit, and merge
SHA. These artifacts confirm delivery closure but cannot retroactively become a
pre-PR Gate prerequisite.
