# Semantic Sufficiency Spec

Story: `story-vibepro-semantic-sufficiency` (Issue #533)

## Contract

`semantic_contract` is optional for backward compatibility. When present it
requires these six non-empty fields:

`semantic_owner`, `deterministic_owner`, `core_hypothesis`,
`strongest_counterexample`, `false_success_mode`, and `unknown_representation`.

It also requires definitions for `sufficient`, `relevant`, `directly_answers`,
`applicable`, `current`, `non_conflicting`, and `unambiguous`.

## Clause assessment

Each clause can declare `outcome_kind` (`internal_output`, `downstream_outcome`,
or `canonical_readback`) and `case_kind` (`positive`, `negative`, `ambiguous`,
`conflicting`, `stale`, or `unavailable`). Its optional
`semantic_evaluation` contains `answer_status`, the seven boolean-or-null
checks, `question_digest`, an answer (`derived_answer` or a selected normalized
choice), `supporting_record_ids`, relevance and applicability explanations,
finite confidence, and explicit conflict and freshness checks.

`resolved` is internally consistent only when the case is positive, every
check is `true`, the outcome kind is known, the supporting explanation fields
are complete, and at least one supporting record ID is present. Null remains
unknown. A counterexample is verified only when its concrete test file and case
can be resolved. `no_answer` and other unresolved declarations do not invalidate the
Spec. A missing contract produces `semantic_contract_missing` and an
unavailable semantic report while preserving legacy `validation.ok`.

## Verification

The focused regression fixture
`test/fixtures/semantic-sufficiency-result-unrelated.json` demonstrates that a
real result can exist while `supports_requested_claim` is false. The focused
test covers legacy compatibility, negative no-answer validity, resolved
consistency, positive-only counterexample warnings, and traceability outcome
coverage.
