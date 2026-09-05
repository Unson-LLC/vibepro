# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibePro helps teams keep **what they intended to build** aligned with **what AI-assisted development actually produces**.

AI coding agents can write technically valid code and still solve the wrong problem. VibePro keeps the chain from Story to Spec, implementation evidence, verification, review, decisions, and PR handoff explicit and repository-local, so humans and coding agents can inspect the same product intent and the same evidence.

```text
Intent
  -> Story
    -> Spec
      -> Implementation
        -> Verification
          -> Review / Decision
            -> PR handoff
```

VibePro is not primarily an agent sandbox or tool-permission system. It does not try to decide which Bash/Edit/deploy tools an agent may use. Those controls belong at the capability/execution boundary. VibePro operates at the intent/traceability boundary: a constrained agent can still build the wrong thing, and VibePro exists to make that mismatch visible before the change is accepted.

The current minimal core is intentionally small. It stores Stories, Specs, verification results, review records, decisions, traces, and PR summaries under `.vibepro/`. It does not implement your application, autonomously decide product meaning, decide whether a change is safe, or merge code for you. The former broad Gate DAG, managed execution, lifecycle accounting, budget enforcement, and automatic audit bundles were removed during the minimal-core rebuild.

See [Product Intent Traceability](docs/architecture/product-intent-traceability.md) for the product philosophy and architectural boundary.

## Install

VibePro requires Node.js 20 or newer and is currently published on the beta channel.

```bash
npx vibepro@beta --help
# or
npm install -g vibepro@beta
```

## Minimal workflow

```bash
# 1. Register the intended change as a Story
vibepro init /path/to/repo \
  --story-id story-example \
  --title "Example change" \
  --language en

# 2. Investigate the codebase and write a traceable Spec
vibepro story diagnose /path/to/repo --id story-example --run-graphify
vibepro spec write /path/to/repo --id story-example --draft --input spec.json

# 3. Run or record verification evidence
vibepro verify run /path/to/repo --id story-example --kind unit -- npm test

# 4. Prepare and record review evidence
vibepro review prepare /path/to/repo --id story-example --role reviewer
vibepro review record /path/to/repo --id story-example --role reviewer \
  --status pass --summary "Reviewed against the Story and Spec" \
  --inspection-input src/example.js

# 5. Summarize the intent-to-implementation evidence for a PR
vibepro pr prepare /path/to/repo --story-id story-example --base origin/main
```

`pr prepare` writes a machine-readable summary and PR body under `.vibepro/pr/<story-id>/`. It reports what was recorded and how the implementation is linked back to the Story and Spec; it is not an autonomous safety approval. `pr create` can push the selected branch and call GitHub CLI, but final review and merge authority remain outside VibePro.

For a bug fix, register the Story with `--contract-type bug_fix`. VibePro then requires ordered diagnosis evidence from reproduction through same-path reverification. See [Bug diagnosis migration](docs/guide/bug-diagnosis-migration.md).

Use the repository's actual default branch instead of assuming `origin/main`.

## Current command families

- Repository setup and health: `init`, `config language`, `doctor`, `status`
- Agent setup: `skills`, `codex`, `harness`
- Context discovery: `graph`, `env graph`, `diagnose`
- Product intent and traceability: `story`, `spec`, `trace`, `decision`
- Evidence: `verify`, `review`, `guard`
- PR handoff: `pr prepare`, `pr create`
- Legacy NocoDB portfolio adapter: `brainbase`
- Artifact maintenance: `artifacts`

The `brainbase` command is retained for the historical NocoDB Story/portfolio adapter. It does not connect a Story to the current Brainbase Judgment Resolver, Knowledge Resolver, Graph, or Knowledge Event APIs. New Brainbase integrations must use explicit versioned adapter contracts rather than extending this legacy command by implication.

Run `vibepro help --language en` for the authoritative command list. The CLI and evidence schemas may still change before 1.0.

## Optional Graphify integration

Graphify is optional and is not bundled. With an external `graphify` command installed, `story diagnose --run-graphify` and `graph --run-graphify` can add impact context. Missing Graphify does not prevent the rest of the minimal workflow.

## Documentation

- Manual: https://vibepro.pages.dev
- Japanese README: [README.ja.md](README.ja.md)
- Product philosophy: [Product Intent Traceability](docs/architecture/product-intent-traceability.md)
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

<!-- BRAINBASE_RUNTIME_HANDOFF_START -->
## Brainbase runtime handoff

`vibepro brainbase` remains the legacy NocoDB Story/portfolio adapter. Current Brainbase integration uses a separate namespace and never asks VibePro to recalculate Judgment:

```bash
vibepro integration brainbase bind . --id <story-id> --input <handoff.json>
# implement, then record computed verification for the same git state
vibepro integration brainbase event . --id <story-id> --summary "<verified reusable learning>"
```

`bind` accepts a managed Brainbase Judgment receipt plus matching `knowledge.resolve` routing receipts and actual retrieval references. It writes only canonical pointers and content digests under `.vibepro/integrations/`; it does not copy source bodies or Personal Knowledge.

`event` fails unless computed passing verification was recorded after the context binding and still matches the current git fingerprint. It creates a local `knowledge_event.v1` development-learning candidate with Graph promotion and external action disabled. With an explicitly configured, authorized destination and credentials, `integration brainbase reconcile` sends through the existing Knowledge Event API and reads back the receiver record. Transmission and receiver confirmation are stored separately; unconfirmed entries return exit code 2. See the [configuration and receiver verification guide](docs/guide/brainbase-receiver.md).
<!-- BRAINBASE_RUNTIME_HANDOFF_END -->
