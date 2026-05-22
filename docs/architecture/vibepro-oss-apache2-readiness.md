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
- public architecture/spec/story docs
- README
- LICENSE / NOTICE

公開packageから外す:

- `.vibepro/` runtime workspace
- `node_modules/`
- local logs
- internal release/audit notes
- customer or dogfood project evidence
- Graphify implementation code

## Release Checks

CI and release preparation must run:

- `npm run typecheck`
- `npm test`
- `npm run pack:dry-run`
- CLI smoke commands

Package contents are controlled by `package.json#files`.
