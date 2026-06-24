---
name: vibepro-workflow
description: Use when working with VibePro CLI, Graphify, Story diagnosis, task planning, PR preparation, Gate evidence, or VibePro review artifacts.
---

# VibePro Workflow

## Purpose

Use VibePro as a Story / Architecture / Spec / Graphify / Gate control plane. The CLI creates evidence; this Skill tells the agent how to use that evidence without skipping the intended order.

## When to Use

Use this Skill when the task mentions VibePro, Story/Spec/Architecture, Graphify, Gate DAG, PR preparation, Agent Review, diagnosis packages, review cockpit, or VibePro-managed evidence under `.vibepro/`.

Also use it when the user asks whether VibePro work is done, PR-ready, verified, reviewable, or safe to merge. In those cases the answer must be grounded in current VibePro artifacts and repository state, not a general impression.

## Operating Order

1. Confirm the target repository and current branch.
2. Initialize only when needed: `vibepro init <repo> --language ja`.
3. Before manually adding or editing human-facing VibePro artifacts, resolve the output language from `.vibepro/config.json` `output.language` or the explicit CLI `--language` override.
4. Select or create the Story before diagnosing or changing code.
5. Import Graphify context before impact-sensitive work: `vibepro graph <repo> --run-graphify`.
6. Diagnose and derive the repo context:
   - `vibepro story diagnose <repo> --id <story-id> --run-graphify`
   - `vibepro story derive <repo> --run-graphify`
   - `vibepro story map <repo>`
7. When the user asks for a purpose-level check, use diagnosis packages instead of guessing the scanner set:
   - `vibepro check list`
   - `vibepro check ui <repo>`
   - `vibepro check security <repo>`
   - `vibepro check performance <repo>`
   - `vibepro check architecture <repo>`
   - `vibepro check pr-readiness <repo> --base <ref> --head <ref>`
   - `vibepro check launch-readiness <repo>`
8. For performance improvement stories, define and record Story-level performance evidence before claiming speedups:
   - `vibepro performance define <repo> --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> --evidence-source <type>`
   - `vibepro performance record <repo> --id <story-id> --metric-id <id> --label before|after --status completed --duration-ms <ms> --evidence-source <type:ref:summary>`
   - `vibepro performance compare <repo> --id <story-id>`
9. For existing UI modernization, derive the product-local Design System before screen implementation:
   - Run Graphify first when available: `vibepro graph <repo> --run-graphify`.
   - Run `vibepro design-system derive <repo> --id <ds-id> --product <name> --routes <csv> --brief <text> --from-code`.
   - Review `.vibepro/design-system/<ds-id>/evidence-coverage.json` and `ds-gate.json` before accepting the DS as an implementation constraint.
   - Treat `.vibepro/design-system/<ds-id>/design-system.json`, `semantic-tokens.json`, `component-roles.json`, `component-states.json`, `screen-patterns.json`, `cta-policy.json`, `density-policy.json`, `navigation-policy.json`, `anti-patterns.json`, and `implementation-mapping.json` as product-local DS evidence.
10. For screen-level UI modernization, create the story-specific design decision space before screen implementation:
   - `vibepro design-modernize derive-system <repo> --id <story-id> --product <name> --routes <csv> --brief <text>`
   - `vibepro design-modernize plan <repo> --id <story-id> --product <name> --routes <csv> --base-url <url>`
   - Treat `.vibepro/design-modernize/<story-id>/derived-design-system.json`, `design-modernize.json`, and `ds-gate.json` as implementation constraints.
   - External Design System bundles, screenshots, and image-generated ideas are visual hypotheses. The VibePro-derived Design System, current UI evidence, Story/Spec, and Gate DAG remain authoritative.
11. Plan work from VibePro evidence: `vibepro story plan <repo>`.
12. Create task context before implementation: `vibepro task create <repo> --from-plan --id <story-id>`.
13. After code changes, run `vibepro pr prepare <repo> --story-id <story-id>`.
14. Read `.vibepro/pr/<story-id>/pr-prepare.json` `gate_status` before treating work as PR-ready.
15. If `gate_status.agent_review_instruction` is present, Agent Review is mandatory. Treat the generated review plan as an instruction to dispatch Codex/Claude Code subagents when the coordinator runtime provides subagent capability. Do not convert it into a user-permission wait or silently skip it.
16. Run parallel subagent review:
   - Run each listed `vibepro review prepare <repo> --id <story-id> --stage <stage>`.
   - Open the generated `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md`.
   - Start the listed Codex/Claude Code subagents in parallel, one role per subagent.
   - After each subagent returns, close/shutdown that review subagent before recording the result. Do not leave review subagents running.
   - Record every result with `vibepro review record` and include subagent provenance plus closed lifecycle evidence:
     - Codex: `--agent-system codex --execution-mode parallel_subagent --agent-id <spawned-agent-id> --agent-closed` plus `--agent-thread-id` or `--agent-call-id` when available.
     - Claude Code: `--agent-system claude_code --execution-mode parallel_subagent --agent-id <task-or-subagent-id> --agent-closed` plus `--agent-session-id` or `--agent-transcript` when available.
   - Rerun `vibepro pr prepare` and continue only after `gate:agent_review` passes.
   - If the runtime cannot spawn subagents, block or record a human waiver decision; manual review records do not satisfy required Agent Review Gate.
