---
story_id: story-vibepro-ai-artifact-lineage-reconcile
title: AI Artifact Lineage Reconcile Spec
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart TD
        Current["current .vibepro/pr/story"] --> Inventory["artifact inventory"]
        Jsonl["Codex session JSONL"] --> Hints["cwd/workdir and artifact refs"]
        Hints --> Detached["detached artifact candidates"]
        Detached --> Inventory
        Inventory --> Status["current | detached_found | detached_observed | missing"]
    rationale: "AI agents may use multiple worktrees; session evidence must preserve artifact lineage rather than collapsing to missing."
---

# Spec

## Contracts

- `AIL-001`: `audit session-cost` MUST keep current worktree artifacts as the
  first-choice source when available.
- `AIL-002`: When current artifacts are unavailable, the collector MUST inspect
  the selected Codex session JSONL for `.vibepro/pr/<story-id>` references.
- `AIL-003`: Absolute artifact references MUST be normalized to the containing
  `.vibepro/pr/<story-id>` root.
- `AIL-004`: Relative `.vibepro/pr/<story-id>` references MUST be resolved
  against observed `cwd` or `workdir` hints from the same session.
- `AIL-005`: A readable detached root MAY supply artifact inventory,
  `pr-prepare`, and `verification-evidence` summaries.
- `AIL-006`: An observed but unreadable detached root MUST be reported as
  `detached_artifact_observed`, not as clean artifact absence.
- `AIL-007`: Codex JSONL `session_meta` cwd MUST be treated as a candidate base
  for resolving relative `.vibepro/pr/<story-id>` references.

## Invariants

- VibePro must not require AI agents to manually copy `.vibepro` artifacts
  between worktrees before audits can understand lineage.
- Detached evidence is provenance, not silent canonical state.
- Missing evidence and unavailable detached evidence are different audit states.

## Scenarios

- `AIL-SCENARIO-001`: Current worktree has `.vibepro/pr/<story-id>`; the audit
  reports current artifacts and may list detached candidates as secondary.
- `AIL-SCENARIO-002`: Current worktree lacks artifacts, but session JSONL points
  to a readable detached `.vibepro/pr/<story-id>`; the audit uses that root and
  marks lineage as `detached_artifact_found`.
- `AIL-SCENARIO-003`: Current worktree lacks artifacts and session JSONL points
  to a now-deleted temp root; the audit marks lineage as
  `detached_artifact_observed`.

## Anti-Patterns

- `AIL-AP-001`: Do not infer story artifact absence from the canonical worktree
  alone.
- `AIL-AP-002`: Do not treat an unreadable detached temp path as successful
  evidence.
- `AIL-AP-003`: Do not import detached artifacts into canonical `.vibepro`
  without an explicit reconcile operation.

## Verification

- `AIL-VERIFY-001`: Unit tests create separate current and detached worktrees and
  verify detached artifact inventory is used only when current artifacts are
  unavailable.
- `AIL-VERIFY-002`: Typecheck covers the JSONL lineage parser.
