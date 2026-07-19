---
story_id: story-vibepro-linux-rollup-ci-lock
status: final
parent_design: vibepro-linux-rollup-ci-lock
code_refs:
  - package.json
  - package-lock.json
  - scripts/post-merge-release.mjs
test_refs:
  - test/post-merge-release.test.js
---

# Linux Rollup CI lock specification

## LRCL-001 Root install contract

The root package must declare `@rollup/rollup-linux-x64-gnu` at the exact Rollup version as an optional dependency.

## LRCL-002 Lockfile artifact contract

The lockfile must contain a resolved `node_modules/@rollup/rollup-linux-x64-gnu` package entry with Linux and x64 platform constraints.

## LRCL-003 Compatibility contract

The dependency remains optional so npm can skip it on incompatible platforms without changing VibePro runtime behavior.

## LRCL-004 Public release-link contract

Release-note projection must convert repository-relative `docs/...` markdown targets to absolute GitHub links before VitePress validates the public manual.

## Diagrams

### Release flow

```mermaid
flowchart LR
  A[PR merged to main] --> B[npm ci on Linux]
  B --> C[VitePress build]
  C --> D[Release-note projection]
  D --> E[Public manual deploy]
```

### Threat model

```mermaid
flowchart LR
  A[Committed package lock] --> B[Platform-specific optional package]
  B --> C[Linux CI install]
  C --> D[Generated public release notes]
  D --> E[GitHub absolute documentation links]
  F[Untrusted PR markdown target] -->|normalized; no secret or PII interpolation| D
```
