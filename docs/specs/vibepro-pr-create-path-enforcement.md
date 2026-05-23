---
story_id: story-vibepro-pr-create-path-enforcement
title: PR Create Path Enforcement Spec
---

# Spec

- `vibepro pr create` remains the PR creation command that enforces Gate DAG.
- self-dogfood checks text artifacts for raw `gh pr create` guidance.
- Lines containing clear prohibition language such as `do not`, `never`, or `使わない` are ignored.
