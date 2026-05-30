---
summary: "Architecture for VibePro's third graph: a derived, git-bound model of running services and their connections."
read_when:
  - Implementing Environment Graph derivation from repo artifacts
  - Adding deploy/verification gates that need topology
  - Giving data_pipeline / security_trust routes real service boundaries
---

# Environment / System Graph Architecture

## Position

VibePro carries three graphs. Two exist today; this adds the third.

- Intent graph: Story / Architecture / Spec — what value, what boundaries.
- Code graph: Graphify — how the code connects.
- **Environment graph (this): what services run, on what providers, and how they connect at runtime.**

The environment graph is the evidence backing for the common judgment spine's `current_reality`, `domain_or_system_model`, and `boundary` steps, which are advisory prose today.

## Derivation, not declaration

The graph is **derived** from repository artifacts and stored as git-bound evidence, the same model as Graphify. Sources, in rough priority:

1. Orchestration / IaC: `docker-compose*.yml`, `k8s/**/*.yaml` (Deployment/Service/StatefulSet), `terraform/**/*.tf`, `serverless.yml`, `Pulumi.*`.
2. Platform deploy configs: `vercel.json`, `fly.toml`, `netlify.toml`, `render.yaml`, `app.json`, `Procfile`.
3. Runtime dependency signals: `package.json` / lockfiles (`prisma`/`pg` -> database, `next` -> frontend, `bullmq`/`ioredis` -> queue/cache), `.env` key schema (`DATABASE_URL` -> database, `REDIS_URL` -> cache, `STRIPE_`/`CLERK_`/`AUTH_` -> external/auth).
4. CI/CD deploy steps in `.github/workflows/**` (deploy targets, environments).

Each derived node/edge records:
- `confidence`: `confirmed` (explicit in IaC), `inferred` (from deps/env), `ambiguous` (weak signal). Mirrors Graphify's confidence vocabulary.
- `sources`: the artifact path(s) the inference came from.

A hand-authored **declared manifest** is a fallback that only supplements underivable or low-confidence nodes. It is labelled as declared, never overrides higher-confidence derived evidence, and is itself drift-checked.

## Model

Service node:
- `id`, `type` (`database` | `backend` | `frontend` | `queue` | `cache` | `auth` | `external_api` | `storage` | `other`)
- `provider` (e.g. `neon`, `vercel`, `fly`, `aws_lambda`, `clerk`, `s3`) where derivable
- `environments` (e.g. `staging`, `production`) where derivable
- `confidence`, `sources`

Dependency edge:
- `from` -> `to`, `relation` (`calls` | `reads_writes` | `publishes_to` | `authenticates_with` | `depends_on`)
- `confidence`, `sources`

## Boundary

VibePro **models and ingests**; it does not **manage**. It never provisions, deploys, or contacts live infrastructure during derivation. An optional observed-enrichment path (cloud APIs, runtime introspection) may be added later strictly as evidence (credentialed, opt-in, waiver/evidence-recorded), never as a requirement and never as a side effect of `pr prepare`.

## Freshness and drift

A stale topology is worse than none — it produces false confidence. The graph binds to the current git state (head SHA + status fingerprint). When infra-defining files change without regenerating the graph, a freshness signal flags drift, mirroring `gate:pr_freshness`. Gating consumers must treat a stale or low-confidence graph as advisory only.

## How it makes existing judgment gates real

With the environment graph available to `pr prepare`:
- `data_pipeline` route can check whether a migration touches a `database` node and demand a rollback plan with evidence, not prose.
- `security_trust` route can check trust boundaries between service nodes against the threat model.
- A future `gate:deploy_verification` can require deploy/health evidence for every deploy target in the topology, bound to head SHA and environment.

## Sequencing

This graph is the foundation for the post-PR deploy/verification DAG (`story-vibepro-deploy-verification`, future). Topology first; deploy gates layered on top. Both follow the established discipline: concretely derived, git-bound, confidence-aware, risk-adaptive, and waivable.
