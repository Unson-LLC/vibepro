# VibePro

[![Language: English](https://img.shields.io/badge/Language-English-blue)](README.md)
[![Language: Japanese](https://img.shields.io/badge/Language-%E6%97%A5%E6%9C%AC%E8%AA%9E-green)](README.ja.md)
[![Node.js >=20](https://img.shields.io/badge/Node.js-%3E%3D20-339933)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue)](LICENSE)

VibePro is a CLI control plane for safer AI-driven PRs. It turns a feature story into architecture, spec, verification, agent-review, and PR evidence, then blocks PR creation until the required gates are satisfied.

VibePro does not rewrite your application by itself. It creates a repo-local `.vibepro/` workspace and stores the evidence that an engineer or coding agent needs before changing, reviewing, or merging code.

## Why VibePro

AI coding is fast until the final 20%: missing requirements, untested UI flows, broken API contracts, vague review scope, and PRs that look complete but are not actually usable. The bigger risk is that a broad workflow change can still look like an ordinary unit/API change.

VibePro is designed to make that final stretch explicit:

- Story: what user value must be delivered.
- Architecture: which boundaries and responsibilities must be preserved.
- Spec: which behaviors and invariants must hold.
- Code: what actually changed.
- Gates: which unit, integration, E2E, performance, security, and review evidence is still missing.
- Risk profile: whether the change is light, API contract, UI interaction, or workflow-heavy.
- PR evidence: what humans and AI agents should read before continuing.

The intended workflow is:

```text
Story -> Architecture -> Spec -> Code -> Risk-Adaptive Gates -> PR Evidence -> VibePro PR Create -> VibePro Execute Merge
```

Once the story and architecture are clear, implementation can be handed to AI agents with much less ambiguity. When the change touches workflow state, runtime contracts, verification evidence, or review orchestration, VibePro expands the Gate DAG automatically instead of treating the PR like a narrow code change.

## Features

- Story, architecture, and spec aware PR preparation
- Requirement consistency checks against changed code
- Risk-adaptive Gate DAGs for completion dependencies and workflow-heavy release checks
- PR split planning for large or risky changes
- Verification evidence recording for unit, integration, E2E, build, and type-check results
- Playwright-based flow verification with network error detection
- Performance evidence definitions, run recording, and before/after comparison
- Diagnosis packs for UI, security, performance, architecture, PR readiness, and launch readiness
- Agent review requests and risk-adaptive review evidence recording
- `vibepro pr create` path enforcement so unresolved gates and waiver reasons are captured
- `vibepro execute merge` so merge-time checks, merge strategy, and branch cleanup outcomes are recorded as VibePro artifacts
- `design-system derive` for VibePro-native Design System artifacts from existing routes, code, style evidence, and optional Graphify context
- `design-modernize` planning and derived Design System generation for existing UI modernization without changing current information architecture
- Skills and Codex instruction installation for standardizing AI-driven workflows

## Installation

VibePro requires Node.js 20 or newer.

VibePro is currently an early beta OSS release. The CLI, report schemas, and diagnosis packs may change before a stable 1.0 release, so use the `beta` dist-tag explicitly.

Try the published CLI without installing it globally:

```bash
npx vibepro@beta --help
```

Or install the beta CLI globally:

```bash
npm install -g vibepro@beta
vibepro --help
```

For local development of VibePro itself, use a source checkout:

```bash
git clone https://github.com/Unson-LLC/vibepro.git
cd vibepro
npm install
node bin/vibepro.js --help
```

## Optional Integration: Graphify

Graphify is optional but recommended for impact-scope discovery. VibePro does not bundle Graphify or redistribute Graphify code. When `--run-graphify` is used, VibePro invokes an externally installed `graphify` command. When `--from graphify-out` is used, VibePro imports artifacts that Graphify already generated.

```bash
uv tool install graphifyy
```

Install and use Graphify under Graphify's own license. You can still use most Story, diagnosis, checkpoint, and PR gate workflows without Graphify. Impact discovery will simply be less complete.

The examples below use `vibepro`. If you are running from a local clone instead of a global install, replace `vibepro` with `node /path/to/vibepro/bin/vibepro.js`.

## First Run: Choose Your Path

If you only want to diagnose a repository for the first time, start here. You do not need an existing Story ID.

```bash
vibepro check all /path/to/repo --base <base-branch>
```

Then share:

- `.vibepro/checks/all/<run-id>/check.md`
- the top `Status`
- every `needs_review` / `fail` item

If you are working on a known feature or bug, create a local Story first:

```bash
vibepro init /path/to/repo \
  --story-id story-<short-name> \
  --title "<feature or bug title>" \
  --language en

vibepro check all /path/to/repo \
  --story-id story-<short-name> \
  --base <base-branch>
```

If the repository already has VibePro Stories, list or map them before choosing one:

```bash
vibepro story list /path/to/repo
vibepro story map /path/to/repo
```

For PR work, the main artifact is not the check report. Run PR preparation and open the generated cockpit:

```bash
vibepro pr prepare /path/to/repo \
  --story-id <story-id> \
  --base <base-branch>
```

Open in this order:

1. `.vibepro/pr/<story-id>/review-cockpit.html`
2. `.vibepro/pr/<story-id>/gate-dag.html`
3. `.vibepro/pr/<story-id>/split-plan.html`
4. `.vibepro/pr/<story-id>/pr-body.md`

`<base-branch>` is repository-specific. Use the repository default branch, such as `origin/main`, `main`, `origin/develop`, or `develop`.

`pr prepare` classifies the change before building the Gate DAG. A narrow docs or UI change may stay light. A cross-surface workflow change becomes `workflow_heavy` and requires extra release evidence such as workflow replay, production path coverage, release confidence, and broader Agent Review roles. While required gates are unresolved, VibePro's `next_commands` point back to review or verification steps instead of PR creation.

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

Record the verification evidence that actually ran on the current git state:

```bash
npx vibepro verify record /path/to/repo \
  --id story-internal-beta \
  --kind unit \
  --status pass \
  --command "npm test"
```

Run a checkpoint before treating implementation as ready:

```bash
npx vibepro checkpoint verification /path/to/repo \
  --base <base-branch> \
  --story-id story-internal-beta
```

Prepare and record required Agent Reviews, then rerun PR preparation until the Gate DAG is ready:

```bash
npx vibepro review prepare /path/to/repo --id story-internal-beta --stage gate
npx vibepro review status /path/to/repo --id story-internal-beta
npx vibepro pr prepare /path/to/repo --base <base-branch> --story-id story-internal-beta
```

Create the PR through VibePro after `pr prepare` reports readiness:

```bash
npx vibepro pr create /path/to/repo \
  --base <base-branch> \
  --head <feature-branch> \
  --story-id story-internal-beta
```

Do not use raw `gh pr create` as the normal PR path; it bypasses VibePro's Gate DAG and waiver audit.

After the PR is created and checks are ready, run merge through VibePro as well:

```bash
npx vibepro execute merge /path/to/repo \
  --story-id story-internal-beta \
  --strategy merge \
  --delete-branch
```

Do not treat raw `gh pr merge` as the standard merge path when you need VibePro auditability. `execute merge` records merge-time readiness checks, merge result, merge commit SHA, and branch cleanup outcomes under `.vibepro/`.

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
npx vibepro check oss-readiness /path/to/repo --story-id <story-id>
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

For workflow-heavy changes, unit/API evidence alone is not enough. VibePro also expects current, story-bound flow or E2E evidence with executable assertions, plus any risk-adaptive review roles required by the Gate DAG.

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
  --agent-model <model> \
  --agent-closed
```

`gate:agent_review` treats a passing review as verified only when required
reviews include Codex/Claude Code parallel subagent provenance and closed
subagent lifecycle evidence. After receiving each result, close/shutdown the
review subagent before recording it, then pass `--agent-closed`. For Claude Code, use
`--agent-system claude_code` with the Task/subagent id, session id, or transcript
artifact. A human review can be recorded as audit context, but it is not a
substitute for a required subagent review:

```bash
npx vibepro review record /path/to/repo \
  --id <story-id> \
  --stage implementation \
  --role regression_risk \
  --status pass \
  --summary "Manual review passed." \
  --agent-system human \
  --execution-mode manual_review \
  --recorded-by <reviewer>
```

Manual review evidence remains useful audit context, but it does not satisfy a
required Agent Review Gate. If a runtime cannot spawn subagents, the coordinator
should block or record a separate waiver decision instead of marking the gate as
passed.

### Create A PR Through VibePro

```bash
npx vibepro pr prepare /path/to/repo --story-id <story-id> --base <base-branch>
npx vibepro pr create /path/to/repo --story-id <story-id> --base <base-branch> --head <feature-branch>
```

`pr create` reuses the PR body generated by `pr prepare`, pushes the branch, and creates the GitHub PR. If critical gates are unresolved, it fails before creating a PR. Non-critical unresolved gates require both `--allow-needs-verification` and `--verification-waiver <reason>`.

### Modernize An Existing UI

For existing products, first derive the product-local Design System from current evidence. This creates the design decision space that later screen modernization and implementation gates must respect.

```bash
npx vibepro design-system init /path/to/repo \
  --id <ds-id> \
  --product <name>

npx vibepro design-system derive /path/to/repo \
  --id <ds-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --brief "Japanese hotel discovery app with map exploration and product-native CTAs" \
  --brief-file visual-foundations.md \
  --from-code

npx vibepro design-system ingest-brief /path/to/repo \
  --id <ds-id> \
  --brief-file visual-foundations.md

npx vibepro design-system ingest /path/to/repo \
  --id <ds-id> \
  --bundle external-ds-bundle.json

npx vibepro design-system ingest-design-md /path/to/repo \
  --id <ds-id> \
  --file DESIGN.md

npx vibepro design-system export /path/to/repo \
  --id <ds-id> \
  --format json

npx vibepro design-system export-design-md /path/to/repo \
  --id <ds-id>

npx vibepro design-system lint /path/to/repo \
  --id <ds-id>

npx vibepro design-system diff /path/to/repo \
  --id <ds-id> \
  --base origin/main

npx vibepro design-system validate /path/to/repo \
  --id <ds-id> \
  --story-id <story-id>

npx vibepro design-modernize derive-system /path/to/repo \
  --id <story-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --brief "Japanese hotel discovery app with map exploration and product-native CTAs"

npx vibepro design-modernize plan /path/to/repo \
  --id <story-id> \
  --product <name> \
  --routes /home,/map,/detail \
  --base-url http://127.0.0.1:3000
```

`design-system init` creates an empty-but-valid VibePro-native Design System scaffold under `.vibepro/design-system/<ds-id>/`. Use it before route/code evidence exists. The scaffold records product id/name, authority boundaries, empty token/component/state/CTA sections, and a `needs_evidence` DS gate so an empty DS never silently passes.

`design-system derive` creates a VibePro-native Design System under `.vibepro/design-system/<ds-id>/`. It reads existing route code, style/token files, optional Graphify evidence, the product brief, and an optional visual foundations brief, then writes product semantics, theme tokens, semantic tokens, component roles, screen patterns, CTA policy, state semantics, density/navigation policies, implementation mapping, evidence coverage, and explicit DS gates.

`design-system ingest-brief` adds or replaces `visual-foundations.json` / `.md` on an existing native DS. Visual foundations capture design language, color roles, typography, density, component feel, composition, and native CTA language as reference evidence only. Current code, Graphify evidence, implementation mapping, and VibePro gates remain authoritative.

`design-system ingest` normalizes external DS bundles with tokens, components, guidelines, and CSS/JS string exports into VibePro-native DS sections. The external bundle remains reference evidence only; `authority` stays `vibepro_native_design_system`, `ds-gate.json` keeps fallback disabled, and likely secret values are omitted from persisted artifacts.

`design-system ingest-design-md` imports a DESIGN.md file with optional YAML tokens and Markdown rationale into the VibePro-native DS as reference evidence. It writes `.vibepro/design-system/<ds-id>/DESIGN.md` and `design-md.json`, updates `source_evidence.design_md`, and adds explicit DS gate checks for authority boundary, token references, prose intent, Do/Don't coverage, contrast, and diff evidence. DESIGN.md does not override current code, Story, Spec, Architecture, or VibePro gates.

`design-system export` emits the aggregate DS JSON, the human-readable Markdown summary, CSS custom-property aliases, or the agent-readable DESIGN.md view with `--format design-md`. CSS export returns `needs_tokens` when no semantic or theme tokens exist, instead of pretending an empty stylesheet is useful.

`design-system export-design-md` writes and prints `.vibepro/design-system/<ds-id>/DESIGN.md` from the current native DS. `design-system lint` validates DESIGN.md structure, token references, section order, contrast, prose intent, and Do/Don't coverage. `design-system diff` compares the current DESIGN.md artifact with a selected git base ref and reports token, section, and lint regressions.

`design-system validate` checks the native DS against a selected Story/Spec/Architecture context before implementation. It writes `.vibepro/design-system/<ds-id>/validation/<story-id>.json` and `.md`, and explicitly reports DS drift, CTA priority, state semantics, component roles, navigation/density policy, Story alignment, and likely secret leakage.

Use this command before redesigning existing UI when the product already has real routes, CTAs, states, and data dependencies. The generated Design System is not a visual suggestion; it is the product-local constraint artifact that preserves existing UX invariants while making the UI more coherent.

`derive-system` converts the product brief and current UI evidence into a VibePro-derived Design System for a specific modernization story: product semantics, semantic color roles, component responsibilities, composition rules, visual-hypothesis policy, and explicit DS gates. The durable pattern is to build the design decision space before generating screen candidates.

`design-modernize` is for improving real product screens while preserving current routes, information architecture, CTAs, state behavior, and data dependencies. Optional design-system bundles or generated visual hypotheses are reference material; the VibePro-derived Design System, current screenshots, Graphify/Codex evidence, and Gate DAG remain authoritative.

Typical native Design System artifacts are written under `.vibepro/design-system/<ds-id>/`:

- `design-system.json` / `.md`: aggregate VibePro-native Design System
- `product-semantics.json`: product domain, language policy, interaction model, route intents, forbidden patterns
- `theme-tokens.json` and `semantic-tokens.json`: extracted raw style evidence and semantic token roles
- `component-roles.json` and `component-states.json`: component responsibilities and state semantics
- `screen-patterns.json`: route-family patterns, current CTAs, data dependencies, navigation targets, UX invariants
- `visual-foundations.json` / `.md`: external visual DS brief distilled as reference-only foundations
- `external-bundle.json`: external tokens/components/guidelines summarized as reference-only evidence
- `DESIGN.md` and `design-md.json`: agent-readable design intent imported or exported as reference-only evidence
- `implementation-mapping.json`: route/component/file mapping for implementation handoff
- `evidence-coverage.json` and `ds-gate.json`: coverage findings and explicit DS gate clauses
- `validation/<story-id>.json` / `.md`: Story-specific DS drift and regression gate results

Recommended sequence:

1. Run `vibepro graph <repo> --run-graphify` when Graphify is available.
2. Run `vibepro design-system init <repo> --id <ds-id> --product <name>` when you need a DS scaffold before evidence exists.
3. Run `vibepro design-system derive <repo> --id <ds-id> --product <name> --routes <csv> --brief <text> --brief-file <file> --from-code`.
4. Optionally run `vibepro design-system ingest <repo> --id <ds-id> --bundle <file>` for external DS bundle references.
5. Optionally run `vibepro design-system ingest-design-md <repo> --id <ds-id> --file DESIGN.md` when the design intent is maintained as an agent-readable Markdown contract.
6. Export with `vibepro design-system export <repo> --id <ds-id> --format json|markdown|css|design-md` when another tool or human reviewer needs the DS.
7. Run `vibepro design-system lint <repo> --id <ds-id>` and `vibepro design-system diff <repo> --id <ds-id> --base <base-ref>` before PR readiness.
8. Review `.vibepro/design-system/<ds-id>/evidence-coverage.json` and `ds-gate.json`.
9. Run `vibepro design-system validate <repo> --id <ds-id> --story-id <story-id>`.
10. Use `design-modernize derive-system` or `design-modernize plan` for screen-level work.
11. Treat generated visual ideas as hypotheses; implementation follows the VibePro-native Design System, current code, Story/Spec, and Gate DAG.

Typical artifacts are written under `.vibepro/design-modernize/<story-id>/`:

- `design-system-derivation.json` / `.md`: product semantics and Derived Design System summary
- `derived-design-system.json`: semantic tokens, component role map, CTA hierarchy, anti-patterns, and visual hypothesis policy
- `design-modernize.json`: screen-level modernization plan and Design Quality DAG
- `ds-gate.json`: explicit DS drift and UX regression clauses with fallback disabled

Use generated or external design ideas only as visual hypotheses. Before implementation, confirm that the spec keeps the current route, information architecture, CTA priority, state behavior, and data dependencies. Before PR creation, `vibepro pr prepare` must show the Design / Requirement / Unit / Integration / Agent Review gates as resolved for the current HEAD.

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

Bundled skills:

- `vibepro-workflow`: Story / Architecture / Spec / Graphify / Gate operating order, including design-modernize and Agent Review flow.
- `vibepro-story-refactor`: refactor workflow that keeps Story, Architecture, Spec, task, code, and Gate evidence aligned.
- `vibepro-diagnosis-packages`: purpose-level UI, security, performance, architecture, PR, and launch readiness checks.
- `vibepro-human-review`: how to read PR readiness artifacts, split plans, review cockpit, and waiver decisions.

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
- [Changelog](CHANGELOG.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [OSS readiness architecture](https://github.com/Unson-LLC/vibepro/blob/main/docs/architecture/vibepro-oss-apache2-readiness.md)
- [OSS readiness spec](https://github.com/Unson-LLC/vibepro/blob/main/docs/specs/vibepro-oss-apache2-readiness.md)

## Project Status

VibePro is currently an early beta OSS release. APIs, report schemas, and diagnosis packs may change before a stable 1.0 release.

## License

VibePro is licensed under the [Apache License 2.0](LICENSE).
