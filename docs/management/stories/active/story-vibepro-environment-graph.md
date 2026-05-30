---
story_id: story-vibepro-environment-graph
title: Environment / System Graph
status: active
---

# Environment / System Graph

## Background
VibePro reasons over two graphs today: the intent graph (Story / Architecture / Spec) and the code graph (Graphify). It has no model of the running system — which services exist (DB, API, frontend, queue, cache, auth), which providers host them, and how they connect. The engineering judgment spine already names `current_reality`, `domain_or_system_model`, and `boundary`, but only as advisory prose.

Without a system/environment model, an AI agent can edit code but cannot reason about blast radius, deploy order, migration safety, trust boundaries between services, or what "verified in production" even means. This model is the prerequisite for any post-PR deploy/verification gating: a deploy gate is empty unless VibePro first knows what must be deployed.

VibePro must **model and ingest** topology, not **manage** infrastructure (the `tool_boundary` principle). The graph is derived from repository artifacts as git-bound evidence with a confidence level, the same way Graphify derives the code graph — never a hand-written manifest that silently drifts, and never live infra provisioning.

## Acceptance Criteria
- A new command derives an Environment Graph from repository artifacts (e.g. `docker-compose`, `k8s` manifests, `terraform`, `serverless.yml`, `vercel.json`, `fly.toml`, `netlify.toml`, `Procfile`, `.env` key schema, `package.json` dependencies, CI/CD deploy steps).
- The graph has typed service nodes (`database`, `backend`, `frontend`, `queue`, `cache`, `auth`, `external_api`, `storage`, `other`), provider attribution where derivable, and dependency edges between services.
- Each node and edge carries a `confidence` level and the source artifact(s) it was derived from; ambiguous inferences are marked, not asserted.
- The graph is stored as a `.vibepro/` evidence artifact, bound to the current git state (head SHA + status fingerprint).
- A freshness signal flags when infra-defining files changed but the Environment Graph was not regenerated (drift detection), mirroring `gate:pr_freshness`.
- The derivation is deployment-agnostic and does not execute, provision, or contact live infrastructure. Optional live/observed enrichment, if ever added, is evidence-only and never required.
- `pr prepare` can reference the Environment Graph so engineering-judgment routes (data_pipeline, security_trust) and a future deploy gate can reason against real services and boundaries instead of advisory prose.
- A declared fallback manifest is supported only to supplement low-confidence or underivable nodes, and is clearly distinguished from derived evidence.
