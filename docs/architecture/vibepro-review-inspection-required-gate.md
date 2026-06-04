---
title: Review Inspection Required Gate Architecture
summary: "Adds a PR Gate DAG node that requires inspection summary and evidence for high-risk recorded reviews."
---

# Review Inspection Required Gate Architecture

## Context

VibePro can record inspection summaries and evidence, and gate evidence pass already requires a summary. High-risk review outcomes still need a PR Gate check that proves the recorded review included concrete inspection evidence.

## Design

`gate:review_inspection_required` sits after Agent Review and before Artifact Consistency. It inspects current Agent Review summaries and recorded role artifacts.

For high-risk routes, each recorded review role must include:

- `inspection.summary`
- `inspection.evidence`

The gate is route-adaptive. Light changes do not become blocked solely because a role omitted inspection evidence.

## High-Risk Inputs

The first implementation treats workflow-heavy profiles, security/trust, release, data, business, API, infra, auth, persistence, runtime, and deploy surfaces as high-risk.
