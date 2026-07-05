# gate_evidence Review 019f31cc

Status: block

Current HEAD: 5980aeb9365b90e9f4f4fa786481fc3f0dcfb180

Findings:

1. critical gate-evidence-review-result-is-stale-post-commit
   - Concerns: evidence_freshness, gate_binding
   - Detail: Current pr-prepare still reports overall_status=needs_verification and ready_for_pr_create=false because the recorded gate_evidence review result is bound to parent HEAD 677d607d72f600d0ebec2b8d77c403bc390a3041 with dirty=true and content_binding.status=unbound. Prior pass cannot be accepted as current gate evidence.

2. high artifact-consistency-and-review-preflight-block-the-gate
   - Concerns: gate_binding, evidence_freshness
   - Detail: Current gate execution state has blocking_gate_count=4. review:dispatch_batch:gate and review:preflight:gate:gate_evidence are blocking, and gate:artifact_consistency is stale_evidence until the gate_evidence review is refreshed and recorded against current clean HEAD.

3. medium traceability-remains-weakly-mapped
   - Concerns: path_surface_coverage, regression_guard, gate_binding
   - Detail: Current traceability reports mapped_count=0 and weakly_mapped_count=7, with mapped_tests and mapped_evidence empty for acceptance criteria. Command/test evidence exists, but current artifacts do not bind it clause-by-clause.

4. medium evidence-reuse-freshness-is-stale-despite-a-passed-freshness-node
   - Concerns: evidence_freshness, gate_binding
   - Detail: evidence-reuse.json says status=stale, fresh_use_allowed=false, and used_as_fresh=false, while gate-dag marks gate:evidence_reuse_freshness as passed. This is not the main blocker because stale reuse was not used as fresh, but the gate presentation is misleading for freshness review.

Non-blocking observations:

- Command reliability and regression_guard implementation are present: autopilot only skips records whose binding.status is current, and tests cover dry-run, skip-current, and rerun-stale behavior.
- Verification command artifacts for unit/e2e/integration/typecheck are content-bound current in gate-dag, but they do not rescue the stale gate_evidence review artifact.
