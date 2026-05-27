---
title: VibePro README Configuration Reference Spec
status: draft
created_at: 2026-05-27
updated_at: 2026-05-27
related_stories:
  - story-vibepro-first-run-onboarding
---

# VibePro README Configuration Reference Spec

## Scope

The README must include a dedicated configuration reference for the repo-local `.vibepro/config.json` file.

## Requirements

- The English and Japanese README files describe that `vibepro init` creates `.vibepro/config.json`.
- The README files show a minimal config example containing `schema_version`, `tool`, `workspace`, `output.language`, and `brainbase.stories`.
- The README files explain the operational meaning of `output.language`, `brainbase.stories`, `brainbase.current_story_id`, Story-level `performanceMetrics`, and `flow_design`.
- The README files show the CLI path for common config changes: `vibepro config language` and `vibepro performance define`.
- The README files explain that `.vibepro/` is a local evidence workspace ignored by git by default, while durable Story / Spec / Architecture docs belong under `docs/`.

## Non-Goals

- No runtime behavior changes.
- No schema migration.
- No change to generated help text.
