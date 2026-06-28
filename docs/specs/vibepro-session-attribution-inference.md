---
story_id: story-vibepro-session-attribution-inference
title: Session Attribution Inference Spec
---

# Spec

## Invariants

- `SAI-INV-001`: Inference must be opt-in via `--infer-session` or
  `--session-id auto`.
- `SAI-INV-002`: Inference must preserve candidate provenance and confidence.
- `SAI-INV-003`: Ambiguous attribution must not silently select a session.

## Contracts

- `SAI-CONTRACT-001`: Session candidates come from Codex JSONL files under
  `<codex-home>/sessions`.
- `SAI-CONTRACT-002`: Process-manager cwd can strengthen candidate confidence.
- `SAI-CONTRACT-003`: Window overlap and story-id references are positive
  attribution evidence.

## Scenarios

- `SAI-SCENARIO-001`: A single repo/window-matching session is selected with
  high confidence.
- `SAI-SCENARIO-002`: Multiple equal candidates produce `ambiguous` instead of
  selecting arbitrarily.
- `SAI-SCENARIO-003`: Low-confidence candidates produce unavailable cost
  accounting.

## Anti-Patterns

- `SAI-AP-001`: Do not infer from filename alone.
- `SAI-AP-002`: Do not merge story cost windows across unrelated repos.

## Verification

- `SAI-VERIFY-001`: Unit and CLI tests cover inferred session selection and
  merge-time propagation.

