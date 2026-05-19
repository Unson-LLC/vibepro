## VibePro Codex Operating Rules

Use VibePro as the Story / Architecture / Spec / Graphify / Gate control plane for refactoring work.

When the user asks for VibePro work:

- Start from Story, then Architecture, then Spec, then Task, then Code, then Gate, then PR.
- Do not edit code first for VibePro refactors unless the user explicitly asks for an emergency fix.
- Use Graphify evidence before changing auth, data flow, runtime boundaries, UI state machines, or shared services.
- Treat `review-cockpit.html` as the human control plane and `human-review.json` as the machine-readable decision record.
- After implementation, run `vibepro pr prepare <repo> --story-id <story-id>` or the task-scoped equivalent.
- If `vibepro pr prepare` reports `gate_status.agent_review_instruction` or unresolved `gate:agent_review`, treat that as an explicit user instruction to use parallel subagents for VibePro review:
  - Run every listed `vibepro review prepare <repo> --id <story-id> --stage <stage>` command.
  - Open `.vibepro/reviews/<story-id>/<stage>/parallel-dispatch.md`.
  - Start the listed role reviews in parallel, one subagent per role, with no file edits.
  - Record each returned result with the listed `vibepro review record` command.
  - Rerun `vibepro pr prepare` and do not call the work complete until `gate:agent_review` passes or a blocking result is explicitly reported.
- Do not call raw `gh pr create` directly for VibePro work. Use `vibepro pr create` so Gate evidence and waiver checks are preserved.
- If Gates are unresolved, either add evidence, split the PR, block the PR, or record an explicit waiver reason.
- Keep JSON outputs as source-of-truth artifacts and HTML outputs as human review artifacts.
- When the user asks for a purpose-level check, use diagnosis packages instead of guessing low-level scanners:
  - `vibepro check list`
  - `vibepro check ui <repo>`
  - `vibepro check security <repo>`
  - `vibepro check performance <repo>`
  - `vibepro check architecture <repo>`
  - `vibepro check pr-readiness <repo> --base <ref> --head <ref>`
  - `vibepro check launch-readiness <repo>`
- For performance improvement claims, define and compare Story-level performance evidence:
  - `vibepro performance define <repo> --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> --evidence-source <type>`
  - `vibepro performance record <repo> --id <story-id> --metric-id <id> --label before|after --status completed --duration-ms <ms> --evidence-source <type:ref:summary>`
  - `vibepro performance compare <repo> --id <story-id>`
- Do not claim user-perceived speed improvement from server logs alone. Separate `server_side` metrics such as DB query/API readiness from `user_perceived` metrics such as DOM visible or interactive ready.
- If a performance comparison is not comparable, report improvement as unknown and include the missing marker or evidence source.
- For UI changes that introduce `/api/...` client calls, confirm the matching Next.js App Router or Pages Router route exists. Server Action/server function -> HTTP API replacements require route contract and network-aware E2E evidence; type-check alone is not enough.

For repository-local work, prefer the target repository's existing `AGENTS.md` instructions first, then apply these VibePro rules for VibePro-specific decisions.
