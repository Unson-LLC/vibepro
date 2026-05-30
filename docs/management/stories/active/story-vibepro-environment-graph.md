---
story_id: story-vibepro-environment-graph
title: Environment / System Graph
status: active
---

# Environment / System Graph

## Background
VibePro reasons over two graphs today: the intent graph (Story / Architecture / Spec) and the code graph (Graphify). It has no model of the running system — which services exist (DB, backend, frontend, queue, cache, auth, external API), which providers host them, and how they connect. The engineering judgment spine already names `current_reality`, `domain_or_system_model`, and `boundary`, but only as advisory prose.

Without a system/environment model, an AI agent can edit code but cannot reason about blast radius, deploy order, migration safety, trust boundaries between services, or what "verified in production" even means. This model is the prerequisite for any post-PR deploy/verification gating: a deploy gate is empty unless VibePro first knows what must be deployed.

**IaC is not the foundation.** VibePro's target repositories — apps delegated to AI agents — frequently have no terraform/k8s/compose at all; hosting lives in a provider dashboard, not the repo. So derivation must lead with what is *always present*: the application's own dependency manifest, code import graph (Graphify), environment-variable schema, and in-code SDK client instantiation. IaC and platform deploy configs are confidence upgrades when present, not requirements.

VibePro must **model and ingest** topology, not **manage** infrastructure (the `tool_boundary` principle). The graph is derived from repository artifacts as git-bound evidence with a confidence level and explicit coverage — never a hand-written manifest that silently drifts, and never live infra provisioning.

## Acceptance Criteria
- A command derives an Environment Graph **primarily from always-present application signals**: dependency manifest (`package.json` and lockfiles), `.env`/`.env.example` key schema and connection-string hosts, in-code SDK client instantiation (via Graphify or scan). Platform configs (`vercel.json`/`fly.toml`/`Dockerfile`/`render.yaml`/CI deploy steps) and IaC (`terraform`/`k8s`/`compose`/`pulumi`) are used as confidence upgrades when present.
- The model distinguishes **Component** (deployable code unit) from **Resource** (managed runtime infra: database/cache/queue/storage/auth/external_api), following the Backstage system model, at C4 "Container" altitude. Edges use a controlled vocabulary (`depends_on`, `reads_writes`, `publishes_to`, `authenticates_with`, `consumes_api`).
- Every node/edge carries `confidence` (`confirmed` | `inferred` | `ambiguous`) and `sources` (artifact paths). Confidence rises by **corroboration**: independent signals pointing at the same service upgrade confidence.
- The graph carries **coverage**: counts by confidence and an explicit list of unresolved gaps. It never claims completeness it cannot prove.
- The graph is stored as a `.vibepro/` evidence artifact, bound to the current git state (head SHA), and degrades gracefully — it always produces *something* useful and is honest about confidence rather than failing on missing IaC.
- A freshness signal flags when infra-defining/dependency/env files changed without regenerating the graph (drift), mirroring `gate:pr_freshness`.
- Derivation does not execute, provision, or contact live infrastructure. A declared fallback supplements underivable nodes (clearly labelled, never overriding higher-confidence derived evidence). Optional observed enrichment, if ever added, is opt-in evidence-only and never a side effect of `pr prepare`.
- Consumers (engineering-judgment routes, future deploy gate) may only back a **blocking** gate with `confirmed`/current evidence; low-confidence or dashboard-only gaps stay advisory.
- The derived graph can export to interoperable formats (Backstage `catalog-info`, C4/Structurizr) rather than locking into a proprietary shape.
