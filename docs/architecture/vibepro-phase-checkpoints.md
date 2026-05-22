---
story_id: story-vibepro-phase-checkpoints
title: Phase Checkpoint Architecture
---

# Architecture

Phase checkpoint は既存の Gate DAG を正とし、別の品質判定系を増やさない。

`vibepro checkpoint <stage>` は内部で `preparePullRequest()` を呼び、`.vibepro/pr/<story-id>/gate-dag.json` と同じ判定材料を使う。
そのうえで stage ごとに見る gate subset と Agent Review stage を定義する。

## Stages

- `story`: Story / Architecture / Spec
- `implementation-start`: Story / Architecture / Spec / Requirement / planning_spec review / architecture_spec review
- `test-plan`: Story / Architecture / Spec / Requirement / test_plan review
- `implementation-complete`: Network / Requirement / Unit / Integration / E2E / Visual QA / implementation review
- `verification`: Network / Unit / Integration / E2E / Visual QA / gate review
- `pr`: all required Gate DAG nodes

## Exit Codes

- `0`: checkpoint passed
- `2`: checkpoint blocked by unresolved gates or review stages
- `1`: command or setup error

This keeps PR creation enforcement intact while allowing coding agents and CI jobs to stop earlier in the workflow.
