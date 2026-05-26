# VibePro Demo Story

This demo is designed for README screenshots, launch posts, and short walkthroughs.

## Demo Premise

A product team asks AI agents to implement a "sample generation" flow.

The change touches:

- a UI button and status display
- an API endpoint
- a background job
- polling/retry behavior
- auth-sensitive routes
- legacy v1 compatibility

This is intentionally not a small UI copy change. It is the kind of cross-surface workflow where AI can produce code that looks complete while missing runtime evidence.

## What VibePro Should Show

### Light Change

Example:

- update a label in `TaskStatusBadge.tsx`

Expected VibePro behavior:

- classify as a light or UI interaction change
- require narrow verification
- avoid heavy workflow gates

Message:

> VibePro does not make every AI change heavyweight.

### Workflow-Heavy Change

Example:

- UI starts sample generation
- API creates a background job
- worker updates status
- UI polls until ready
- auth and legacy v1 paths must still work

Expected VibePro behavior:

- classify as workflow-heavy
- add risk-adaptive gates
- require Story E2E or Flow evidence
- require role-based agent reviews
- block PR creation while evidence is missing

Message:

> When the change gets risky, VibePro gets stricter.

## Walkthrough Script

1. Run PR preparation.

```bash
vibepro pr prepare . --story-id story-sample-generation --base main
```

2. Open the generated artifacts.

```text
.vibepro/pr/story-sample-generation/review-cockpit.html
.vibepro/pr/story-sample-generation/gate-dag.html
.vibepro/pr/story-sample-generation/pr-body.md
```

3. Show the blocked gates.

Focus on:

- missing Flow evidence
- missing E2E verification
- required agent reviews
- unresolved decision records or waivers

4. Record evidence.

```bash
vibepro verify record . \
  --id story-sample-generation \
  --kind e2e \
  --status pass \
  --command "npx playwright test tests/e2e/story-sample-generation.spec.ts"
```

5. Prepare and record agent review.

```bash
vibepro review prepare . --id story-sample-generation --stage gate
vibepro review record . \
  --id story-sample-generation \
  --stage gate \
  --role release_risk \
  --status pass \
  --summary "Workflow evidence is sufficient for PR creation." \
  --agent-system codex \
  --execution-mode parallel_subagent \
  --agent-id <agent-id> \
  --agent-closed
```

6. Re-run PR preparation.

```bash
vibepro pr prepare . --story-id story-sample-generation --base main
```

7. Create the PR through VibePro.

```bash
vibepro pr create . --story-id story-sample-generation --base main --head feature/sample-generation
```

## Screenshot Targets

- README header image
- `review-cockpit.html`
- `gate-dag.html` showing blocked gates
- `pr-body.md` showing evidence and next actions

