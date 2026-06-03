---
title: Gate Artifact Consistency Architecture
summary: "Adds a required Gate DAG node that verifies recorded verification and review artifacts are bound to the current git state."
---

# Gate Artifact Consistency Architecture

## Context

VibePro already binds verification evidence and Agent Review records to git head and dirty fingerprint. Recent reviews showed that stale evidence could still appear as separate gate failures instead of a single cross-artifact consistency judgment.

## Design

`vibepro pr prepare` adds `gate:artifact_consistency` after Agent Review and before DAG connectivity. The gate collects recorded verification commands and recorded Agent Review artifacts, then compares their existing binding status against the current PR preparation git context.

The gate does not replace Unit, Integration, E2E, or Agent Review gates. Missing evidence is still owned by those gates. Artifact Consistency only answers whether recorded artifacts refer to the same current HEAD and dirty fingerprint.

## Boundary

- Verification command binding comes from `verification-evidence.json` after `bindVerificationEvidenceToGit`.
- Review artifact binding comes from `summarizeAgentReviewsForPr`.
- Missing review roles remain Agent Review Gate concerns.
- PR body self-consistency is generated from current `pr prepare` output and can be deepened by a later PR-body validator.

## Failure Handling

If any recorded artifact is stale, legacy, unverified, or otherwise not current, the gate returns `stale_evidence` and becomes a critical PR creation blocker.
