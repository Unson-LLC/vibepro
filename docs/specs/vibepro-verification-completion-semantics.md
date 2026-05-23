---
story_id: story-vibepro-verification-completion-semantics
title: Verification Completion Semantics Spec
---

# Spec

- `vibepro verify record` records command evidence only.
- `vibepro pr prepare` recalculates Gate DAG after evidence changes.
- A Story with `verification-evidence.json` but no `gate-dag.json` is not complete.
- A Story with `gate-dag.overall_status != ready_for_review` is not complete.
