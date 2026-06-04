---
title: Failure Mode Coverage Gate Architecture
summary: "Adds a PR Gate DAG node that derives likely failure modes from Story, Spec, risk surfaces, and changed files."
---

# Failure Mode Coverage Gate Architecture

## Context

Recent reviews found that happy-path or marker tests could pass while timeout, parser, schema, provider, retry, auth, or persistence failure paths were not executable evidence.

## Design

`gate:failure_mode_coverage` sits between Requirement Gate and Decision Record Gate. It derives candidate failure modes from Story text, inferred Spec clauses, changed-file paths, and change classification risk surfaces.

The gate is risk-adaptive:

- Light changes can list candidates without blocking.
- Workflow-heavy or high-risk surfaces require current verification evidence for each candidate mode.
- Static source mentions alone do not satisfy coverage.

## Evidence

The gate reads current-bound verification evidence. Evidence is matched by command, summary, artifact, and kind text. A later story can replace this keyword matching with typed evidence records.

## Boundary

This gate does not decide whether Unit, Integration, or E2E suites passed. It decides whether the passed evidence names and exercises the relevant failure behavior.
