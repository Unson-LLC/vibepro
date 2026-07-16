---
story_id: story-vibepro-run-context-capsule
title: Run Context Capsule Spec
parent_design: story-vibepro-run-context-capsule
---

# Spec: Run Context Capsule

- story_id: `story-vibepro-run-context-capsule`
- machine source: `.vibepro/spec/story-vibepro-run-context-capsule/spec.json`
- registered input: `docs/specs/story-vibepro-run-context-capsule.vibepro.json`

## Contract summary

1. A capsule is a typed, disposable projection of the authoritative Story, Run, Git HEAD, Gate, evidence, review, and decision artifacts.
2. Serialized UTF-8 size is at most 32 KiB. Deterministic reductions retain source references and are listed in `truncated_sections`.
3. Raw tool output, full JSON, diffs, logs, provider transcripts, prompts, and hidden reasoning are never embedded.
4. Refresh occurs only after material persisted events. Exact authoritative bytes define event identity; an unchanged event fingerprint leaves the artifact byte-stable, while any byte change or source-set change regenerates it.
5. Story, Run, HEAD, source existence, exact source fingerprints, and equality with the currently available source set are validated on read; mismatch fails closed without mutation.
6. Restart and managed-worktree handoff recover blocker and decision context from persisted files without transcript history.
7. Contract tests cover size and complete truncation bookkeeping, forbidden bodies, stale bindings, missing/new sources, malformed JSON, atomic failures, decision event refresh, ambiguity, mirroring, and fresh-process recovery.

## Verification

The clause-to-test matrix and commands are recorded in `docs/management/test-plans/story-vibepro-run-context-capsule.md`. The seven machine-validated clauses and the flow, state, and threat-model diagrams are registered through `vibepro spec write --final`.
