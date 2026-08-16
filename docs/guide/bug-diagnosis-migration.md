# Bug diagnosis migration

VibePro is the single workflow authority for bug fixes. The former Verify-first entry does not own a separate DAG.

## Register a bug Story

New Stories declare their contract when created:

```bash
vibepro story add . --id story-example-bug --title "Fix example failure" --contract-type bug_fix
vibepro story diagnose . --id story-example-bug --pre-architecture --run-graphify
```

For an existing Story, add `"contract_type": "bug_fix"` to its entry in `.vibepro/config.json`, then run `story diagnose`. The run creates `.vibepro/bug-diagnosis/<story-id>/<run-id>/bug-diagnosis.json`, bound to the Story, run, and Git HEAD.

## Record the ordered evidence

Use `vibepro bug diagnose record` in this order:

1. `failure_reproduced` with `--path-id`
2. `failure_localized`
3. `relationship_analysis`
4. `preconditions_confirmed`
5. `root_cause_confirmed`
6. `regression_test_failed_before_fix`
7. `root_fix_applied`
8. `same_path_reverified` with the same `--path-id`

Every passed node requires at least one `--evidence` reference and records the current HEAD. Choose only the relationship analyses needed for the failure from `data_flow`, `control_flow`, `async_flow`, `module_boundary`, and `change_history`. `relationship_analysis` may be `not_applicable` when no relationship analysis is needed. A regression test may also be `not_applicable` only with a concrete `--reason`.

Run `vibepro bug diagnose record --help` for the complete recording syntax. This
guide intentionally does not provide a copy-pasteable passing-evidence command:
the operator must supply evidence from the current Story run and HEAD.

New diagnosis artifacts are stored under
`.vibepro/bug-diagnosis/<story-id>/<run-id>/bug-diagnosis.json` and mirrored to
the worktree-independent process-record store after every successful record.
Manifest references to the former `.vibepro/diagnostics/...` location remain
readable for backward compatibility.

`pr prepare` persists incomplete diagnosis as `gate_status: blocked`, including `return_to_node` and `next_actions`. `pr create` refuses to create or refresh a PR until every required node is accepted. A passing unit test alone does not satisfy this contract.
If HEAD changes after the final diagnosis record, the evidence becomes stale and
`pr prepare` returns to `failure_reproduced`; rerun the diagnosis on the current HEAD.

## Verify-first compatibility entry

`vibepro verify-first` is deprecated. It emits a warning and invokes the same `story diagnose` implementation for a registered bug Story; it creates no independent evidence model or DAG.

| Former Verify-first phase | VibePro bug Story node |
|---|---|
| Reproduce | `failure_reproduced` |
| Localize | `failure_localized` |
| Analyze relations and preconditions | `relationship_analysis`, `preconditions_confirmed` |
| Confirm root cause | `root_cause_confirmed` |
| Add regression proof | `regression_test_failed_before_fix` |
| Apply root fix | `root_fix_applied` |
| Reverify | `same_path_reverified` |

Migrate automation to `story diagnose` and `bug diagnose record`. The compatibility entry is a removal candidate for the next major release after migration usage has been reviewed.
