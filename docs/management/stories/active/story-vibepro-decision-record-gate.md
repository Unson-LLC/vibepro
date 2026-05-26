---
story_id: story-vibepro-decision-record-gate
title: needs_review noise waiver secret exposure decisions must be recorded as VibePro artifacts
status: active
view: dev
period: 2026-W22
spec_ref: docs/specs/vibepro-decision-record-gate.md
reason: Existing PR Gate DAG and human review artifacts are extended without changing the public architecture boundary.
---

# Story: Decision Record Gate

## Background

VibePro findings can be resolved in conversation as "noise", "waived", or "handled", but conversational resolution is not durable evidence. This is especially risky for `needs_review` findings, waiver reasons, and secret exposure incidents because later agents cannot audit the decision from `.vibepro/` artifacts.

## User Value

As a VibePro operator or AI coordinator, I want every `needs_review` classification, noise decision, waiver, and secret exposure handling decision to be stored in machine-readable VibePro artifacts so PR readiness does not depend on chat memory.

## Acceptance Criteria

- [x] `vibepro decision record` stores decisions under `.vibepro/pr/<story-id>/decision-records.json`.
- [x] `noise` and `waiver` records require a reason.
- [x] `secret_exposure` records require location and handling action, and do not store raw secret values.
- [x] `vibepro decision status` summarizes recorded decisions.
- [x] `vibepro pr prepare` reads decision records, exposes them in `pr-prepare.json` and `human-review.json`, and writes/refreshes the artifact.
- [x] Open decision records appear as a blocking `Decision Record Gate` until classified.
