---
story_id: story-vibepro-manual-control-plane-refresh
title: VibePro Manual Control Plane Refresh Architecture
---

# Architecture

## Decision

The public manual is a curated product surface, not a projection of every
repository document. It will present one complete guarded delivery model in
English and Japanese, generate its CLI contract from the shipped help output,
identify the source commit at build time, and exclude internal engineering
corpora from public route generation.

## Boundaries

- `src/cli.js` and `bin/vibepro.js` remain the command-contract authority.
- `scripts/generate-cli-reference.mjs` projects each language's current Usage
  section into public reference pages; `--check` is a fail-closed drift gate.
- `docs/guide`, `docs/ja/guide`, and `docs/reference` are curated public source.
- Story, Architecture, Spec, contract, playbook, marketing, frame, and runtime
  corpora remain repository-local and are excluded by VitePress `srcExclude`.
- `docs/.vitepress/config.mjs` owns public navigation, discovery metadata,
  sitemap generation, and build-source provenance.
- `package.json`, npm registry state, Git commit, deployed manual commit, and
  local `.vibepro/` artifacts are distinct release/evidence authorities.

## Flow

```mermaid
flowchart LR
  Help["Shipped CLI help"] --> Generator["CLI reference generator"]
  Generator --> En["English reference"]
  Generator --> Ja["Japanese reference"]
  Curated["Curated guide and reference"] --> Build["VitePress public build"]
  Internal["Story / Architecture / Spec / contracts"] -. "srcExclude" .-> Build
  Commit["CF_PAGES_COMMIT_SHA or Git HEAD"] --> Build
  Public["robots / llms / sitemap / social metadata"] --> Build
  Build --> Site["Public manual"]
```

## Compatibility and Rollback

No CLI or artifact schema changes are introduced. Existing public guide URLs
remain available, while new routes are additive. Internal routes intentionally
stop building. The production rollback authority is the last known-good
Cloudflare Pages production deployment: an operator restores it from **Workers
& Pages → vibepro → Deployments → Rollback to this deployment** and verifies the
restored public contract. This remains usable when the known-good Git commit
predates the guarded deploy command. Reverting or repairing source and issuing a
new guarded deployment is the follow-up corrective path, not the emergency
rollback path. If build provenance is unavailable, the footer reports `unknown`
rather than claiming a commit.

## Release Operations

- Release note: `CHANGELOG.md` records this public-manual contract refresh.
- Rollout plan: deploy only from a clean merged commit with
  `npm run docs:deploy`; the script builds, validates, and passes the exact
  commit hash to Cloudflare Pages.
- Observability evidence: verify the English and Japanese roots, a
  representative guide route, required discovery files, social metadata, and
  `vibepro-source-commit` after deployment.
- Rollback instruction: restore the last known-good successful production
  deployment through the Cloudflare Pages Deployments dashboard, repeat the
  live checks, and record both failed and restored deployment URLs and commit
  provenance. Repair or revert source separately before a later guarded deploy.
