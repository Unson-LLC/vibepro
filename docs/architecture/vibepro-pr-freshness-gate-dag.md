---
title: VibePro PR Freshness Gate DAG Architecture
status: draft
created_at: 2026-05-26
updated_at: 2026-05-26
related_stories:
  - story-vibepro-pr-freshness-gate-dag
---

# VibePro PR Freshness Gate DAG Architecture

The freshness gate belongs in `pr-manager.js` because PR body generation, Gate DAG construction, verification binding, and PR creation are coordinated there.

The gate uses local git refs after `git fetch origin` has updated them. VibePro does not fetch automatically inside `pr prepare`; it checks whether the currently resolved base ref is contained by the PR head. This keeps the check deterministic and avoids hidden network side effects.

`pr create` already calls `pr prepare`, so the generated PR body is recreated at runtime. The new gate makes the freshness precondition visible and blocks PR creation if the branch is stale relative to the base ref.
