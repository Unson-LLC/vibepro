---
story_id: story-vibepro-audit-replay-command-surface
title: Audit Replay Command Surface Architecture
---

# Audit Replay Command Surface Architecture

The replay contract has two authoritative surfaces:

- `audit-index.json` declares the handoff command another engineer should run.
- `bin/vibepro.js` exposes the public command surface that must execute that declaration.

Module-level replay tests prove the compressed bundle can be decoded, but they do not prove the
handoff command is reachable. Permissive smoke tests also are not enough when they only require a
numeric exit code, because `Unknown command: audit` is a numeric non-zero result and can look like a
handled CLI path.

The regression boundary therefore executes the command declared by `audit-index.json` through the
shipped binary with the checkout root as `cwd`. This covers binary import, top-level command dispatch,
subcommand dispatch, option parsing, bundle lookup relative to `.`, hash verification, and verdict
rendering in one contract.

## Data State

This change introduces no product persistence, database migration, cache mutation, or runtime data
state. It only adds documentation, a Design SSOT registry entry, and a test assertion. Replay remains
read-only: it reads `audit-index.json` and `audit-replay-bundle.json.gz`, verifies hashes in memory,
and renders a verdict.

Rollback is a normal commit revert. Existing canonical audit artifacts are not rewritten and remain
readable by the existing replay implementation.

## Decision

Keep `vibepro audit replay . --story-id <id>` as the public replay command and add binary-level
coverage for the declared artifact command. Do not introduce another alias or artifact field; the
existing command is the contract, and the value gap was insufficient verification of that contract.

## Rollback

Reverting the test returns coverage to module replay plus smoke wiring. No persisted artifact schema,
product data, or runtime state is changed.
