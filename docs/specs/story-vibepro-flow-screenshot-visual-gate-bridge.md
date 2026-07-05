---
story_id: story-vibepro-flow-screenshot-visual-gate-bridge
title: Flow Screenshot to Visual Gate Bridge Spec
parent_design: vibepro-flow-screenshot-visual-gate-bridge
---

# Spec

## Invariants

### FSB-INV-1: Flow screenshots alone never produce visual gate evidence

A `verify flow` run that fails, or that detects blocking network/page errors,
MUST NOT record verification evidence carrying `visual_qa` or `screenshot`
markers. A passing run with screenshots also MUST NOT record those markers
automatically because screenshot existence is not residual review.

### FSB-INV-2: Residual artifacts remain authoritative

When `.vibepro/qa/<qa-id>/` residual analysis exists, Visual QA Gate MUST keep
using it before any flow-recorded verification fallback. The bridge MUST NOT
change residual precedence.

### FSB-INV-3: Flow provenance is current-head bound

The flow verification artifact and its not-recorded Visual QA metadata MUST be
bound to the git head at which the flow run executed, following the same
freshness rules as other verification artifacts.

### FSB-INV-4: Visual QA fallback requires real visual artifacts

`pr prepare` MUST NOT satisfy `gate:visual_qa` from prose-only verification
evidence. The verification fallback requires explicit `visual_qa` plus
`screenshot` markers tied to an existing screenshot image or residual Visual QA
artifact.

## Contracts

### FSB-CONTRACT-1: No automatic marker emission

The bridge MUST NOT emit `visual_qa` or `screenshot: <path>` scenario markers
from `verify flow`. The existing marker vocabulary remains valid only for
explicit artifact-backed `verify record` evidence.

### FSB-CONTRACT-2: Not-recorded provenance fields

The not-recorded Visual QA metadata MUST include the flow run id, source
artifact, and recorded screenshot paths so the operator can run
`vibepro verify visual` against the same captured surface.

### FSB-CONTRACT-3: No screenshots, no visual claim

A passing flow run that saved zero screenshots MUST NOT emit `visual_qa` or
`screenshot` markers. Its verification evidence, if any, remains non-visual.

### FSB-CONTRACT-4: Basic Auth compatibility boundary

The bridge MUST preserve the existing `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD`
runtime branch used by `verify flow`. Basic Auth credentials may be passed to
the runtime probe, but plaintext usernames or passwords MUST NOT be persisted
in bridge-created visual evidence, screenshot metadata, or PR artifacts.

### FSB-CONTRACT-5: Auto visual not-recorded reasons are explicit

When automatic Visual QA evidence is not recorded, `flow-verification.json`,
`flow-verification.md`, and the non-JSON CLI summary MUST report
`not_recorded` with a reason such as `story_not_bound`,
`flow_status_not_pass`, `runtime_contract_failures`, or
`screenshots_missing`. For passing runs with screenshots the reason MUST be
`visual_residual_required`.

## Scenarios

### FSB-S-1: Passing flow run points to residual evidence

Given a UI source diff and a passing `verify flow` run that saved screenshots,
`flow-verification.json` reports `not_recorded` with
`visual_residual_required`, and `pr prepare` keeps `gate:visual_qa` unresolved
until residual artifacts or explicit artifact-backed verification evidence are
present.

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

### FSB-S-5: Not-recorded details expose flow provenance

Given a passing screenshot flow run, the not-recorded Visual QA details include
the flow run id and screenshot paths.

### FSB-S-6: Residual or artifact-backed evidence resolves the gate

Given `.vibepro/qa/<qa-id>/` residual artifacts, or explicit current-head
verification evidence with real visual artifacts, `pr prepare` can mark
`gate:visual_qa` ready for review.

### FSB-S-7: Prose-only evidence does not satisfy Visual QA

Given verification evidence that only mentions Visual QA or screenshot absence
in prose, `pr prepare` keeps `gate:visual_qa` unresolved unless the evidence
also references an existing screenshot image or residual Visual QA artifact.

### FSB-S-8: Not-recorded reasons are inspectable

Given automatic Visual QA evidence is skipped, the flow verification JSON,
Markdown report, and CLI summary report `not_recorded` with the reason.

## Anti-patterns

### FSB-AP-1: Labeling failure artifacts as proof

Do not attach visual markers to evidence from runs that did not pass; a
screenshot of a broken page is not visual QA proof.

### FSB-AP-2: Bypassing residual review

Do not let bridge-recorded evidence override residual runs that already
require review.

## Verification

- Node regression tests cover FSB-S-1 through FSB-S-8 (story acceptance
  criterion FSB-S-6).
- `npm run typecheck` validates edited modules.
- `vibepro pr prepare` emits a Gate DAG for this story with
  `dag_connectivity=passed`.
