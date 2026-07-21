# Guarded Autonomy Hardening Architecture

## Decision

Guarded Autonomy remains an orchestration boundary over the existing Guarded Run, safe-action registry, Agent Runtime, review provenance, validation sequencing, repair loop, and Portfolio controller. The Run authority artifact owns policy, counters, deadline, usage accounting, and typed stop reasons. It does not own merge, deployment, waiver, or external-side-effect authority.

## Components and flow

1. `execute run --until pr-ready --autonomy guarded` validates a closed policy input and persists it with the new Run.
2. Every orchestration or resume reads the authoritative Run and evaluates attempts, iterations, deadline, token, and cost limits before executing an action. Every recoverable-to-running transition is exclusive to `execute resume`; the lower-level transition API rejects it. Resume additionally checks persisted retry classification and backoff before changing state; rejected retries do not append a successful retry journal entry.
3. A limit produces a persisted `blocked` state and a typed, non-retryable stop reason. Unknown usage remains `null` with `status=unknown`; it is never coerced to zero.
4. The safe-action registry remains closed to repository-local preparation actions. Critical gates, waivers, merge, deployment, and other external side effects remain outside it.
5. Existing runtime-review provenance is reused: only a closed, read-only, current-HEAD, separate-session review dispatch may enter the Agent Review Gate.
6. The cockpit derives active/wait time from authoritative transitions, suite/reuse/invalidation counters only from typed measurements on completed action-journal entries, interruptions from the human-decision journal, and token/cost from runtime accounting. Text matches, failed actions, and an empty journal are not measurements. It renders unobserved values as `unknown`, instead of manufacturing zeroes.
7. Portfolio advancement automatically snapshots those Run-derived measurements into the matching Story entry. Explicit attribution may add measured values but cannot cross Story/Run identity boundaries.

## Compatibility and rollback

Legacy Run artifacts remain readable. A pre-hardening `0.2.0` artifact is identified by the absence of the new policy/accounting fields; its advisory attempt/iteration budget is migrated to bounded hardening defaults and receives an explicit `migration_compatibility.retry_policy_enforcement=legacy_advisory` marker, while usage remains unknown. All Runs without that marker enforce persisted retry classification and backoff for built-in operational codes, codes listed by the persisted policy, and custom stops explicitly typed with `details.retry_policy_scope=managed`. Operator/advisory stops may be typed `manual`; they still resume only through `execute resume`, but are not classified as automatic retries. Rollback disables `--until pr-ready` auto-advance and uses explicit `execute status`, `resume`, and existing manual Gate commands. No rollback may reinterpret a blocked Run as success.

## Failure boundaries

- Policy exhaustion: `blocked` plus `max_attempts_exceeded`, `max_iterations_exceeded`, `deadline_exceeded`, `token_budget_exceeded`, or `cost_budget_exceeded`.
- Runtime quota/timeout, CI pending, review timeout, and action failure remain typed recoverable operational stops governed by the persisted retry policy. Non-retryable or premature resume returns `retry_not_allowed` or `retry_backoff_pending` without mutating the Run.
- Human decisions remain `waiting_for_human`; cancellation remains terminal.
- HEAD mutation requires existing rebind and final `pr prepare` readiness confirmation.

## Threat model

```mermaid
flowchart LR
  Operator[Operator policy input] --> Validator[Closed policy validator]
  Tamper[Budget bypass or forged success] -->|rejected| Validator
  Validator --> Authority[Authoritative Run state]
  Runtime[Agent runtime usage] --> Accounting[Unknown-preserving usage accounting]
  Accounting --> Authority
  Authority --> Guard[Pre-action policy guard]
  Guard -->|within limits| SafeActions[Canonical safe-action registry]
  Guard -->|limit reached| TypedStop[Persisted typed blocked stop]
  SafeActions --> Review[Separate-session current-HEAD review]
  Review --> PRReady[PR-ready]
  Review -->|same or unknown identity| TypedStop
  PRReady -. explicit operator action only .-> Merge[Merge]
```

The Run artifact is the trust boundary for limits and usage. CLI input and runtime telemetry are untrusted until validated; absent telemetry remains unknown. The safe-action registry cannot grant waiver, merge, deployment, or external-side-effect authority, and reviewer identity cannot be supplied by the implementation session itself.
