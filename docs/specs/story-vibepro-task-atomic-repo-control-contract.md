---
story_id: story-vibepro-task-atomic-repo-control-contract
title: Task-bound Atomic Repo-control Contract Spec
parent_design: vibepro-task-atomic-repo-control-contract
---

# Spec

## Contract

- `TAR-CONTRACT-001`: The independent repo-control unsafe signal MAY be cleared
  only for an explicitly selected Task whose typed repo-control groups exactly
  cover every changed independent repo-control path and every declared
  repo-control group is graph-connected to at least one non-repo-control group.
- `TAR-CONTRACT-002`: Missing Task context, duplicate groups, unknown
  dependencies, partial path coverage, extra changed repo-control paths, and
  disconnected repo-control groups MUST retain
  `unsafe_for_atomic_override: true`. Malformed canonical Task state MUST be
  rejected by `pr prepare --task` with repair guidance before scope assessment.
- `TAR-CONTRACT-003`: Path coverage MUST use exact repository-relative strings;
  it MUST NOT infer coverage from globs, basenames, prose, or acceptance text.
- `TAR-CONTRACT-004`: An eligible Task proof MUST persist Task ID, Task state
  path, covered paths, covering group IDs, and dependency edges in the scope
  evidence and split plan.
- `TAR-CONTRACT-005`: Task eligibility MUST NOT bypass Story atomic metadata,
  generated-lane coverage, current-HEAD reviewer ownership, verification
  evidence, Gate status, strict target validation, or VibePro PR creation.
- `TAR-CONTRACT-006`: No-Task behavior, the `.vibepro/config.json`-only
  exception, strict target validation, and ordinary unsafe repo-control
  splitting MUST remain compatible. A legacy Task whose groups declare no
  `classification` MUST remain loadable but ineligible; once any group declares
  `classification`, every group MUST satisfy the complete typed schema.

## Scenarios

- `TAR-SCENARIO-001`: Given a selected Task exactly covers a changed workflow in
  a repo-control group connected to a runtime group, when `pr prepare --task`
  assesses scope, then the mixed repo-control signal is reviewable and contains
  the typed Task proof.
- `TAR-SCENARIO-002`: Given the same Task but an additional changed workflow not
  listed in its repo-control group, when scope is assessed, then the signal
  remains unsafe.
- `TAR-SCENARIO-003`: Given exact coverage but no graph connection to any
  non-repo-control group, when scope is assessed, then the signal remains
  unsafe.
- `TAR-SCENARIO-004`: Given no selected Task, when scope is assessed, then the
  signal remains unsafe. Given malformed target groups in canonical Task state,
  when `pr prepare --task` loads the Task, then preparation is rejected with the
  configured state path and repair guidance rather than silently accepting an
  atomic scope.
- `TAR-SCENARIO-005`: Given a valid Task proof but missing Story atomic metadata
  or downstream review evidence, when PR readiness is evaluated, then atomic
  acceptance remains blocked.

## Verification

- Unit tests exercise the pure evaluator for exact coverage, malformed input,
  unknown dependencies, and connected-component behavior.
- CLI integration tests exercise `pr prepare --task` and machine-readable scope
  and split-plan evidence for the positive, uncovered-extra changed path,
  disconnected declared group, legacy untyped Task, malformed typed Task,
  config-only exception, and strict target-validation paths.
- Story E2E tests prove valid Task binding can remove only the repo-control
  unsafe reason while missing Story atomic metadata or current-HEAD review
  authority remains blocked.
