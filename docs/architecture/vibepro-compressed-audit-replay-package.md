---
story_id: story-vibepro-compressed-audit-replay-package
title: Compressed Audit Replay Package Architecture
---

# Compressed Audit Replay Package Architecture

Compact canonical audit keeps the human decision surface and the machine replay surface separate.

`decision-summary.md` is the first human entry point. It names the verdict, Story, PR/merge identity, evidence freshness, review/verification counts, missing evidence, and the replay pointer. It should stay small enough for a senior engineer to scan before deciding whether deeper replay is needed.

`audit-index.json` is the machine-readable manifest. It carries the compact decision index plus the compressed replay bundle metadata: path, compression format, hashes, sizes, included artifact kinds, and replay command.

`audit-replay-bundle.json.gz` stores the raw PR/review/verification/traceability data that would otherwise inflate canonical history as text JSON. It is not meant to be read directly by humans. `vibepro audit replay` expands it into a temporary in-memory payload, verifies hashes and schema, then reconstructs the same high-level verdict fields.

## Flow

1. `execute merge` calls canonical audit promotion.
2. Promotion builds the decision index from local `.vibepro` PR, review, verification, and traceability artifacts.
3. When evidence cost budget is exceeded, promotion writes `decision-summary.md`, `audit-index.json`, and `audit-replay-bundle.json.gz`.
4. `usage report` reads only `audit-bundle.json` and `audit-index.json` metadata during normal reporting.
5. `vibepro audit replay` expands the compressed bundle only when deeper reconstruction is explicitly requested or a red flag needs investigation.

## Boundary

Compression reduces line-count churn and LLM reading cost; it does not make evidence more trustworthy by itself. Trust still comes from current-head git context, verification timestamps, review lifecycle, hash checks, and Gate DAG verdicts.

If the compressed bundle is missing, corrupted, schema-incompatible, or bound to a different Story, replay is blocked. VibePro must not infer a pass from a broken bundle.

## Architecture Decision

Alternatives considered:

- Keep every raw artifact as expanded JSON in canonical audit history. Rejected because it preserves replay fidelity but keeps changed-line and token cost high for normal audits.
- Keep only `decision-summary.md`. Rejected because it makes handoff judgment non-reconstructable when a later engineer needs Gate DAG, review, verification, or traceability details.
- Store a compact summary plus a compressed replay bundle. Selected because it preserves replay fidelity while making the human first-read surface small.

Compatibility impact:

- `audit-index.json` gains additive `replay_bundle` metadata. Existing readers that ignore unknown fields continue to work.
- `usage report` keeps normal reporting on summary/index metadata and only surfaces compressed and expanded bundle cost.
- `vibepro audit replay` is a new additive CLI path; it does not change existing `pr`, `verify`, or `execute merge` command contracts.

Rollback plan:

- Revert this commit to stop producing `audit-replay-bundle.json.gz` and remove the `audit replay` CLI command.
- Historical audit artifacts remain readable because the new fields are additive and older artifacts simply lack `replay_bundle`.
- If a generated compressed bundle is invalid, `handoff_replay_status` is blocked rather than silently falling back to pass.

Boundary:

- The authoritative replay signal is `audit-index.json` plus its recorded compressed and expanded hashes.
- `decision-summary.md` is intentionally non-authoritative for raw evidence and should not be used to bypass hash or schema checks.
- The compressed bundle stores audit artifacts only; it does not migrate product data, user data, database schema, cache state, or runtime configuration.

Accepted followups:

- Future slices may add selective expansion tooling for only the failed gate subtree, but that is not required for this Story.
- Future audits may tune optional-vs-required missing artifact classification after more post-merge samples are available.

## Data State And Replay Semantics

Migration plan: no database, cache, or product runtime state migration is introduced. The changed persisted state is limited to canonical audit artifact files written by VibePro itself.

Idempotency test: compact promotion and replay are covered by `test/canonical-audit-self-contained.test.js`; replay validates the same compressed and expanded hashes before returning ready.

Query semantics test: `test/traceability-usage-report.test.js` covers reading replay metadata without expanding the compressed payload during normal usage reporting.
