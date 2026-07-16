# Planning review #7 — product_requirement

- agent: codex/grs_planning7_product
- status: needs_changes
- inspected: current Story, Architecture, Spec, test plan, review request, evidence-reuse state

## Findings

1. `INV-001` required `authority_kind` but did not restrict it to `managed`, `repository`, or `source_fallback`, nor define unknown values as a nonmutating `invalid_state` failure.
2. The formal Spec lacked the `linked_copy_not_configured` exit-2, byte-preserving repair contract for `repository` and `source_fallback` Runs.

The reviewer confirmed that restart precedence, rejection of new Runs for pre-existing unavailable bindings, legacy status compatibility, repeated-cancel idempotence, managed-authority loss, and the broader threat boundary were otherwise consistent.
