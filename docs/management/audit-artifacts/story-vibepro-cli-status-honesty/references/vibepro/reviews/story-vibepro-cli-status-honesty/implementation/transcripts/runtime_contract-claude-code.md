# implementation:runtime_contract review transcript

- role: runtime_contract
- agent_id: claude-code-runtime-contract-csh
- system: claude_code
- execution_mode: parallel_subagent
- head: 220a85803ddcf03fc495f0cac8f9e0d6ad716d99

## Inputs inspected
- src/merge-manager.js: JSON contract of pr-merge.json — status vocabulary gains merged_externally
  (terminal, exit code 0 via cli.js mapping: blocked->2, failed->1, else 0) and stop_reason
  pr_merged_externally_unverified (blocked, exit 2). merge_commit_sha/merged_at only set from the
  merged view; ancestor verification via existing gitIsAncestor helper against locally fetched
  origin/<base>. Reconcile reuses the identical post-merge pipeline (writePrMergeArtifacts,
  bindStoryTraceability, promoteCanonicalAuditArtifacts, persistCanonicalAuditToBase).
- src/cli.js exit-code mapping at execute merge handler (line ~1931): merged_externally -> 0. Verified.
- src/design-ssot.js: registry_summary computed via existing buildRegistrySummary over normalized
  roots of the just-written registry; snapshot artifact unchanged.
- Grepped consumers of pr-merge status across src/ (execution-state, canonical-audit, usage-report):
  no exhaustive switch; merged_at/merge_commit_sha based checks already treat the reconcile record
  as merged.

## Commands run
- node --test test/cli-status-honesty.test.js -> 4 pass (asserts contract fields exactly)
- npm run typecheck -> ok

## Lens: regression_guard / path_surface_coverage
- gh invocations unchanged in shape (buildPrViewArgs/buildMergeArgs); the reconcile adds one extra
  gh pr view with the same fields the merged path already used.
- Contract failure paths return written artifacts (audit trail) rather than throwing.

## Verdict
pass.
