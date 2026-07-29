---
story_id: story-vibepro-linux-rollup-ci-lock
title: Make the VitePress lockfile installable on Linux CI
status: active
parent_design: vibepro-linux-rollup-ci-lock
reason: The macOS-generated npm lockfile records Rollup's Linux package only as a transitive optional dependency and omits its package entry, so npm ci on GitHub's Linux runner succeeds without installing the native binary and VitePress then crashes. Declaring the exact Linux binary as a root optional dependency keeps macOS installs portable, makes the Linux artifact explicit and lockfile-bound, changes no runtime API, and can be rolled back with the package metadata commit.
---

# Make the VitePress lockfile installable on Linux CI

## Intent

After every merged PR, the Linux GitHub runner can install the committed dependency graph and build the VitePress manual deterministically.

## Current reality

Post-merge run 29668367599 reached `Deploy VitePress manual`, but `npm ci` omitted `@rollup/rollup-linux-x64-gnu`. Rollup then raised `MODULE_NOT_FOUND` before VitePress could build.

## Acceptance criteria

- The root package metadata declares the exact Linux x64 GNU Rollup binary as an optional dependency.
- The committed lockfile contains a resolved package entry for that binary, not only Rollup's transitive optional-dependency name.
- Repository-relative Story links projected from PR release prose become absolute GitHub links so they cannot fail the public manual's dead-link gate.
- A regression test checks both sides of the install contract and the focused post-merge suite passes.

## Boundaries and rollback

- npm publication, Cloudflare authentication, and application runtime behavior are unchanged; release-note projection only normalizes repository docs links.
- Non-Linux installs may skip the platform-constrained optional package.
- Rollback removes the root optional dependency and its lockfile entry together.

## Done evidence

- Focused release tests, typecheck, and docs build pass.
- After merge, the post-merge workflow passes the VitePress build; any subsequent missing Cloudflare credential is reported as a separate external configuration blocker.
