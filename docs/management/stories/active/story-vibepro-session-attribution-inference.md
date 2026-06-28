---
story_id: story-vibepro-session-attribution-inference
vibepro_story_id: story-vibepro-runtime-cost-gap-closure
title: Session Attribution Inference
parent_design: vibepro-runtime-cost-gap-closure
status: active
---

# Story

Daily value audits need a practical bridge from a story/PR to the Codex session
that performed the work. VibePro should infer a session only when the evidence
is bounded by repo cwd, story id, and automation window; ambiguous attribution
must stay explicit.

## Acceptance Criteria

- [x] `SAI-AC-001`: `audit session-cost --session-id auto` and
  `--infer-session` discover Codex JSONL candidates.
- [x] `SAI-AC-002`: Candidate scoring uses repo cwd, story id reference,
  automation window overlap, process-manager evidence, and token/final-answer
  events.
- [x] `SAI-AC-003`: Ambiguous or low-confidence attribution is reported as
  unavailable/ambiguous and does not fabricate cost.
- [x] `SAI-AC-004`: `execute merge --infer-session` can collect cost without a
  manually supplied session id.

## Verification

- `test/session-efficiency-audit.test.js`
- `test/vibepro-cli.test.js`
