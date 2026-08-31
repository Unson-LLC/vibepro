## VibePro Codex Operating Rules

Use VibePro as a small repository-local aid for keeping one accepted change connected from Story to Spec, implementation, verification, review, and PR handoff.

VibePro is not a workflow engine, merge authority, safety decision engine, agent sandbox, or evidence-collection game. Do not rebuild retired mechanisms through repository instructions.

The standard loop is:

> Story → Spec → implement → affected tests → one review wave → GitHub PR → CI → merge

When a repository uses VibePro:

- Start from one focused Story with one user-visible outcome and explicit acceptance criteria.
- Keep Program, roadmap, portfolio, and organization policy outside the Story. Link to their canonical source instead of copying them.
- Add or update an Architecture/ADR only when the accepted change materially alters a system boundary, ownership, data contract, security boundary, deployment model, or rollback strategy. Architecture is not a mandatory ceremony for every Story.
- Use `vibepro story diagnose <repo> --id <story-id> --run-graphify` only when code or graph evidence changes the implementation or test decision. Graphify is optional.
- Write the smallest Spec that makes the accepted behavior and invariants testable.
- During implementation, run only tests affected by the change. The full suite belongs in CI unless the change can only be proven by a local release rehearsal.
- Run at most one review wave after implementation is stable. Use no more than three independent roles in parallel and no more than five total review dispatches.
- A finding blocks only when it demonstrates an unmet acceptance criterion, security or tenant-boundary violation, data corruption/loss risk, unsafe changed release/rollback path, or inability of CI to validate the change.
- Fix a blocking finding and reverify only the affected surface. Treat that delta confirmation as part of the same review wave.
- Move every useful non-blocking finding to a follow-up Story or Issue instead of expanding the current Story.
- Treat reviewer timeout, empty output, wrong request, or execution failure as a review-system failure, not as a product defect.
- `vibepro pr prepare <repo> --story-id <story-id>` may generate a concise Story, Spec, verification, and review summary. Any legacy Gate, readiness, lifecycle, or stale-review projection in that output is informational only and must not create new work or block the PR.
- Open or refresh the PR through the repository's normal GitHub flow, including `gh pr create` where that is the repository convention. `vibepro pr create` is optional convenience, not required authority.
- Let CI run the full suite. Fix only failures caused by the proposed change.
- Merge only through the repository's normal review and permission boundary. VibePro does not authorize deploys, production writes, secret access, or external actions.

Do not use or require retired contracts such as:

- `vibepro execute start`
- managed worktree execution as a prerequisite
- a general-purpose Gate DAG
- `vibepro review authorize`, `review start`, `review close`, or `review repair`
- mandatory Agent Review Gate dispatch
- lifecycle or token-budget accounting
- automatic audit bundles
- raw `gh pr create` prohibition

For bug fixes, use the repository's current VibePro bug diagnosis contract when it applies, then return to the same minimal loop. For repository-local decisions, the target repository's own `AGENTS.md` remains authoritative; this managed block only defines VibePro-specific behavior.
