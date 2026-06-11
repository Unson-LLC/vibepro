---
title: Gate Artifact Consistency Architecture
summary: "Adds a required Gate DAG node that verifies recorded verification and review artifacts are bound to the current git state."
---

# Gate Artifact Consistency Architecture

## Context

VibePro already binds verification evidence and Agent Review records to the git head plus dirty-worktree fingerprints. Modern evidence records carry both a full/raw fingerprint and a user-scoped fingerprint that excludes VibePro-owned artifacts such as `.vibepro/` and `.worktrees/vibepro/`. Recent reviews showed that stale evidence could still appear as separate gate failures instead of a single cross-artifact consistency judgment.

## Design

`vibepro pr prepare` adds `gate:artifact_consistency` after Agent Review and before DAG connectivity. The gate collects recorded verification commands and recorded Agent Review artifacts, then compares their existing binding status against the current PR preparation git context.

The gate does not replace Unit, Integration, E2E, or Agent Review gates. Missing evidence is still owned by those gates. Artifact Consistency only answers whether recorded artifacts refer to the same current HEAD and compatible dirty fingerprint context.

The git context fields use these meanings:

- `dirty`: user-scoped dirty state. VibePro-managed artifact churn is ignored so evidence is not invalidated solely by recording new evidence.
- `raw_dirty`: raw git dirty state, including VibePro-managed artifacts.
- `status_fingerprint_hash`: full/raw status fingerprint used for legacy compatibility and raw diagnostics.
- `user_status_fingerprint_hash`: user-scoped status fingerprint used for modern evidence freshness when both recorded and current contexts provide it.

If a recorded artifact does not contain `user_status_fingerprint_hash`, Artifact Consistency falls back to the full/raw `status_fingerprint_hash` comparison so older evidence remains conservative.

## Boundary

- Verification command binding comes from `verification-evidence.json` after `bindVerificationEvidenceToGit`.
- Review artifact binding comes from `summarizeAgentReviewsForPr`.
- Missing review roles remain Agent Review Gate concerns.
- PR body self-consistency is generated from current `pr prepare` output and can be deepened by a later PR-body validator.

## Failure Handling

If any recorded artifact is stale, legacy, unverified, or otherwise not current, the gate returns `stale_evidence` and becomes a critical PR creation blocker.
