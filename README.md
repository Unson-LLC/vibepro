# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibePro is a small, repository-local CLI for keeping the context around AI-assisted development traceable. It stores Stories, Specs, verification results, review records, decisions, and PR summaries under `.vibepro/` so humans and coding agents can inspect the same evidence.

VibePro does not implement your application, decide whether a change is safe, or merge code for you. The minimal core deliberately removed the former Gate DAG as a general-purpose authority, together with managed execution, lifecycle accounting, budget enforcement, and automatic audit bundles. Bug Stories are the narrow exception: their diagnosis contract fails closed before PR creation until actual-path evidence is complete.

## Install

VibePro requires Node.js 20 or newer and is currently published on the beta channel.

```bash
npx vibepro@beta --help
# or
npm install -g vibepro@beta
```

## Minimal workflow

```bash
# 1. Initialize repository-local context
vibepro init /path/to/repo \
  --story-id story-example \
  --title "Example change" \
  --language en

# 2. Investigate and write a traceable Spec
vibepro story diagnose /path/to/repo --id story-example --run-graphify
vibepro spec write /path/to/repo --id story-example --draft --input spec.json

# 3. Run or record verification
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test

# 4. Prepare and record review evidence
vibepro review prepare /path/to/repo --id story-example --stage gate
vibepro review record /path/to/repo --id story-example --stage gate \
  --role implementation --status pass --summary "Reviewed"

# 5. Summarize evidence for a PR
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

`pr prepare` writes a machine-readable summary and PR body under `.vibepro/pr/<story-id>/`. It reports what was recorded; it is not a safety approval. `pr create` can push the selected branch and call GitHub CLI, but final review and merge authority remain outside VibePro.

For a bug fix, register the Story with `--contract-type bug_fix`. VibePro then requires ordered diagnosis evidence from reproduction through same-path reverification. See [Bug diagnosis migration](docs/guide/bug-diagnosis-migration.md).

Use the repository's actual default branch instead of assuming `origin/main`.

## Current command families

- Repository setup and health: `init`, `config language`, `doctor`, `status`
- Agent setup: `skills`, `codex`, `harness`
- Context discovery: `graph`, `env graph`, `diagnose`
- Product intent: `story`, `spec`, `trace`
- Evidence: `verify`, `review`, `decision`, `guard`
- PR handoff: `pr prepare`, `pr create`
- Integration and artifact maintenance: `brainbase`, `artifacts`

Run `vibepro help --language en` for the authoritative command list. The CLI and evidence schemas may still change before 1.0.

## Optional Graphify integration

Graphify is optional and is not bundled. With an external `graphify` command installed, `story diagnose --run-graphify` and `graph --run-graphify` can add impact context. Missing Graphify does not prevent the rest of the minimal workflow.

## Documentation

- Manual: https://vibepro.pages.dev
- Japanese README: [README.ja.md](README.ja.md)
- CLI reference: https://vibepro.pages.dev/reference/cli
- Releases: https://vibepro.pages.dev/releases/

## Development

```bash
npm install
npm run typecheck
npm test
npm run test:e2e:ts
npm run pack:dry-run
npm run docs:build
```

VibePro is licensed under Apache-2.0.
