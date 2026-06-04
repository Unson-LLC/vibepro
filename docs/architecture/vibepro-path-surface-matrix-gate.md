---
title: Path Surface Matrix Gate Architecture
summary: "Adds a Gate DAG node that maps changed values/states to user, API, report, persistence, and review surfaces."
---

# Path Surface Matrix Gate Architecture

## Context

Recent reviews found evidence where data existed in one artifact but was not proven on report, HQ, PR body, or other user-facing surfaces.

## Design

`gate:path_surface_matrix` sits after Network Contract Gate and before Requirement Gate. It derives rows from changed files, Story text, and change classification surfaces.

Rows include surfaces such as:

- `ui`
- `api`
- `service`
- `worker`
- `review_surface`
- `persistence`

Workflow-heavy changes and directly changed UI/API/persistence/report surfaces require current verification evidence. Light changes may record non-critical rows without blocking.

## Evidence

The first implementation uses current verification and flow evidence text to determine whether a surface has been exercised. Future stories can replace this with typed evidence records and screenshot/content assertions.
