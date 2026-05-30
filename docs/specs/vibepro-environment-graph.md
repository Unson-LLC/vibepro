---
story_id: story-vibepro-environment-graph
title: Environment / System Graph Spec
---

# Environment / System Graph Spec

## Invariants

- `INV-ENV-1`: The Environment Graph MUST be derived from repository artifacts and stored as a `.vibepro/` evidence artifact bound to the current git state (head SHA + status fingerprint).
- `INV-ENV-2`: Every service node and dependency edge MUST carry a `confidence` level (`confirmed` | `inferred` | `ambiguous`) and the `sources` (artifact paths) it was derived from.
- `INV-ENV-3`: Derivation MUST NOT execute, provision, deploy, or contact live infrastructure. It reads repository files only.
- `INV-ENV-4`: A declared fallback manifest MUST be labelled as declared, MUST NOT override higher-confidence derived evidence, and MUST itself be subject to drift detection.
- `INV-ENV-5`: Consumers MUST treat a stale (drifted) or low-confidence graph as advisory; only `confirmed`/current evidence may back a blocking gate.

## Scenarios

- `S-ENV-1`: A repo with `docker-compose.yml` defining `db` (postgres) and `web` services yields two service nodes typed `database` and `backend` with a `depends_on` edge, both `confidence: confirmed`, sources citing the compose file.
- `S-ENV-2`: A repo with `prisma` + `DATABASE_URL` but no IaC yields an `inferred` `database` node sourced from `package.json` and `.env` key schema.
- `S-ENV-3`: A repo with `vercel.json` and `fly.toml` yields a `frontend` node (provider `vercel`) and a `backend` node (provider `fly`) with derivable `environments`.
- `S-ENV-4`: When an infra-defining file changes but the graph is not regenerated, a freshness signal reports drift bound to the new head SHA.
- `S-ENV-5`: `pr prepare` can read the Environment Graph; a `data_pipeline` change touching a `database` node can be checked against the graph rather than prose.
- `S-ENV-6`: A weak/conflicting signal produces an `ambiguous` node rather than a confident assertion.

## Anti-Patterns

- `AP-ENV-1`: Do not treat a hand-written manifest as the source of truth; derivation is primary, declaration is fallback only.
- `AP-ENV-2`: Do not let VibePro provision, deploy, or manage infrastructure; it models and ingests only.
- `AP-ENV-3`: Do not back a blocking gate with a stale or low-confidence topology (false confidence is worse than none).
- `AP-ENV-4`: Do not assert inferred topology as fact; confidence and sources are mandatory.
- `AP-ENV-5`: Do not contact live cloud APIs during `pr prepare`; observed enrichment, if present, is opt-in and evidence-only.

## Verification

- `V-ENV-1`: Unit tests assert service-node typing and provider attribution from compose, k8s, terraform, vercel, and fly fixtures.
- `V-ENV-2`: Unit tests assert `inferred` nodes from `package.json` deps and `.env` key schema with correct `sources`.
- `V-ENV-3`: A test asserts drift detection flags when an infra-defining file changes without graph regeneration.
- `V-ENV-4`: A test asserts derivation performs no network or process execution.
- `V-ENV-5`: `node --check` passes for new modules.
