## VibePro Codex Operating Rules

Use VibePro as the Story / Architecture / Spec / Graphify / Gate control plane for refactoring work.

When the user asks for VibePro work:

- Start from Story, then Architecture, then Spec, then Task, then Code, then Gate, then PR.
- Do not edit code first for VibePro refactors unless the user explicitly asks for an emergency fix.
- Use Graphify evidence before changing auth, data flow, runtime boundaries, UI state machines, or shared services.
- Treat `review-cockpit.html` as the human control plane and `human-review.json` as the machine-readable decision record.
- After implementation, run `vibepro pr prepare <repo> --story-id <story-id>` or the task-scoped equivalent.
- Do not call raw `gh pr create` directly for VibePro work. Use `vibepro pr create` so Gate evidence and waiver checks are preserved.
- If Gates are unresolved, either add evidence, split the PR, block the PR, or record an explicit waiver reason.
- Keep JSON outputs as source-of-truth artifacts and HTML outputs as human review artifacts.

For repository-local work, prefer the target repository's existing `AGENTS.md` instructions first, then apply these VibePro rules for VibePro-specific decisions.
