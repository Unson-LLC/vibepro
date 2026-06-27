# Gates and Evidence

VibePro gates decide whether a PR is ready to create or merge. They require current evidence, not just plausible explanations.

Common statuses:

- `passed`: Required evidence exists and matches the current change.
- `needs_evidence`: A required verification, artifact, review, or decision record is missing.
- `needs_review`: Human or agent review is still required.
- `blocked`: A condition must be fixed or explicitly waived.
- `waived`: A recorded decision accepts the remaining risk.

## Impact Context Is Supporting Evidence

Graphify and `codebase-memory-mcp` can reveal related files, routes, symbols, call paths, and risk hints. VibePro can use those signals to activate Engineering Judgment axes such as `execution_topology`, `public_contract`, `security_boundary`, `data_state`, and `scope_reviewability`.

Those signals do not close the required evidence for runtime behavior, security correctness, rollback safety, user experience, migrations, or release operations. Use them to decide what to inspect and test next.
