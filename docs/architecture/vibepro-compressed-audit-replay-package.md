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
