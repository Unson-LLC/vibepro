---
story_id: story-vibepro-compressed-audit-replay-package
title: Compressed Audit Replay Package Spec
related_architecture:
  - ../architecture/vibepro-compressed-audit-replay-package.md
---

# Compressed Audit Replay Package Spec

## Contracts

- `CARP-CONTRACT-001`: Compact canonical audit promotion MUST write `decision-summary.md`, `audit-index.json`, and `audit-replay-bundle.json.gz` as separate artifacts.
- `CARP-CONTRACT-002`: `audit-index.json` MUST include `replay_bundle.path`, `compression`, `content_hash`, `compressed_hash`, `expanded_bytes`, `compressed_bytes`, `expanded_line_count`, `included_artifact_kinds`, and `replay_command`.
- `CARP-CONTRACT-003`: The compressed replay bundle MUST contain the raw PR/review/verification/traceability data needed to reconstruct the compact decision index without requiring `.vibepro/`.
- `CARP-CONTRACT-004`: `vibepro audit replay <repo> --story-id <id>` MUST verify compressed hash, expanded content hash, schema version, and story id before returning a replay verdict.
- `CARP-CONTRACT-005`: Replay hash mismatch, schema mismatch, missing bundle file, expansion failure, or parse failure MUST return `handoff_replay_status=blocked`.
- `CARP-CONTRACT-006`: `usage report` MUST read compressed bundle metadata from summary/index surfaces without expanding the compressed bundle during normal reporting.

## Invariants

- `CARP-INV-001`: Compression is a storage and handoff mechanism, not a security or trust boundary.
- `CARP-INV-002`: `decision-summary.md` stays human-first and MUST NOT duplicate full Gate DAG or raw review lifecycle JSON.
- `CARP-INV-003`: The compressed bundle is machine-readable replay evidence and does not need to be optimized for direct human reading.
- `CARP-INV-004`: A compact audit with missing source artifacts cannot be considered replay-ready only because a compressed bundle exists.

## Scenarios

- `CARP-S-001`: Given an over-budget canonical audit, when promotion runs, then full raw artifacts are omitted from text history but included in `audit-replay-bundle.json.gz`.
- `CARP-S-002`: Given a fresh main checkout without `.vibepro/`, when `vibepro audit replay` runs against a valid compressed bundle, then it reconstructs PR prepare, merge, verification, review, and traceability summary fields.
- `CARP-S-003`: Given a corrupted compressed bundle, when `vibepro audit replay` runs, then the result is blocked and names the hash or expansion failure.
- `CARP-S-004`: Given a usage report over compact audit artifacts, when no red flag requires deep replay, then it reports compressed and expanded bundle cost without reading full raw evidence.

## Verification

- `test/canonical-audit-self-contained.test.js` covers compact bundle generation, replay success, and corrupted bundle blocking.
- `test/traceability-usage-report.test.js` covers usage-report cost rendering without bundle expansion.
- `test/cli-smoke.test.js` covers `audit replay` command wiring.
