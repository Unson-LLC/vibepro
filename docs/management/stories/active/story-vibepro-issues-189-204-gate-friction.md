---
story_id: story-vibepro-issues-189-204-gate-friction
title: Close issue 189 and 204 gate-friction fixes
status: active
source:
  - type: github_issue
    id: "189"
    url: https://github.com/Unson-LLC/vibepro/issues/189
  - type: github_issue
    id: "204"
    url: https://github.com/Unson-LLC/vibepro/issues/204
architecture_docs:
  - docs/architecture/vibepro-issues-189-204-gate-friction.md
spec_docs:
  - docs/specs/vibepro-issues-189-204-gate-friction.md
---

# Story

VibePro should reduce fake gate friction without weakening evidence gates.

#189 is closed by proving merge-delta review reuse is already implemented and remains visible in review/PR artifacts. #204 is closed by making Story E2E AC coverage diagnostics reviewable and by recognizing multiline assertions that reference local static AC strings.

## Acceptance Criteria

- [ ] Merge-delta review reuse remains visible as `binding_status=reused_merge_delta` when current HEAD changes only files outside recorded `inspection.inputs`.
- [ ] Review evidence remains stale when the merge delta touches a recorded inspected file or when no concrete inspected file input exists.
- [ ] Missing Story E2E AC coverage reports the AC id/text, inspected E2E file, candidate test block, and the reason the block did not count.
- [ ] Multiline `expect(...)` assertions can satisfy AC coverage when the assertion references a local static string/array binding containing the AC text and a local marker such as `story-id ac:1`.
- [ ] The detector still rejects candidate blocks that contain AC text but no executable AC marker, and it suggests explicit executable coverage markers instead of no-op scanner assertions.

## Non Goals

- Do not infer semantic equivalence when reviewed source files changed.
- Do not treat arbitrary comments as AC coverage without a nearby executable assertion.
- Do not weaken stale evidence handling for HEAD, dirty fingerprint, or provenance mismatches.
