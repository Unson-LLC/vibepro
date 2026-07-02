---
story_id: story-vibepro-downstream-diagram-preflight
title: PR prepare should surface downstream diagram requirements for authority and contract artifacts
source_issue: https://github.com/Unson-LLC/vibepro/issues/269
parent_design: vibepro-downstream-diagram-preflight
architecture_docs:
  - docs/architecture/vibepro-downstream-diagram-preflight.md
spec_docs:
  - docs/specs/vibepro-downstream-diagram-preflight.md
---

# Story: PR prepare should surface downstream diagram requirements for authority and contract artifacts

## Background

Authority and contract artifacts can make `gate:design_diagrams` require a
`threat_model`, but the current operator experience discovers the requirement
late and without enough insertion guidance. `pr prepare` must surface the
downstream diagram requirement while it is already reporting PR readiness gates.

## Ideal State

When a change adds responsibility-authority artifacts or security-sensitive
contract artifacts, `vibepro pr prepare` proactively names the required diagram
kind, the file path that triggered it, and the spec insertion target before the
operator spends time refreshing unrelated evidence.

## Current Gap

`gate:design_diagrams` can compute missing diagrams, but the unresolved gate
summary and next required actions collapse the result to a generic message. The
authority path also relies on broad security substring matching rather than an
explicit responsibility-authority rule.

## Requirement Sources

- The resolver must add an explicit `RESPONSIBILITY_AUTHORITY_PATH.test(p)`
  branch so `docs/responsibility-authority/**/*.json` additions are not hidden
  behind generic security substring matching.
- The resolver must inspect contract artifact path/content terms so
  `docs/contracts/**/*.json` and `contracts/**/*.json` additions only require a
  `threat_model` when they contain authority or security-sensitive terms.
- Existing webhook route detection such as `/webhook(s)?/` remains part of the
  unchanged diagram resolver behavior and must continue to pass regression
  coverage while the authority/contract branches are added.

## Acceptance Criteria

- `vibepro pr prepare` reports downstream diagram requirements for changed
  `docs/responsibility-authority/**/*.json` artifacts.
- `vibepro pr prepare` reports downstream diagram requirements for changed
  `docs/contracts/**/*.json` or `contracts/**/*.json` artifacts containing
  authority or security-sensitive terminology.
- The report includes the triggering file path and required diagram kind.
- The report includes the expected insertion target for
  `.vibepro/spec/<story>/spec.json diagrams[]` and tracked Spec doc guidance.
- The report includes minimal valid Mermaid shape guidance for the required
  diagram.
- Tests cover responsibility-authority and contract additions that require
  `threat_model`.
