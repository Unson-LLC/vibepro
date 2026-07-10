## VibePro Codex Operating Rules

Use VibePro as the Story / Architecture / Spec / Graphify / Gate control plane for refactoring work.

When the user asks for VibePro work:

- Start from Story, then Architecture, then Spec, then Task, then Code, then Gate, then PR.
- Do not edit code first for VibePro refactors unless the user explicitly asks for an emergency fix.
- Prefer `vibepro execute start <repo> --story-id <id>` for isolated execution; it creates or reuses a managed worktree and records that state. Create branches only from inside the target worktree.
- Read `vibepro pr prepare --summary-json` or a limited `--view <readiness|blocking-gates|gate-evidence|traceability|design-ssot|senior-gap>` before opening full JSON artifacts.
- For evidence recording rules, review lifecycle order (`prepare` → `start` → dispatch → `close` → `record --agent-closed --inspection-input <ref>`), spec write validators, and gate troubleshooting, follow the `vibepro-gate-evidence` Skill.
- After merge, close the audit loop when asked about traceability, cost, or ROI: `vibepro audit replay`, `vibepro audit session-cost`, `vibepro trace backfill|declare`, `vibepro usage report --subagent-roi --gate-roi`.
- For intent-first UI/UX work, use `vibepro uiux intake template|validate` → `uiux map` → `uiux evidence` → `uiux prepare` before implementation.
- Use Graphify evidence before changing auth, data flow, runtime boundaries, UI state machines, or shared services.
- Treat `review-cockpit.html` as the human control plane and `human-review.json` as the machine-readable decision record.
- After implementation, run `vibepro pr prepare <repo> --story-id <story-id>` or the task-scoped equivalent.
- If `vibepro pr prepare` reports `gate_status.agent_review_instruction` or unresolved `gate:agent_review`, treat Agent Review as mandatory. The generated review plan is an instruction to dispatch Codex/Claude Code subagents when the coordinator runtime provides subagent capability; do not convert it into a user-permission wait or silently skip it.
- Run the parallel review workflow:
  - Run every listed `vibepro review prepare <repo> --id <story-id> --stage <stage>` command.
  - Open `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md`.
  - Start the listed role reviews in parallel, one subagent per role, with no file edits.
  - When each subagent returns, close/shutdown that subagent thread before recording the result. Do not leave review subagents running.
  - Record each returned result with the listed `vibepro review record` command, including Codex provenance and lifecycle evidence: `--agent-system codex --execution-mode parallel_subagent --agent-id <spawned-agent-id> --agent-closed` and `--agent-thread-id` or `--agent-call-id` when available.
  - Rerun `vibepro pr prepare` and do not call the work complete until `gate:agent_review` passes or a blocking result is explicitly reported.
  - If the runtime cannot spawn subagents, block or record a human waiver decision; manual review records do not satisfy required Agent Review Gate.
- Do not record a passing Agent Review as if it came from a subagent unless a subagent was actually spawned. A `pass` without Codex/Claude Code provenance is intentionally kept from satisfying `gate:agent_review`.
- Do not call raw `gh pr create` directly for VibePro work. Use `vibepro pr create` so Gate evidence and waiver checks are preserved.
- If Gates are unresolved, either add evidence, split the PR, block the PR, or record an explicit waiver reason.
- Keep JSON outputs as source-of-truth artifacts and HTML outputs as human review artifacts.
- When the user asks for a purpose-level check, use diagnosis packages instead of guessing low-level scanners. Run `vibepro check list` for the current registry, then `vibepro check <pack> <repo>`. Registered packs include `ui`, `security`, `performance`, `architecture`, `pr-readiness` (`--base <ref> --head <ref>`), `launch-readiness`, `agent-harness`, `public-discovery`, `self-dogfood`, `oss-readiness`, `regression-risk`, and `all`.
- For performance improvement claims, define and compare Story-level performance evidence:
  - `vibepro performance define <repo> --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> --evidence-source <type>`
  - `vibepro performance record <repo> --id <story-id> --metric-id <id> --label before|after --status completed --duration-ms <ms> --evidence-source <type:ref:summary>`
  - `vibepro performance compare <repo> --id <story-id>`
- Do not claim user-perceived speed improvement from server logs alone. Separate `server_side` metrics such as DB query/API readiness from `user_perceived` metrics such as DOM visible or interactive ready.
- If a performance comparison is not comparable, report improvement as unknown and include the missing marker or evidence source.
- For UI changes that introduce `/api/...` client calls, confirm the matching Next.js App Router or Pages Router route exists. Server Action/server function -> HTTP API replacements require route contract and network-aware E2E evidence; type-check alone is not enough.
- Before cleaning dirty repository worktrees, inspect the dirty state instead of stashing by reflex:
  - Run `git status --short --branch`, `git diff --name-status`, `git diff --cached --name-status`, `git diff --stat`, `git diff --cached --stat`, and relevant `git reflog --date=iso`.
  - If an external sync, merge, rebase, or another worktree advanced a checked-out branch, compare the dirty diff with the inverse of the commit range that moved the branch.
  - Treat it as safe cleanup only after proving it is a stale reverse diff already represented in `HEAD`; otherwise report the files as possible user work.

For repository-local work, prefer the target repository's existing `AGENTS.md` instructions first, then apply these VibePro rules for VibePro-specific decisions.
