---
story_id: story-vibepro-one-command-pr-ready-closure
status: active
parent_design:
  - vibepro-autonomous-implementation-closure-roadmap
---

# One-command PR-ready Closure Architecture

## Decision

`vibepro execute run . --story-id <id> --until pr-ready --autonomy guarded` is the canonical operator entrypoint for the closed implementation loop. The CLI remains an outer adapter: it parses options and composes production dependencies, but does not own action sequencing or call back into itself.

The run-session boundary owns the closure composition. A focused run-session module supplies production owners for the existing autonomous DAG:

`diagnose -> prepare_artifacts -> implement -> verify -> review -> repair -> final_prepare`

This Story composes the already-shipped Production Runtime Connectors and Independent Review Orchestration. It does not replace their provider, identity, lifecycle, or review-verdict contracts.

## Boundaries

- `src/cli.js` selects guarded one-command closure by default only for `execute run ... --until pr-ready --autonomy guarded`, and preserves explicit `--action-profile legacy` as the compatibility escape hatch.
- A new owner under the target model's `run-session` module composes repo-local action owners and provider-neutral runtime dispatch. It must not import `src/cli.js`.
- `src/guarded-run-session.js` remains the durable Run state, checkpoint, resume, budget, HEAD-rebind, and typed-stop authority.
- `src/safe-action-orchestrator.js` remains the closed DAG and dependency-order authority.
- `src/agent-runtime-connectors.js` remains the production provider adapter boundary.
- `src/independent-review-orchestrator.js` remains the independent review lifecycle and identity boundary.
- `src/pr-manager.js` and the persisted current-HEAD `pr-prepare.json` remain the only PR-ready authority.

No owner may invoke a CLI command through `src/cli.js`. Repo-local capabilities are imported through their owning modules or supplied as dependency-injected functions.

The concrete composition edge is one-way. `src/guarded-run-session.js` already
owns the injected `readGateReadiness`, `preparePullRequest`, git identity,
persisted Run mutation, and provider-neutral runtime coordinator capabilities.
It adapts those existing dependencies into bounded callbacks for the new
run-session owner:

- diagnose reads the current Gate/readiness snapshot;
- prepare-artifacts dispatches an implementation runtime objective containing
  only the missing readiness inputs;
- verify and final-prepare invoke PR preparation, but only final-prepare may
  translate its current-HEAD ready bit into `pr_ready`;
- implement and repair use the provider-neutral dispatch/poll callbacks;
- review remains the existing Independent Review Orchestration owner.

The new owner imports no diagnosis, Gate/PR, connector, or CLI module.
`src/cli.js` continues to inject only production connector dependencies at the
outer composition root. This keeps the new module inside `run-session`; existing
baseline imports from `guarded-run-session.js` are not expanded.

For the canonical command with no provider option, the run-session policy uses
the production connector ids in the audited order `codex`, then `claude-code`.
The first available provider is persisted in the runtime dispatch; fallback is
attempted only for a typed availability/auth/quota/probe stop. If neither
provider can start, the Run stops with the provider's typed reason and recovery
command. An explicit `--provider-fallbacks` list remains an operator override,
and a persisted Run retains the provider order chosen when it was created.

## Action Ownership

1. `diagnose` reads the injected current Gate/readiness snapshot and classifies its missing inputs. Story diagnosis and Graphify remain pre-implementation planning evidence produced before this run; this action does not refresh them or import their modules.
2. `prepare_artifacts` creates only missing Architecture, Spec, and Task inputs that can be derived without a material product decision. A material ambiguity returns a bounded `human_decision` descriptor (`type`, `question`, `choices`, `material_reason`, `impact_scope`, `source_refs`, and `stop_node_id`) with `waiting_for_human`. The safe-action layer carries that untrusted descriptor without writing it; `guarded-run-session` validates it through the existing `createHumanDecision` authority, persists the decision artifact and `pending_decision`, and binds `stop_node_id` to `prepare_artifacts`. `resume` resolves that exact decision, journals the answer and `reflected_in` paths, clears `pending_decision`, and resumes from `prepare_artifacts`.
3. `implement` dispatches the production implementation runtime into the authoritative managed worktree and accepts completion only when the reported HEAD equals the real managed-worktree HEAD. Every implementation and repair request requires both `workspace_write` and `local_workspace_only`; a connector may advertise the latter only when it enforces workspace sandboxing, disabled network access, and non-interactive approval denial for that invocation. A provider that cannot enforce that envelope stops before `start` with typed missing-capability recovery.
4. `verify` invokes the injected PR-preparation callback to classify the
   implementation runtime's current-HEAD verification records and Gate
   evidence. Verification commands themselves are part of the bounded
   implementation/repair runtime objective and are recorded through the
   existing verification contract; this owner neither executes arbitrary
   commands nor imports verification modules. A real verification failure
   returns a typed stop for explicit correction/resume, while missing
   environment evidence is never treated as pass.
