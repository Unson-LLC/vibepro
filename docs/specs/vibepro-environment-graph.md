---
story_id: story-vibepro-environment-graph
title: Environment / System Graph Spec
---

# Environment / System Graph Spec

## Invariants

- `INV-ENV-1`: The Environment Graph MUST be derived from repository artifacts and stored as a `.vibepro/` evidence artifact bound to the current git state (head SHA).
- `INV-ENV-2`: Derivation MUST lead with always-present application signals (dependency manifest, `.env` key schema, connection-string hosts, in-code SDK clients). IaC and platform deploy configs are confidence upgrades, never prerequisites; absence of IaC MUST NOT fail derivation.
- `INV-ENV-3`: The model MUST distinguish `Component` (deployable code unit) from `Resource` (managed runtime infra), at C4 Container altitude, with a controlled edge vocabulary.
- `INV-ENV-4`: Every node and edge MUST carry `confidence` (`confirmed` | `inferred` | `ambiguous`) and `sources` (artifact paths). Confidence MUST rise only by corroboration across independent signals.
- `INV-ENV-5`: The graph MUST carry `coverage` (counts by confidence and an explicit gap list) and MUST NOT claim completeness it cannot prove.
- `INV-ENV-6`: Derivation MUST NOT execute, provision, deploy, or contact live infrastructure. It reads repository files only.
- `INV-ENV-7`: A declared fallback MUST be labelled declared, MUST NOT override higher-confidence derived evidence, and MUST be drift-checked.
- `INV-ENV-8`: Consumers MUST treat a stale or low-confidence graph as advisory; only `confirmed`/current evidence may back a blocking gate.

## Scenarios

- `S-ENV-1`: A repo with no IaC, `package.json` containing `next` + `@prisma/client` + `stripe`, and `.env` with `DATABASE_URL=postgres://...@x.neon.tech` and `STRIPE_SECRET_KEY` yields: a `frontend` Component, a `database` Resource (provider neon, type postgres, `inferred`), and an `external_api` Resource (stripe), with `reads_writes` and `consumes_api` edges. Coverage reports the inferred counts.
- `S-ENV-2`: When the same Postgres is evidenced by both the `pg` dependency and a `DATABASE_URL` host, the node confidence is upgraded by corroboration and both sources are recorded.
- `S-ENV-3`: A weak/single ambiguous signal (e.g. an unrecognized `*_URL` env key) produces an `ambiguous` node or a coverage gap, not a confident assertion.
- `S-ENV-4`: When `docker-compose.yml` or `fly.toml` is present, matching resources are upgraded to `confirmed` and providers/environments are attributed from those files.
- `S-ENV-5`: When dependency/env/infra files change without regenerating the graph, a freshness signal reports drift bound to the new head SHA.
- `S-ENV-6`: `pr prepare` can read the Environment Graph; a `data_pipeline` change touching a `database` Resource can be checked against the graph rather than prose.
- `S-ENV-7`: Topology only knowable from a provider dashboard appears as a coverage gap to be filled by a declared/observed source, never as a derived assertion.

## Anti-Patterns

- `AP-ENV-1`: Do not make IaC the foundation; lead with always-present app signals and degrade gracefully.
- `AP-ENV-2`: Do not treat a hand-written manifest as source of truth; derivation is primary, declaration is fallback only.
- `AP-ENV-3`: Do not let VibePro provision, deploy, or manage infrastructure; it models and ingests only.
- `AP-ENV-4`: Do not back a blocking gate with a stale or low-confidence topology (false confidence is worse than none).
- `AP-ENV-5`: Do not assert inferred topology as fact; confidence, sources, and coverage gaps are mandatory.
- `AP-ENV-6`: Do not dump raw provider resources; normalize to the typed model (inframap's lesson).
- `AP-ENV-7`: Do not contact live cloud APIs during `pr prepare`; observed enrichment is opt-in and evidence-only.

## Verification

- `V-ENV-1`: Unit tests assert `Component`/`Resource` typing and provider attribution from `package.json` deps and `.env` key/connection-string fixtures, with no IaC present.
- `V-ENV-2`: A unit test asserts confidence upgrade by corroboration (dep + env host -> single higher-confidence node with both sources).
- `V-ENV-3`: A unit test asserts `coverage` counts and gap reporting, and that an ambiguous signal does not become a confident node.
- `V-ENV-4`: A test asserts derivation performs no network or process execution beyond reading files and git head SHA.
- `V-ENV-5`: A test asserts the artifact is written under `.vibepro/` and bound to the current head SHA.
- `V-ENV-6`: `node --check` passes for new modules.
