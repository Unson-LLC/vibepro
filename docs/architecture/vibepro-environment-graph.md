---
summary: "Architecture for VibePro's third graph: a derived, git-bound model of running services and their connections, led by always-present app signals (not IaC)."
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

## Model: Backstage entities at C4 Container altitude

Adopt proven vocabulary instead of inventing one ([Backstage system model](https://backstage.io/docs/features/software-catalog/system-model/), [C4 model](https://en.wikipedia.org/wiki/C4_model)):

- **Component** — a deployable/runnable code unit (frontend, backend/API, worker). Derived from the repo and framework conventions.
- **Resource** — managed runtime infra the components depend on: `database`, `cache`, `queue`, `storage`, `auth`, `external_api`.
- **System** (optional) — grouping of components + resources.
- Edges (controlled vocabulary): `depends_on`, `reads_writes`, `publishes_to`, `authenticates_with`, `consumes_api`, `deployed_to` (environment).

Altitude is C4 **Container** level — deployable units + datastores. Lower-level glue (IAM, networking) is dropped unless relevant. C4's deployment view maps to a future deploy gate; its security view (trust boundaries) maps to the `security_trust` route.

## Source hierarchy: always-present first, IaC as upgrade

IaC is **not** the foundation; target repos often have none. Lead with what always exists:

- **L0 — app surface (primary, ~always present):** dependency manifest + lockfiles, `.env`/`.env.example` key schema and connection-string hosts, in-code SDK client instantiation (via Graphify or scan), framework conventions (Next.js `app/` -> frontend; `app/api/**` -> backend).
- **L1 — platform deploy config (upgrade when present):** `vercel.json`, `fly.toml`, `Dockerfile`, `render.yaml`, `netlify.toml`, `Procfile`, CI deploy steps (-> provider + environments).
- **L2 — IaC (strongest, often absent):** `docker-compose`, `k8s`, `terraform`, `pulumi` (-> `confirmed`).
- **L3 — declared fallback:** human/AI-confirmed stub for underivable nodes (labelled declared; never overrides higher-confidence derived evidence).
- **L4 — observed (optional, last resort):** running app / provider API; opt-in, credentialed, evidence-only, never a side effect of `pr prepare`.

### Derivation pipeline (ingest -> normalize -> corroborate -> stitch)

Modelled on Backstage's processing pipeline and inframap's normalization lesson (raw dumps are unreadable):

1. **Ingest** each source into raw facts.
2. **Normalize** provider-specific resources into the typed model (e.g. a `pg` dep, a `DATABASE_URL=postgres://...@*.neon.tech`, and a compose `db` all normalize to one Postgres `Resource`).
3. **Corroborate** across sources: independent signals pointing at the same service merge and **raise confidence** (`ambiguous` -> `inferred` -> `confirmed`). This is "observe before deciding" applied to topology.
4. **Stitch** components, resources, and edges into one connected graph.

Example with zero IaC: `package.json` (`next`, `@prisma/client`, `stripe`) + `.env` (`DATABASE_URL=postgres://...neon.tech`, `STRIPE_SECRET_KEY`) yields a `frontend` Component, a Neon Postgres `Resource` (`inferred`), and a Stripe `external_api` `Resource`, with `reads_writes` / `consumes_api` edges.

## Confidence, coverage, and honesty

- Each node/edge: `confidence` (`confirmed` | `inferred` | `ambiguous`) + `sources`.
- The graph carries **coverage**: counts by confidence and an explicit gap list. It avoids Backstage's "catalog completeness" failure (pretending the catalog is complete). Honesty over false completeness.
- Some topology is **only knowable from a provider dashboard** (a cron, an external webhook, a hand-wired managed service not referenced in code/env). Repo derivation cannot see it; these surface as gaps to be filled by L3/L4, not asserted.

## Boundary

VibePro **models and ingests**; it does not **manage**. It never provisions, deploys, or contacts live infrastructure during derivation. Observed enrichment (L4) is opt-in evidence only.

## Freshness and drift

A stale topology is worse than none — it produces false confidence. The graph binds to the current git state (head SHA). When dependency/env/infra-defining files change without regenerating the graph, a freshness signal flags drift, mirroring `gate:pr_freshness`. Gating consumers must treat a stale or low-confidence graph as advisory only; only `confirmed`/current evidence may back a blocking gate.

## How it makes existing judgment gates real

- `data_pipeline` route: check whether a migration touches a `database` Resource and demand a rollback plan with evidence, not prose.
- `security_trust` route: check trust boundaries between service nodes against the threat model.
- future `gate:deploy_verification`: require deploy/health evidence for every deploy target in the topology, bound to head SHA and environment.

## Interop

The derived graph exports to interoperable formats (Backstage `catalog-info.yaml`, C4/Structurizr DSL) rather than a proprietary shape. VibePro's differentiation is binding topology to Story intent and risk for judgment — not the file format.

## Sequencing

Topology first; deploy gates layered on top (`story-vibepro-deploy-verification`, future). The minimal first implementation is **L0 only** (dependencies + `.env` + connection strings), proving the model and coverage honesty before adding L1/L2 parsers.