5. `review` delegates to the shipped Independent Review Orchestration and preserves separate read-only identity.
6. `repair` runs only for independent-review `needs_changes`, dispatches a
   bounded implementation repair (including its relevant verification
   commands), then invalidates and re-runs the verify/review suffix on the new
   HEAD. A passing review makes repair an auditable no-op. A `verify` failure
   stops before review and does not silently enter this repair path.
7. `final_prepare` re-runs PR preparation and returns `pr_ready` only when the current HEAD artifact has `gate_status.ready_for_pr_create=true`.

Each action uses the Guarded Run idempotency key and durable checkpoint journal. Process restart resumes only the incomplete suffix. HEAD changes immediately rebind all downstream evidence.

The Human Decision handoff is deliberately split across boundaries: the new
owner may only describe a decision; `safe-action-orchestrator` may only validate
and transport the descriptor; `guarded-run-session` is the sole creator and
persister of Human Decision artifacts. A `waiting_for_human` result without a
valid descriptor fails closed instead of producing an unresumable Run.

## Safety and Human Authority

Guarded closure may create/reuse a managed worktree, write repository artifacts, produce focused commits, run validation, and dispatch implementation or read-only review runtimes. Implementation dispatch is fail-closed unless its connector enforces the `local_workspace_only` capability envelope. It must not:

- create or merge a PR;
- grant a critical waiver;
- perform deployment, publication, or another material external side effect.

Those operations remain explicit human commands. Missing authority, product ambiguity, quota, permission, timeout, CI pending, cancellation, no progress, and exhausted repair convergence are typed terminal or resumable stops with a next command. Operator cancellation first commits terminal Run authority, then contains every active runtime dispatch; an in-flight dispatch or poll must re-read authority and may neither overwrite `cancelled` nor continue the action suffix.

## Compatibility and Rollback

Existing Runs retain their persisted action profile. `--action-profile legacy` keeps the pre-closure repo-local flow. `--disable-autonomous-actions` audibly records the autonomous-to-legacy fallback. Rolling back the default selection does not alter persisted Run schemas or the connector/review contracts.

## Verification

The acceptance matrix covers success, restart/resume, material human decision, verification failure, `needs_changes` repair convergence, no progress, quota, timeout, CI pending, and cancellation. When the selected production connector exposes the required capability, its smoke must prove a real implementation commit and a separate read-only review identity. When no provider exposes that capability, the production smoke must stop before mutation and persist the provider, missing capability, recovery boundary, and typed stop; the available path remains covered by production-shaped E2E rather than being misreported as a real provider commit. The Story's self-dogfood run must reach current-HEAD Trusted PR-ready or a typed, evidence-backed stop.

Pre-PR lifecycle acceptance proves only the staged closure protocol and
nonduplication boundary. PR #372, #377, and #382 are the canonical evidence for
the three merged predecessor Stories, their implementation surfaces are not
reimplemented here, and the final Story plus parent roadmap remain `active` in
the initial PR candidate. PR creation and every later delivery operation are
outside OCR-S-8 acceptance, so no pre-PR Gate depends on future PR or merge
evidence.

## Post-PR Delivery Closure Record

After VibePro creates the PR, the delivery record imports initial CI, creates a
focused same-branch closure commit that marks the final Story and parent roadmap
`completed`, rebinds evidence to that HEAD, reruns Gate and independent review,
re-imports CI, and then invokes explicit `vibepro execute merge`. `pr-merge.json`,
the canonical audit, and the merge SHA provide post-merge confirmation. This
record consumes pre-PR acceptance; it is not an acceptance prerequisite.

The canonical planned cases and their public surfaces are fixed in
`docs/specs/story-vibepro-one-command-pr-ready-closure-test-plan.md`. Existing
Autonomous Action DAG and connector tests remain regression inputs; they are not
treated as proof of the new default or production closure.

Target architecture conformance is compared to latest `origin/main` at `236937dfe33eb407f912086d54bfbd3d7d699874`: 81 baseline violations (66 undeclared dependencies, 5 budget violations, 10 orphans). Current HEAD has 80 violations (66 undeclared dependencies, 5 budget violations, 9 orphans). New code and the previously orphaned production connector belong to `run-session`, add no new run-session-to-CLI reverse dependency, and improve the total by one.
