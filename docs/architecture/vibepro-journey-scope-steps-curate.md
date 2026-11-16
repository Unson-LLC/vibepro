---
story_id: story-vibepro-journey-scope-steps-curate
title: Journey Scope, Required Steps, and Curate Additions
status: draft
---

# Architecture

A repository can hold several product Journeys. `journey derive` used to read
every non-archived Story and always required `discover` / `signup` /
`first-value` for the walking skeleton, and `journey curate` accepted only
rulings on conflicts and open questions. A curated Journey whose structure
differed from that default could only be hand-written.

## Configuration

Per-journey settings live in `.vibepro/config.json`:

```json
{
  "journey": {
    "journeys": {
      "agent-registration": {
        "scope": {
          "story_tags": ["journey-9"],
          "story_id_prefixes": ["story-agent-request-"],
          "story_ids": ["owner-agent-connect"]
        },
        "walking_skeleton": {
          "required_step_ids": ["agent-connect-request", "agent-approve"]
        }
      }
    }
  }
}
```

- `scope`: a Story is in scope when it matches any listed tag (frontmatter
  `tags` or `journey_tags`), ID prefix, or exact ID. `deriveJourneyMap(root,
  { scope })` overrides the configured scope. The normalized scope is written
  to the context pack as `scope`.
- `walking_skeleton.required_step_ids`: replaces the inferred default only for
  that Journey. Journeys without it keep the default.

## Curate additions

The `--input` judgments file may also carry:

```json
{
  "add_steps": [{
    "activity_id": "activation",
    "step_id": "agent-task-readback",
    "label": "任せた仕事を AI が読み返す",
    "after_step_id": "agent-task-assign",
    "walking_skeleton_required": true,
    "reason": "approved proposal"
  }],
  "add_open_questions": [{
    "id": "story:agent-task-readback",
    "question": "agent-task-readback を満たす Story はまだない。",
    "step_id": "agent-task-readback"
  }]
}
```

- Added steps are marked `curation.source = "curation"` and may have no
  Story. They never add Story coverage, so a required step without a Story
  stays a walking-skeleton gap.
- Added open questions stay unresolved unless they carry `status`.
- `curation.added_steps` and `curation.added_open_questions` record what was
  added.
- Curate refuses to write when the configured (or passed) scope differs from
  the context pack's scope, or when an added question ID already exists.

## Boundary and Rollback

- Boundary: additive fields only; the curated JSON schema version is
  unchanged. Logic lives in `src/journey-scope.js`.
- Rollback: revert the commit; configuration keys are ignored by older
  versions.
