---
story_id: story-vibepro-recipe-preflight-autopilot
title: VibePro Recipe Preflight Autopilot Spec
parent_design: vibepro-recipe-preflight-autopilot
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        Autopilot["pr autopilot"] --> Preflight["preflight phase (first)"]
        Preflight --> Registry["recipe registry (ordered)"]
        Registry --> Detect["detection(repo state, story id)"]
        Detect -- auto_fix --> Fix["apply fix, record artifacts"]
        Detect -- next_command --> Suggest["record exact command + reason"]
        Detect -- not detected --> Skip["detected: false"]
        Fix --> Report["preflight section in autopilot report"]
        Suggest --> Report
        Skip --> Report
        Report --> Phases["existing autopilot phases (unchanged)"]
---

# Spec

## Public Contract

`pr autopilot` gains a preflight phase that runs first and reports a
`preflight` section:
`{ schema_version, results: [{ recipe_id, detected, action, action_taken,
artifacts, next_command }] }`. Six recipes ship initially:
`verify-status-artifact` (auto_fix), `generic-token-clause-binding`
(next_command), `architecture-reason-frontmatter` (next_command),
`followup-decision-artifact` (next_command), `design-diagrams-final-spec`
(next_command), `story-catalog-registration` (auto_fix). Gate semantics,
waiver rules, review lifecycles, and all existing autopilot phases are
unchanged.

## Contracts

### RPA-CONTRACT-001: Preflight never touches verdicts

Preflight MUST NOT create or mutate gate results, waivers, review lifecycle
records, or decision records. Its writes are limited to artifacts that
operators previously produced by hand with existing commands (verification
status artifacts, story catalog entries).

### RPA-CONTRACT-002: Auto-fix parity with manual artifacts

Every `auto_fix` output MUST be schema-compatible with its hand-made
counterpart and MUST be accepted by downstream checks at the same strength
(e.g. a generated status artifact makes the corresponding verify record
`strength: strong` exactly as a manual one does).

### RPA-CONTRACT-003: Deterministic, LLM-free detection

Recipe detections MUST be pure functions of on-disk repository state. They
MUST NOT perform network calls or LLM invocations.

### RPA-CONTRACT-004: No-op on clean stories

When none of the registered conditions hold, preflight MUST write nothing,
report `detected: false` for every recipe, and leave downstream autopilot
behavior identical.

### RPA-CONTRACT-005: Failure isolation

A recipe that throws during detection or fails during auto_fix MUST be
reported with `action_taken: "failed"` and MUST NOT abort preflight or the
autopilot run.

### RPA-CONTRACT-006: Open registry

Adding a recipe MUST require only appending a registry entry. The report MUST
list every registered recipe exactly once per run, in registry order.

## Scenarios

- `RPA-S-1`: Given a passing verify record without a status artifact, when
  preflight runs, then a status artifact is generated from the recorded exit
  code and the record's spine strength evaluates to `strong`.
- `RPA-S-2`: Given a record whose tokens are all generic and lack a contract
  clause ID, when preflight runs, then a `next_command` names the required
  clause ID binding.
- `RPA-S-3`: Given an architecture-gate story whose frontmatter lacks
  `reason:`, when preflight runs, then a `next_command` provides the
  four-element template (alternatives/compatibility/rollback/boundary).
- `RPA-S-4`: Given a followup decision recorded without `--artifact`, when
  preflight runs, then a `next_command` provides the artifact-included
  re-record command.
- `RPA-S-5`: Given a required diagram present only in a spec doc section but
  not in the final spec's `diagrams[]`, when preflight runs, then a
  `next_command` explains the final-spec requirement and the
  `spec write --final` step.
- `RPA-S-6`: Given a story id absent from `.vibepro/config.json`
  `brainbase.stories[]`, when preflight runs, then the entry is appended and
  echoed in the report, and `story diagnose` subsequently resolves the story.
- `RPA-S-7`: Given a story with none of the six conditions, when preflight
  runs, then no files change and all recipes report `detected: false`.
- `RPA-S-8`: Given a seventh registry entry added in a test, when preflight
  runs, then it executes after the existing six with no changes to them.

## Verification

- Focused tests cover each recipe's detection and action on synthetic
  repositories, the clean-story no-op, failure isolation, and registry
  extension.
- `npm run typecheck` and the full `npm test` suite pass with no new
  failures.
