---
story_id: story-vibepro-public-discovery-targeting
title: Public Discovery Targeting Architecture
status: draft
created_at: 2026-05-22
updated_at: 2026-05-22
---

# Public Discovery Targeting Architecture

## Intent

`vibepro check public-discovery` is a public AI-search/LLMO readiness check. It must not treat every file that renders UI as a public discovery target. The scanner first classifies route intent, then applies metadata/content rules only to applicable targets.

## Pipeline

| Stage | Responsibility | Output |
|------|----------------|--------|
| File Inventory | Collect candidate HTML/App Router/Pages Router/content files | `scanned_files` |
| Target Classification | Separate public SEO targets, utility pages, auth flows, private app routes, internal/dev routes, and verification files | `route_targets[]` |
| Metadata Context | Approximate Next.js App Router metadata inheritance from parent/root/route-group layouts | local/inherited/absent evidence |
| Finding Generation | Apply LLMO rules only to scanned public targets | finding groups |
| Suppression Application | Remove documented exceptions from active findings and keep them in a suppressed section | `suppressions` |

## Boundary Rules

- Verification files are exact artifacts and are skipped by default.
- Auth, private app, internal/dev, and noindex routes are skipped or downgraded by default.
- Parent metadata can satisfy page-level metadata findings.
- Documented suppressions are not silent; they require a reason and remain auditable.
- Unknown or stale suppressions are warnings because they may hide configuration drift.

## Non-Goals

- VibePro does not execute a crawler or render dynamic metadata.
- The App Router inheritance model is approximate and static.
- Private-app SEO checks require an explicit future opt-in story.
