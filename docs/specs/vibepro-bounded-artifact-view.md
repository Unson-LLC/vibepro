---
story_id: story-vibepro-bounded-artifact-view
title: Bounded Artifact Projection View Spec
parent_design:
  - vibepro-bounded-artifact-view
---

# Spec

## CLI Contract

`vibepro pr prepare [repo] --summary-json` emits JSON with:

- `artifact_kind: "pr_prepare_canonical_summary_llm_view"`
- `view: "canonical-summary"`
- `llm_input_policy.status: "bounded_projection"`
- `data.artifact_kind: "pr_prepare_llm_handoff_summary"`
- no top-level `diagnostics`
- no `data.pr_context.full_gate_dag`
- no full `data.pr_context.gate_dag_summary.nodes` or `edges`

`vibepro pr prepare [repo] --view <view>` emits JSON with the same policy envelope and the requested focused view.

Supported view names are:

- `canonical-summary`
- `readiness`
- `blocking-gates`
- `gate-evidence`
- `traceability`
- `design-ssot`
- `senior-gap`

`vibepro pr prepare [repo] --json` keeps the existing full preparation artifact shape.

## Projection Requirements

- The default projection includes readiness counts, top blocking gates, current git scope, summarized verification evidence, summarized review/decision state, and artifact references.
- Focused views may expose more detail for their surface, but they must still avoid raw command output, full diagnostics, full registry inventories, and complete Gate DAG edge/node dumps.
- Unsupported view names fail clearly with the list of supported views.
- The bounded projection path must not invalidate canonical audit cost-accounting reuse. If `currentAccountingSignature === previousAccountingSignature`, the existing accounting reuse branch remains a valid shortcut for canonical audit accounting; LLM projection views are presentation projections on top of the prepared artifact, not a reason to re-read or rewrite full accounting evidence.

## Documentation Requirements

- CLI help and init next steps tell agents to use `--summary-json` or a focused `--view` first.
- README guidance distinguishes durable full artifacts from default LLM input.