17. Open `review-cockpit.html` first, then deep-dive into `gate-dag.html`, `split-plan.html`, and `pr-body.md`.
18. Use `vibepro pr create`; do not bypass VibePro with raw `gh pr create`.

## Human Artifact Language

- Human-facing Story, Journey, Architecture, Spec, Task, Review, Diagnosis, and PR artifacts should be written in the resolved output language.
- Preserve machine-facing identifiers exactly: JSON keys, schema names, enums, Story IDs, Gate IDs, DAG node IDs, task IDs, role IDs, commands, file paths, package names, and external tool names.
- Preserve user-provided text and external evidence text unless the artifact explicitly asks for translation or localization.
- When CLI-generated artifacts are incomplete and the agent fills them manually, match the repository language policy instead of defaulting to English.

## Managed Worktree Status

- Recent VibePro Story / Spec / Architecture documents define a future managed worktree Execution DAG, but this is not evidence that the installed CLI already creates, reuses, or enforces managed worktrees.
- Do not claim VibePro created a worktree unless a real command result records that state.
- Until `vibepro execute start` actually reports managed worktree creation or reuse, create normal git worktrees manually when isolation is needed, and keep implementation, verification, review, PR preparation, and PR creation in that isolated worktree.
- When a future VibePro CLI reports managed worktree state, prefer that state and run the rest of the VibePro flow from the reported worktree.

## Guardrails

- Do not treat VibePro diagnosis as truth by itself. Verify with code, tests, runtime logs, or product behavior.
- Do not patch graph-sensitive runtime, auth, data, or UI state-machine code before checking Graphify impact.
- Do not skip Story -> Architecture -> Spec ordering when the task is a refactor.
- Do not treat `scope.status=reviewable` as completion approval. It is PR size/scope guidance only.
- Do not ignore unresolved Gates. Add evidence, split the PR, block, or record a waiver reason.
- Do not waive critical unresolved Gates with a reason alone. Critical Gates require evidence closure or a split/block decision.
- Do not treat Agent Review Gate as optional. When it is unresolved, the coordinator must prepare, dispatch, record, and rerun the VibePro review flow before calling the work complete.
- Do not record a passing Agent Review result without Codex/Claude Code parallel subagent provenance and closed lifecycle evidence (`--agent-closed`). Manual `pass` records are audit notes, not enough to satisfy `gate:agent_review`.
- Keep JSON artifacts as the machine-readable source of truth. HTML is the human control plane.
- Do not claim user-perceived performance improvement from server logs alone. Use a separate `user_perceived` metric backed by `browser_e2e`, `client_marker`, or `manual_observation`.
- Do not mix server readiness, API completion, DOM visibility, snapshot visibility, and interactive readiness as the same completion condition. Define them as separate metrics.
- Do not treat type-check or a superficially rendered UI as enough when UI code introduces `/api/...` calls. Network Contract Gate requires matching Next.js routes and network-aware flow evidence for API 4xx/5xx.
- Do not treat Story-level E2E existence as enough for UI-heavy changes. Clickable-looking controls on the changed screen need an interaction contract: save/mutate, visible state change, navigation, scroll/focus, disabled, or explicit unfinished state.
- Do not skip `design-system derive` for existing products that need a reusable DS. Screen-level modernization should not invent product semantics when current routes, CTAs, states, style tokens, or Graphify evidence can define them.
- Do not treat `.vibepro/design-system/<ds-id>/design-system.json` as complete unless `evidence-coverage.json` and `ds-gate.json` are reviewed. Missing Graphify/style evidence may be a warning; missing semantic roles or implicit fallback is a design gate problem.
- Do not implement a generated design proposal directly. For UI modernization, first verify the current route, information architecture, CTA priority, state behavior, and data dependencies against the Derived Design System and `ds-gate.json`.
- Do not let `ds-gate.json` fall back implicitly. If DS drift, component role, composition, visual hypothesis, or anti-pattern clauses are missing, treat the design-modernize evidence as incomplete.

## Git / Worktree Dirty Guardrails

- Do not use `git stash`, `git restore`, `git reset`, or checkout changes as the first response to a dirty repository worktree. First classify the dirty state.
- Before cleaning dirty state, record:
  - `git status --short --branch`
  - `git diff --name-status`
  - `git diff --cached --name-status`
  - `git diff --stat`
  - `git diff --cached --stat`
  - `git reflog --date=iso -8 HEAD`
  - `git reflog --date=iso -8 <current-branch>`
