Status: block

Summary: Current-head verification and strict HEAD bindings are fixed, but gate_evidence still cannot pass because summary-depth artifact hygiene remains contradictory: `gate-dag.json` is intentionally skipped/deleted, while `evidence-reuse.json` still advertises it as a review input and decision-bound blocking artifact.

Inspection summary: Confirmed HEAD `14f86966c0e556ecab8d18734282cd604387a9ca`; inspected review request, `pr-prepare.json`, traceability, evidence reuse, verification evidence, current autopilot flow/unit artifacts, review lifecycle artifacts, relevant source/tests, and story/spec/architecture docs.

Judgment delta: initial concern that the prior stale gate-dag and stale review blockers might now be resolved -> final block because the stale physical gate-dag was removed and verification is current, but downstream evidence surfaces still reference the missing skipped artifact.

Findings:
- critical: missing-referenced-gate-dag-artifact: `.vibepro/pr/story-vibepro-pr-evidence-autopilot/gate-dag.json` is absent and skipped under summary evidence depth, but `evidence-reuse.json` still lists it in `summary_artifacts.gate_dag`, `review_input_summary.preferred_order`, and `artifact_value_ledger.entries` as a decision-bound `blocking_surface`.
- high: summary-depth-output-surface-gap: The focused regression verifies stale full artifact removal, but not that `evidence-reuse` / review-input / artifact-ledger surfaces omit skipped artifacts, so the current tests pass while the broken reference remains.

Resolved previous findings:
- stale standalone gate-dag content: stale physical `gate-dag.json` is no longer present; manifest latest gate-dag/report are null for summary depth.
- current-head verification evidence: `verification-evidence.json` has all commands passing with strict-head binding to `14f86966c0e556ecab8d18734282cd604387a9ca`; current flow/unit autopilot artifacts also pass at that commit.
- evidence-reuse freshness: `evidence-reuse.json` is marked stale with `fresh_use_allowed=false` and `used_as_fresh=false`, so it is not being accepted as fresh.

Residual risks:
- Current `pr-prepare.json` still reports the previous gate_evidence review result as stale until this review is recorded and `pr prepare` is rerun.
