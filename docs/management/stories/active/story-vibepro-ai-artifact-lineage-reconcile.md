---
story_id: story-vibepro-ai-artifact-lineage-reconcile
title: AI worktree artifact lineage reconciliation
status: active
view: dev
period: 2026-06
source:
  type: value_audit_followup
  id: VP-VALUE-AUDIT-2026-06-29-ARTIFACT-LINEAGE
architecture_docs:
  - docs/architecture/vibepro-ai-artifact-lineage-reconcile.md
spec_docs:
  - docs/specs/vibepro-ai-artifact-lineage-reconcile.md
---

# Story

VibePro daily value audits currently assume that `.vibepro/pr/<story-id>` is
present in the worktree being audited. That is brittle for AI-driven work:
agents routinely initialize VibePro in one temporary worktree, then continue
implementation, PR creation, sync, or merge from another worktree.

When a Codex session proves that PR artifacts existed in a detached worktree,
VibePro must not report "story artifact absent" as if no evidence existed. It
should surface artifact lineage: current, detached-and-readable,
detached-observed-but-unavailable, or missing.

## Acceptance Criteria

- `audit session-cost` inspects the selected Codex session JSONL for
  `.vibepro/pr/<story-id>` references and worktree cwd/workdir hints.
- If current worktree artifacts are missing but a detached artifact root exists
  and is readable, the audit uses it for artifact inventory and PR/verification
  summaries.
- If a detached artifact root was observed in session logs but is no longer
  readable, the audit reports `detached_artifact_observed` instead of treating
  the story as cleanly unattributed or absent.
- Audit readiness distinguishes detached-unavailable artifacts from true
  artifact absence.
- Regression tests cover the cross-worktree artifact drift case.

## Non Goals

- Automatically copying detached artifacts back into canonical `.vibepro`.
- Reconstructing deleted temporary artifacts from GitHub or shell history.
- Changing the existing VibePro PR gate lifecycle.