- If a checked-out branch moved via an external sync, merge, rebase, or another worktree, verify whether the dirty diff is a stale reverse diff before treating it as user work.
- A stale reverse diff is likely when the branch reflog advanced from an old commit to `HEAD`, while `git diff --cached` or `git diff` is exactly the inverse of the commits between that old commit and `HEAD`.
- Prove this before cleanup by comparing the dirty diff with the commit range, for example:
  - `git diff --stat <old-commit> HEAD`
  - `git diff --stat HEAD <old-commit>`
  - `git diff --name-status <old-commit> HEAD`
  - `git diff --name-status HEAD <old-commit>`
- If the dirty state is a proven stale reverse diff, say so explicitly and then synchronize the worktree/index to `HEAD` with the least destructive command that resolves the observed state. Do not preserve it as a stash unless the user asks for archival.
- If the dirty state contains files or hunks that do not match the stale reverse diff, treat them as possible user work and do not clean them without reporting the exact files and asking for direction when needed.

## Common Rationalizations

- "The code looks done, so VibePro can be skipped." Reject this; VibePro readiness is based on Story/Spec/Architecture, verification evidence, Agent Review, and Gate DAG status.
- "The change is small, so no Story or evidence is needed." Small changes can still affect contracts, generated artifacts, and review gates.
- "Tests passed once, so PR readiness is proven." Tests must be current-head evidence and still need the relevant VibePro gates to close.
- "Manual review is enough for Agent Review Gate." Required Agent Review needs Codex/Claude Code parallel subagent provenance and closed lifecycle evidence unless a waiver is explicitly recorded outside the gate.
- "The PR body says it is verified." PR body text is not the source of truth; inspect `pr-prepare.json`, Gate DAG, and evidence artifacts.

## Red Flags

- `gate_status.ready_for_pr_create` is false or missing.
- `gate:agent_review`, `gate:artifact_consistency`, `gate:definition_of_done`, `gate:network_contract`, `gate:e2e`, or any critical required gate is unresolved.
- The answer cites HTML artifacts but not their JSON sidecars.
- Verification evidence predates the current git head or omits the changed path.
- Agent Review records have `manual_review` provenance where the gate required parallel subagents.
- Dirty worktree files are cleaned or hidden before they are classified.

## Verification

Before saying VibePro confirmed the work, name the exact VibePro command or artifact inspected, including `.vibepro/pr/<story-id>/pr-prepare.json` and the relevant Gate DAG node. For implementation work, rerun `vibepro pr prepare` after verification evidence and review records are updated, then confirm `gate_status.ready_for_pr_create=true` and `overall_status=ready_for_review`.

## Key Artifacts

- `.vibepro/stories/story-map.md`: repo Story map for human review.
- `.vibepro/stories/story-plan.md`: candidate work items.
- `.vibepro/pr/<story-id>/pr-prepare.json`: PR readiness source of truth; check `gate_status`.
- `.vibepro/pr/<story-id>/review-cockpit.html`: first screen for human decision.
- `.vibepro/pr/<story-id>/human-review.json`: machine-readable human decision template.
- `.vibepro/pr/<story-id>/gate-dag.html`: Gate dependency view.
- `.vibepro/pr/<story-id>/split-plan.html`: split lanes and Graphify investigation scope.
- `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md`: required parallel subagent dispatch instructions when Agent Review Gate is unresolved.
- `.vibepro/checks/<pack>/<run-id>/check.json`: purpose-level diagnosis package evidence.
- `.vibepro/checks/<pack>/<run-id>/check.md`: human-readable diagnosis package report.
- `.vibepro/checks/ui/<run-id>/check.json`: UI check evidence, including `flow_design.interactive_contract_hits`.
- `.vibepro/pr/<story-id>/performance-runs/*.json`: Story-level performance evidence runs.
- `.vibepro/design-system/<ds-id>/design-system.json`: product-local Design System derived from current evidence.
- `.vibepro/design-system/<ds-id>/evidence-coverage.json`: route/style/Graphify/semantic coverage findings for the native DS.
- `.vibepro/design-system/<ds-id>/ds-gate.json`: explicit DS gate with fallback disabled.
- `.vibepro/design-system/<ds-id>/implementation-mapping.json`: route/component/file mapping for implementation handoff.
- `.vibepro/design-modernize/<story-id>/design-system-derivation.json`: product semantics and Derived Design System derivation.
- `.vibepro/design-modernize/<story-id>/derived-design-system.json`: semantic tokens, component roles, CTA hierarchy, anti-patterns, and visual hypothesis policy.
- `.vibepro/design-modernize/<story-id>/design-modernize.json`: screen modernization plan and Design Quality DAG.
- `.vibepro/design-modernize/<story-id>/ds-gate.json`: explicit DS drift and UX regression gate clauses.
