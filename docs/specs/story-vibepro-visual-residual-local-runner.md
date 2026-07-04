---
story_id: story-vibepro-visual-residual-local-runner
title: Visual Residual Local Runner Spec
parent_design: vibepro-ui-journey-e2e-producer-contracts
---

# Spec

## Invariants

### VRL-INV-1: Schema parity with imported artifacts

`verify visual` MUST write `visual-residual.json` and `residual-analysis.md`
in the schema Visual QA Gate already validates. Locally generated and
externally imported residual artifacts are indistinguishable to the gate, and
the external import path remains supported unchanged.

### VRL-INV-2: Missing baseline is never a pass

A probe without a stored baseline MUST be reported as `baseline_missing`. It
MUST NOT be counted as zero residual or otherwise contribute to a passing
residual status.

### VRL-INV-3: Threshold semantics unchanged

Residual threshold configuration keeps its existing meaning. Probes exceeding
the threshold MUST yield a needs_review residual analysis naming each
exceeding probe and its residual value.

## Contracts

### VRL-CONTRACT-1: Shared probe configuration

`verify visual` reads the same probe configuration as `verify flow`; no
separate probe registry is introduced.

### VRL-CONTRACT-2: Baseline lifecycle

`--update-baseline` stores the current screenshots under
`.vibepro/qa/baseline/` per probe. A subsequent run without code or style
changes yields near-zero residual for the updated probes.

### VRL-CONTRACT-3: Bundled comparison only

Residual computation uses Playwright's bundled image comparison
(pixelmatch family). No external SaaS or additional heavyweight dependency is
required to produce residual artifacts.

### VRL-CONTRACT-4: Reported metric

The runner reports meanAbsResidualPct per probe. Semantic layout residual is
out of scope and remains an external-tool field.

### VRL-CONTRACT-5: Basic Auth compatibility boundary

The runner reuses the same runtime probe configuration as `verify flow`; the
existing `BASIC_AUTH_USER && BASIC_AUTH_PASSWORD` branch may supply browser
credentials for protected preview pages. Generated baseline, current screenshot,
`visual-residual.json`, and `residual-analysis.md` artifacts MUST NOT persist
plaintext Basic Auth credentials.

## Scenarios

### VRL-S-1: Within threshold passes the gate

Given baselines for all probes and residuals within threshold, the generated
artifacts lead `pr prepare` to a passing `gate:visual_qa` evaluation.

### VRL-S-2: Exceeding threshold needs review

Given at least one probe over threshold, the residual analysis is
needs_review and `residual-analysis.md` lists the probe and its value.

### VRL-S-3: Baseline missing is surfaced

Given a probe without a baseline, the run reports `baseline_missing` for that
probe and does not silently pass it.

### VRL-S-4: Baseline update converges

Given `--update-baseline` followed by an unchanged re-run, the residual for
the updated probes is near zero.

### VRL-S-5: Format validation parity

The generated `visual-residual.json` passes the existing residual format
validation with no validator changes.

### VRL-S-6: Visual verification workflow state transition

Given configured probes, the visual verification workflow records an explicit
state transition from `baseline_missing`, `needs_review`, or `pass` into the
corresponding Visual QA Gate status without leaving stale residual artifacts as
passing evidence.

## Anti-patterns

### VRL-AP-1: Baseline auto-refresh on failure

Do not update baselines implicitly when residuals exceed threshold; baseline
changes happen only via the explicit flag.

### VRL-AP-2: Divergent local schema

Do not add local-only fields that make gate evaluation branch on artifact
origin.

## Verification

- Node regression tests cover VRL-S-1 through VRL-S-5 (story acceptance
  criterion VRL-S-6).
- `npm run typecheck` validates edited modules.
- `vibepro pr prepare` emits a Gate DAG for this story with
  `dag_connectivity=passed`.
