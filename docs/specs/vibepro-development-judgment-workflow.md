---
story_id: story-vibepro-development-judgment-workflow
title: Development Judgment Workflow Spec
status: active
---

# Development Judgment Workflow Spec

## Required Behavior

### DJW-001 Prepare

`vibepro judgment prepare <repo> --id <story-id>` MUST write a valid Senior Judgment input draft.

The draft MUST:

- use schema `0.3.0`
- bind `story_id` and a unique or explicitly supplied `run_id`
- link the current Senior Judgment run as `parent_run_id` when present
- include current changed-file observations when the Story has no `## Observations` section
- contain every standard judgment axis
- initialize every axis as `inactive` unless `## Axes` states otherwise
- set `problem_frame.status=uncertain` when the Story has no `## Problem Frame` fields
- state that semantic framing has not been adopted when the Story does not state it
- copy `## Problem Frame`, `## Constraints`, `## Options`, `## Current Constraint`, `## Observations`, and `## Axes` from the Story when those sections contain fields
- leave any omitted section uncertain or empty, without inferring it from other Story prose

### Story judgment headings

`judgment prepare` reads only these exact level-2 headings. Other headings are ordinary Story prose and are ignored. A heading with no fields and no items leaves that part of the draft at the uncertain or empty default. A heading that contains fields must use the field lines below. Anything else is an invalid format and prepare fails without guessing a value.

```markdown
## Problem Frame

- status: valid
- statement: The adopted input is not tied to the prepare receipt.
- reason: Hand-made runs were adopted.

## Current Constraint

- kind: value_constraint
- status: verified
- statement: Adoption does not read the draft receipt.
- source_refs: src/judgment-operations.js
- decision_evidence_status: sufficient
- decision_evidence_reason: The adopt path stores run_id from the input alone.
- decision_evidence_source_refs: src/judgment-operations.js

## Observations

### obs-receipt
- statement: The receipt file is unread during adopt.
- source_ref: src/judgment-operations.js
- freshness: current

## Constraints

### keep-receipt
- kind: invariant
- statement: Adoption requires the prepare receipt.

## Options

### option-bind-receipt
- summary: Refuse adopt unless the receipt matches.
- action: fix
- addresses:
- violates: keep-receipt
- residual_risk: low

## Axes

### security_boundary
- activation: active
- activation_reason: Adoption is an authority boundary.

#### hypothesis-receipt
- claim: A missing receipt can still be adopted.

##### prediction-receipt
- statement: adopt rejects a missing receipt.

##### evidence-receipt
- prediction_id: prediction-receipt
- relation: supports
- freshness: current
- source_ref: src/judgment-operations.js
- summary: adopt checks the draft receipt.
```

Field rules:

- Field lines are `- key: value`. Keys are lowercase words. Unknown keys, duplicate keys, and values outside the Senior Judgment enums are invalid.
- `status` on Problem Frame is `valid`, `invalid`, or `uncertain`.
- Current Constraint `kind` is `value_constraint` or `structural_excess`. Its `status` is `verified`, `hypothesized`, or `unknown`. `decision_evidence_status` is `sufficient`, `insufficient`, or `unknown`.
- Constraint `kind` is `invariant` or `preference`.
- Option `action` is `build`, `fix`, `delete`, `consolidate`, `redesign`, `retire`, `measure`, or `experiment`. `residual_risk` is `low`, `medium`, `high`, or `unknown`. `addresses` and `violates` are comma-separated lowercase ids and may be empty.
- Observation `freshness` is `current`, `stale`, or `unknown`.
- Axis ids must be one of the standard judgment axes. `activation` is `active` or `inactive`. An active axis needs at least one `####` hypothesis. A hypothesis needs a `claim` and at least one `#####` prediction (`statement` only). Evidence at the same level uses `prediction_id`, `relation` (`supports`, `refutes`, or `non_discriminating`), `freshness`, `source_ref`, and `summary`.
- Item ids under `###`, `####`, and `#####` match `^[a-z][a-z0-9_-]*$`.
- Lists of ids and `source_refs` are comma-separated. Omitted Axes stay inactive. Omitted Observations stay the changed-file observations. Omitted Constraints and Options stay empty arrays.

The command MAY accept `--output`. `--run-id` is refused unless `VIBEPRO_ALLOW_JUDGMENT_RUN_ID=1`, and a supplied id MUST match `^judgment-\d{14}-[0-9a-f]{8}$`.

### DJW-002 Evaluate and compile

`vibepro judgment evaluate` MUST continue to execute the existing Senior Engineering Judgment evaluation and write its existing artifacts.

After that evaluation, it MUST compile a `vibepro_development_judgment_dag` with these ordered nodes:

1. `goal_contract`
2. `problem_frame`
3. `development_mode`
4. `option_pruning`
5. `recommendation`

The compiled DAG MUST be acyclic, advisory, and non-blocking. It MUST write:

- immutable run JSON and Markdown
- current JSON and Markdown projection

### DJW-003 Outcome

`vibepro judgment outcome record` MUST require:

- Story ID
- run ID
- human decision
- judgment effect
- evaluation status
- summary

Allowed human decisions:

- `accepted`
- `modified`
- `rejected`

Allowed effects:

- `changed_plan`
- `changed_review_focus`
- `escalated_to_human`
- `no_effect`

Allowed statuses:

- `confirmed`
- `mixed`
- `falsified`
- `unknown`

Recording an Outcome MUST append an evaluation to the current DAG recommendation and write a separate Outcome artifact. The immutable run artifact MUST remain byte-identical.

### DJW-004 PR projection

`pr prepare` MUST read the current Development Judgment projection fail-soft.

The machine-readable preparation and PR body MUST expose:

- availability/status
- run ID
- development mode
- recommendation
- unknown count
- outcome count
- latest outcome status
- artifact
- `advisory=true`
- `blocking=false`

The projection MUST NOT participate in readiness resolution. The same repository state and review/bug evidence MUST produce the same `gate_status` whether the judgment projection exists or not.

### DJW-005 Failure boundary

A missing Development Judgment artifact MUST produce `status=not_recorded`.

An unreadable or invalid artifact MUST produce `status=unavailable` with a bounded error summary. Neither state may fail `pr prepare` by itself.

## Verification

- focused unit/integration tests cover draft generation, compilation, cycle validity, immutable run preservation, outcome append, CLI routing, and PR projection
- `npm run typecheck`
- generated CLI references remain synchronized
- public documentation build remains valid

## Non-goals

- enforcing Judgment as a PR Gate
- automatic Frame or Story adoption
- automatic Brainbase promotion
- restoring managed merge or generic Gate DAG behavior
