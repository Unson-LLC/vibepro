---
story_id: story-vibepro-flow-screenshot-visual-gate-bridge
title: Flow Screenshot to Visual Gate Bridge Spec
parent_design: vibepro-flow-screenshot-visual-gate-bridge
---

# Spec

## Invariants

### FSB-INV-1: Only passing flow runs produce visual evidence

A `verify flow` run that fails, or that detects blocking network/page errors,
MUST NOT record verification evidence carrying `visual_qa` or `screenshot`
markers, even when screenshots were saved to disk.

### FSB-INV-2: Residual artifacts remain authoritative

When `.vibepro/qa/<qa-id>/` residual analysis exists, Visual QA Gate MUST keep
using it before any flow-recorded verification fallback. The bridge MUST NOT
change residual precedence.

### FSB-INV-3: Auto-recorded evidence is current-head bound

Verification evidence recorded by the bridge MUST be bound to the git head at
which the flow run executed, following the same freshness rules as manual
`verify record` evidence.

## Contracts

### FSB-CONTRACT-1: Marker vocabulary reuse

The bridge MUST emit only the scenario marker vocabulary already accepted by
Visual QA Gate (`visual_qa`, `screenshot: <path>`), as normalized by
story-vibepro-visual-evidence-gate-ux. It MUST NOT introduce new marker tokens.

### FSB-CONTRACT-2: Provenance fields

Auto-recorded evidence MUST include the flow run id and the recorded screenshot
paths so that `gate:visual_qa` details can reference the originating run and
its artifacts.

### FSB-CONTRACT-3: No screenshots, no visual claim

A passing flow run that saved zero screenshots MUST NOT emit `visual_qa` or
`screenshot` markers. Its verification evidence, if any, remains non-visual.

## Scenarios

### FSB-S-1: Passing flow run resolves the visual gate

Given a UI source diff and a passing `verify flow` run that saved screenshots,
`pr prepare` marks `gate:visual_qa` ready for review without any additional
manual `verify record`.

### FSB-S-2: Failing flow run does not resolve the visual gate

Given a failing flow run with saved screenshots, `pr prepare` keeps
`gate:visual_qa` unresolved.

### FSB-S-3: Screenshot-less passing run stays non-visual

Given a passing flow run with no saved screenshots, no visual-marker evidence
is produced and `gate:visual_qa` stays unresolved.

### FSB-S-4: Residual evidence wins over the bridge

Given both `.vibepro/qa/<qa-id>/` residual evidence and flow-recorded
verification evidence, `pr prepare` uses the residual status for Visual QA
Gate.

### FSB-S-5: Gate details expose flow provenance

Given a `gate:visual_qa` resolved via the bridge, gate details include the flow
run id and screenshot paths.

## Anti-patterns

### FSB-AP-1: Labeling failure artifacts as proof

Do not attach visual markers to evidence from runs that did not pass; a
screenshot of a broken page is not visual QA proof.

### FSB-AP-2: Bypassing residual review

Do not let bridge-recorded evidence override residual runs that already
require review.

## Verification

- Node regression tests cover FSB-S-1 through FSB-S-5 (story acceptance
  criterion FSB-S-6).
- `npm run typecheck` validates edited modules.
- `vibepro pr prepare` emits a Gate DAG for this story with
  `dag_connectivity=passed`.
