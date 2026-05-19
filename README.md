# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)

VibePro is a CLI control plane for AI-driven development. It turns a feature story into reviewable architecture, spec, task, verification, and PR evidence so humans can safely delegate implementation work to AI agents.

VibePro does not rewrite your application by itself. It creates a repo-local `.vibepro/` workspace and stores the evidence that an engineer or coding agent needs before changing, reviewing, or merging code.

## Why VibePro

AI coding is fast until the final 20%: missing requirements, untested UI flows, broken API contracts, vague review scope, and PRs that look complete but are not actually usable.

VibePro is designed to make that final stretch explicit:

- Story: what user value must be delivered.
- Architecture: which boundaries and responsibilities must be preserved.
- Spec: which behaviors and invariants must hold.
- Code: what actually changed.
- Gates: which unit, integration, E2E, performance, security, and review evidence is still missing.
- PR evidence: what humans and AI agents should read before continuing.

The intended workflow is:

```text
Story -> Architecture -> Spec -> Code -> Gate -> PR Evidence
```

Once the story and architecture are clear, implementation can be handed to AI agents with much less ambiguity.

## Features

- Story, architecture, and spec aware PR preparation
- Requirement consistency checks against changed code
- Gate DAGs for completion dependencies
- PR split planning for large or risky changes
- Verification evidence recording for unit, integration, E2E, build, and type-check results
- Playwright-based flow verification with network error detection
- Performance evidence definitions, run recording, and before/after comparison
- Diagnosis packs for UI, security, performance, architecture, PR readiness, and launch readiness
- Agent review requests and review evidence recording
- Skills and Codex instruction installation for standardizing AI-driven workflows

## Installation

VibePro requires Node.js 20 or newer.

```bash
npm install
node bin/vibepro.js --help
```

When installed as a package:

```bash
npx vibepro --help
```

Graphify is optional but recommended for impact-scope discovery:

```bash
uv tool install graphifyy
```

You can still use most story, diagnosis, and PR gate workflows without Graphify. Impact discovery will simply be less complete.

## Quick Start

Initialize VibePro in a target repository:

```bash
npx vibepro init /path/to/repo \
  --story-id story-internal-beta \
  --title "Internal beta diagnosis" \
  --view dev \
  --period 2026-W18 \
  --language en
```

Run a story diagnosis:

```bash
npx vibepro story diagnose /path/to/repo --id story-internal-beta --run-graphify
```

Prepare PR evidence:

```bash
npx vibepro pr prepare /path/to/repo \
  --base <base-branch> \
  --story-id story-internal-beta
```

`<base-branch>` is repository-specific. Use the repository default branch, such as `origin/main`, `main`, `origin/develop`, or `develop`. VibePro also prints branch candidates during `init` and `pr prepare`.

## What VibePro Creates

VibePro stores its workspace under the target repository:

```text
.vibepro/
  config.json
  vibepro-manifest.json
  diagnostics/
  graphify/
  pr/
  qa/
  raw/
  stories/
```

The most important PR artifacts are:

- `pr-body.md`: PR body draft with story, risks, gates, and verification context.
- `review-cockpit.html`: human-readable review cockpit.
- `gate-dag.html`: completion dependency map.
- `split-plan.html`: PR split lanes and merge order.
- `pr-prepare.json`: machine-readable source of truth for agents.

Humans usually read the Markdown and HTML artifacts. AI agents should receive `pr-body.md`, `review-cockpit.html`, `gate-dag.html`, `split-plan.html`, and the relevant JSON artifacts.

## Common Workflows

### Diagnose A Repository

```bash
npx vibepro check all /path/to/repo --story-id <story-id> --base <base-branch>
```

Run a focused diagnosis pack:

```bash
npx vibepro check ui /path/to/repo --story-id <story-id>
npx vibepro check security /path/to/repo --story-id <story-id>
npx vibepro check performance /path/to/repo --story-id <story-id>
npx vibepro check architecture /path/to/repo --story-id <story-id>
npx vibepro check pr-readiness /path/to/repo --story-id <story-id> --base <base-branch>
```

### Verify A User Flow

```bash
npx vibepro verify flow /path/to/repo \
  --base-url http://127.0.0.1:3000 \
  --id <story-id>
```

VibePro records Playwright evidence and treats API `4xx` / `5xx`, console errors, unhandled rejections, and known user-facing error messages as gate findings.

### Record Verification Evidence

```bash
npx vibepro verify record /path/to/repo \
  --id <story-id> \
  --kind unit \
  --status pass \
  --command "npm test"
```

Recorded evidence is reused by `pr prepare` and PR gates.

### Prepare Agent Reviews

```bash
npx vibepro review prepare /path/to/repo --id <story-id> --stage implementation
```

Record a review result:

```bash
npx vibepro review record /path/to/repo \
  --id <story-id> \
  --stage implementation \
  --role regression_risk \
  --status pass \
  --summary "No regression risk found in the changed flow." \
  --agent-system codex \
  --execution-mode parallel_subagent \
  --agent-id <spawned-subagent-id> \
  --agent-thread-id <thread-id> \
  --agent-model <model>
```

`gate:agent_review` only treats a passing review as verified when the review result
contains Codex or Claude Code parallel subagent provenance. For Claude Code, use
`--agent-system claude_code` with the Task/subagent id, session id, or transcript
artifact. A manual `pass` without subagent provenance remains review evidence, but
does not satisfy the Agent Review Gate.

### Measure Performance

Define a story-specific metric:

```bash
npx vibepro performance define /path/to/repo \
  --id <story-id> \
  --metric-id session-switch.user-terminal-ready \
  --user-story "User switches sessions and can type in the terminal" \
  --start-condition "session row click" \
  --completion-condition "owner and inputReady=true" \
  --evidence-source browser_e2e \
  --readiness-kind user_perceived
```

Record before/after runs:

```bash
npx vibepro performance record /path/to/repo \
  --id <story-id> \
  --metric-id session-switch.user-terminal-ready \
  --label before \
  --status completed \
  --duration-ms 2400

npx vibepro performance compare /path/to/repo --id <story-id>
```

VibePro only compares runs with compatible `metricId` and completion conditions. If comparison is impossible, it reports why.

## AI Agent Setup

Install bundled Claude / Claude Code skills into a target repository:

```bash
npx vibepro skills list
npx vibepro skills install /path/to/repo
npx vibepro skills verify /path/to/repo
```

Install Codex instructions:

```bash
npx vibepro codex install /path/to/repo
npx vibepro codex verify /path/to/repo
```

The goal is to standardize how agents read stories, produce evidence, run reviews, and respect PR gates.

## Output Language

VibePro supports Japanese and English for human-facing CLI and report output:

```bash
npx vibepro init /path/to/repo --language ja
npx vibepro config language /path/to/repo --language en
npx vibepro pr prepare /path/to/repo --language en --base <base-branch>
```

Machine-readable JSON keys remain stable and English-oriented.

## Documentation

- [Japanese README](README.ja.md)
- [Internal beta release notes](docs/releases/internal-beta-2026-05-05.md)
- [Operating philosophy](docs/frames/vibepro-operating-philosophy.md)
- [Repo-local control plane frame](docs/frames/vibepro-repo-local-control-plane-frame.md)

## Project Status

VibePro is currently an internal beta. APIs, report schemas, and diagnosis packs may change before a stable public release.

## License

No license file is currently included. Add a license before distributing VibePro as an OSS package.
