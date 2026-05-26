---
title: VibePro PR Freshness Gate DAG Spec
status: draft
created_at: 2026-05-26
updated_at: 2026-05-26
related_stories:
  - story-vibepro-pr-freshness-gate-dag
---

# VibePro PR Freshness Gate DAG Spec

## Gate

`vibepro pr prepare` MUST emit a required node:

```json
{
  "id": "gate:pr_freshness",
  "type": "pr_freshness_gate",
  "status": "passed | needs_rebase | needs_evidence"
}
```

## Pass Condition

`gate:pr_freshness` passes when the resolved base ref SHA is the merge-base of the PR head and base ref. In git terms:

```bash
git merge-base <base-ref> <head-ref> == git rev-parse <base-ref>
```

This means the PR branch contains the currently resolved base ref.

## Blocking Condition

If the base ref is not contained by the PR head, the gate status is `needs_rebase` and it is critical. `vibepro pr create` MUST fail until the branch is refreshed and `pr prepare` is regenerated.

## Required Actions

The unresolved gate MUST tell the user to:

- `git fetch origin`
- rebase the branch onto the current base ref
- rerun verification evidence for the rebased HEAD
- rerun `vibepro pr prepare`
