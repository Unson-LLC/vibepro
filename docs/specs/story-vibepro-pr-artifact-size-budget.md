---
story_id: story-vibepro-pr-artifact-size-budget
title: VibePro PR Artifact Size Budget Spec
parent_design: vibepro-pr-artifact-size-budget
diagrams:
  - kind: flow
    mermaid: |
      flowchart LR
        Prepare["pr prepare emits full artifacts"] --> Stat["budget pass: stat each JSON artifact"]
        Stat -- within budget --> Full["handoff references full path (unchanged)"]
        Stat -- over budget --> Summary["write <name>.summary.json"]
        Summary --> Handoff["pr-body / parallel-dispatch reference summary"]
        Summary --> Budget["artifact_budget in pr-prepare.json"]
        FullArtifacts["full artifacts"] --> Gates["gate evaluation (always full)"]
---

# Spec

## Public Contract

`pr prepare` keeps emitting every existing artifact unchanged and adds a
budget pass. Configuration: `.vibepro/config.json`
`budgets.pr_artifact_bytes` (default `16384`). Over-budget JSON artifacts
gain a `<name>.summary.json` sibling; `pr-prepare.json` gains
`artifact_budget`; handoff documents reference summaries when they exist.
Gate evaluation always reads full artifacts.

## Contracts

### PAB-CONTRACT-001: Full artifacts are untouched

The budget pass MUST NOT modify, truncate, rename, or omit any full-fidelity
artifact. Gate evaluation inputs MUST be identical before and after this
change, and gate verdicts for a given repository state MUST NOT change.

### PAB-CONTRACT-002: Summary sibling shape

Each generated summary MUST include `schema_version`,
`kind: "artifact_summary"`, `source_artifact`, `source_bytes`,
`source_content_hash`, a `conclusion` object, `over_budget_reason`, and
`full_artifact_path`. The summary MUST be at most 10% of the source bytes.

### PAB-CONTRACT-003: Budget report

`pr-prepare.json` MUST include
`artifact_budget: { budget_bytes, over_budget: [{ artifact, bytes,
summary_path, summary_status }] }` listing exactly the emitted JSON artifacts
whose size exceeded the configured budget.

### PAB-CONTRACT-004: Handoff routing

When a summary exists for an artifact, `pr-body.md` artifact references and
`parallel-dispatch.md` read instructions MUST reference the summary path and
MUST NOT instruct inline reading of the full artifact; a pointer to the full
path for deep dives MUST remain. Within-budget artifacts keep their existing
references.

### PAB-CONTRACT-005: Failure degrades to full references

If summary generation fails for an artifact, `summary_status` MUST be
`failed` and handoff documents MUST fall back to the full path. A handoff
reference MUST never point at a nonexistent file.

### PAB-CONTRACT-006: Staleness detection

The summary MUST embed the source artifact's content hash so a mismatch
between summary and regenerated full artifact is detectable.

## Scenarios

- `PAB-S-1`: Given an emitted JSON artifact larger than the budget, when
  `pr prepare` completes, then `<name>.summary.json` exists with all
  PAB-CONTRACT-002 fields and is at most 10% of the source size.
- `PAB-S-2`: Given an artifact within budget, when `pr prepare` completes,
  then no summary sibling exists and handoff references are unchanged.
- `PAB-S-3`: Given over-budget artifacts, when `pr prepare` completes, then
  `artifact_budget.over_budget` lists each with its summary path and status.
- `PAB-S-4`: Given a summary exists, when `parallel-dispatch.md` is
  generated, then its read instruction references the summary path and keeps
  a deep-dive pointer to the full artifact.
- `PAB-S-5`: Given `budgets.pr_artifact_bytes` set in `.vibepro/config.json`,
  when `pr prepare` runs, then the configured value overrides the default.
- `PAB-S-6`: Given a summary generation failure, when `pr prepare` completes,
  then `summary_status` is `failed` and handoff references the full path.
- `PAB-S-7`: Given the same repository state, when gates are evaluated before
  and after this change, then gate verdicts are identical.

## Verification

- Focused tests cover over/within budget paths, summary shape and size
  bound, config override, dispatch reference switching, generation-failure
  fallback, and gate-verdict invariance on a synthetic story.
- `npm run typecheck` and the full `npm test` suite pass with no new
  failures.
