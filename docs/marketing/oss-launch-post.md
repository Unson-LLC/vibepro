# VibePro OSS Launch Draft

## Core Message

Stop babysitting AI. Ship what you meant to build.

VibePro is for developers who already use Codex, Claude Code, or other AI coding agents, but do not want to manually watch every step, reconstruct intent in every review, or guess whether an AI-built PR is actually ready.

AI can write code. The harder problem is keeping product intent, architecture boundaries, verification evidence, and review evidence intact while multiple agents work in parallel. VibePro turns those concerns into repo-local artifacts and mechanical gates.

## Short Announcement

VibePro is now moving toward OSS.

It helps teams delegate implementation to Codex, Claude Code, and other AI coding agents without losing product intent.

The core idea:

- capture what you meant to build
- hand scoped tasks to agents
- require the right verification and reviews
- stop PR creation when evidence is missing
- keep decisions, waivers, and review results in artifacts instead of chat

Stop babysitting AI. Ship what you meant to build.

## X / Social Variants

### Variant A

AI can write code.

The hard part is making sure it ships the product you meant to build.

VibePro turns Story, Spec, Gate, verification, and agent review evidence into repo-local artifacts, then blocks PR creation when required evidence is missing.

Stop babysitting AI. Ship what you meant to build.

### Variant B

If you are using Codex or Claude Code heavily, the bottleneck becomes review, not generation.

VibePro gives AI work mechanical gates:

- product intent
- scoped handoff
- verification evidence
- role-based agent reviews
- PR evidence

Missing evidence means the PR does not move.

### Variant C

VibePro is not another AI coding agent.

It is the control layer around them:

- what should be built
- which boundaries must hold
- which tests and reviews are required
- what evidence must exist before PR creation

AI writes the code. VibePro keeps the product on track.

## Longer Post Outline

### 1. The Problem

AI coding tools are fast for small tasks, but product work is not just code generation.

Once AI agents touch UI, APIs, data flow, performance paths, security boundaries, and workflow state, the risk shifts from "can it write code?" to "did it still build the intended product?"

Most teams handle that by babysitting the agent:

- re-explaining intent
- manually checking changed files
- asking for tests after the fact
- pasting review context into chat
- deciding by feel whether the PR is ready

That does not scale to parallel AI implementation.

### 2. What VibePro Does

VibePro stores the work contract inside the repo:

- Story
- Architecture
- Spec
- Task handoff
- risk-adaptive Gate DAG
- verification evidence
- role-based agent review evidence
- PR evidence
- decision records

If required evidence is missing, VibePro keeps the workflow blocked. It can require Codex or Claude Code subagent reviews, bind those results to the current git state, and record waivers or decisions as artifacts.

### 3. Why It Matters

The goal is not to make AI write more code.

The goal is to let AI write more of the code while the team keeps control over:

- product intent
- quality standards
- responsibility boundaries
- evidence
- merge readiness

### 4. Try It

Before npm publication:

```bash
npm install -g git+https://github.com/Unson-LLC/vibepro.git
vibepro --help
```

After publication:

```bash
npx vibepro --help
```

For a repo with a Story:

```bash
vibepro pr prepare . --story-id <story-id> --base main
```

Open:

- `.vibepro/pr/<story-id>/review-cockpit.html`
- `.vibepro/pr/<story-id>/gate-dag.html`
- `.vibepro/pr/<story-id>/pr-body.md`

