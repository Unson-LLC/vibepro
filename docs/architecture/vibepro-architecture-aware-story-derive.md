---
story_id: story-vibepro-architecture-aware-story-derive
title: Architecture-Aware Story Derive
status: draft
created_at: 2026-05-21
updated_at: 2026-05-21
---

# Architecture-Aware Story Derive

## Intent

`vibepro story derive` must infer a repository's architecture profile before promoting template-based product Stories. VibePro is a generic development harness, not a Web/SaaS-only tool. A repository can be a Next.js product, static site, API service, CLI, library, data pipeline, mobile app, or unknown system, and Story derivation must not assume one family without evidence.

## Boundary

The Story derivation pipeline has three separate responsibilities.

| Component | Responsibility | Must Not Do |
|----------|----------------|-------------|
| Repo Profile | Classify the repository shape from files, package metadata, framework evidence, language mix, and graph paths | Infer product capabilities from isolated words such as `session` or `notification` |
| Preset Applicability | Decide whether a preset family can promote template Stories as validated Stories | Apply Web/SaaS product templates to non-Web repositories by default |
| Story Promotion | Emit validated Stories only when code/doc evidence matches the Story domain | Present suppressed templates as `story_cluster (N paths)` evidence |

## Repo Profiles

VibePro starts with a lightweight profile for Story derivation. The profile is intentionally coarse; it gates template promotion rather than replacing deeper architecture diagnosis.

| Profile | Evidence Examples | Product Surface Stories |
|---------|-------------------|-------------------------|
| `next-app` | `next` rendering, `app/**/page.tsx`, `app/**/route.ts`, `next.config.*` | Allowed by default |
| `web` | frontend framework, static site, UI component entrypoints | Allowed by default when evidence is Web-specific |
| `api-service` | API route/server/router paths without frontend product surface | Not allowed by default |
| `python-cli` | Python source / CLI entrypoints without Web evidence | Not allowed by default |
| `data-pipeline` | Python scripts, ETL/cron/backtest style paths | Not allowed by default |
| `library` | source library without product runtime surface | Not allowed by default |
| `unknown` | insufficient evidence | Not allowed by default |

## Preset Policy

- Explicit `--preset <id>` or repo-local `story_catalog.preset` is an operator decision and is honored for backwards compatibility.
- Without an explicit preset, VibePro may still select the default preset for coverage/classification compatibility, but template product Stories pass through applicability gates before promotion.
- If a template matches only weak token evidence and the repo profile does not support that product surface, VibePro suppresses the Story and emits `needs_domain_confirmation`.
- Document evidence for the target domain can promote a Story because the operator has provided domain context in the repository.

## Story Map Output

`story-catalog.json` and `story-map.md` must expose:

- selected preset and whether it was `auto` or `explicit`
- repo profile id, confidence, and evidence
- warning entries for suppressed template Stories
- enough suppressed Story metadata for a user to decide whether to rerun with `--preset`

This keeps the user-facing distinction clear: validated Stories are evidence-backed, while suppressed templates are candidate context that requires domain confirmation.
