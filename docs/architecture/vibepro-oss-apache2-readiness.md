---
story_id: story-vibepro-oss-apache2-readiness
title: OSS Apache-2.0 Readiness Architecture
---

# Architecture

VibePro本体は Apache-2.0 で公開する。

GraphifyはVibeProのoptional integrationであり、VibePro packageには同梱しない。VibeProは外部 `graphify` コマンド実行または生成済み `graphify-out` artifact importだけを行う。

## Package Boundary

公開packageに含める:

- CLI entrypoint
- source code
- bundled skills
- agent instructions
- README
- LICENSE / NOTICE

公開packageには含めず、GitHub repository上で公開する:

- public architecture/spec/story docs
- contributor and security operation docs

公開packageから外す:

- `.vibepro/` runtime workspace
- `node_modules/`
- local logs
- internal release/audit notes
- `docs/releases/`
- customer or dogfood project evidence
- Graphify implementation code

## Release Checks

CI and release preparation must run:

- `npm run typecheck`
- `npm test`
- `npm run pack:dry-run`
- CLI smoke commands

Package contents are controlled by `package.json#files`.

## PR Evidence Boundary

PR evidence generation is part of the VibePro CLI runtime, not an OSS-specific release script. Reviewer-facing PR context must be derived from the canonical Story source whenever it is available, so `.vibepro/config.json` or other cached internal state cannot downgrade a clear Story title to a generic label such as `Story`.

Story parsing remains generic: explicit background sections are preferred, and otherwise the prose directly under `# Story` / `# ストーリー` is treated as the review background. This keeps the behavior reusable for OSS readiness, customer projects, and ordinary feature stories.

## Agent Review Gate Boundary

Agent review enforcement is split by workflow phase. Early development reviews are checkpoint responsibilities, while PR readiness only checks final review surfaces.

- `checkpoint implementation-start` owns planning/spec and architecture/spec review readiness.
- `checkpoint test-plan` owns test plan review readiness.
- `checkpoint implementation-complete` owns implementation review readiness.
- `pr prepare` / `pr create` own final gate and preview review readiness.

This prevents source changes from causing PR-time review backlogs for phases that should have blocked earlier, while preserving a hard Gate DAG before PR creation.
