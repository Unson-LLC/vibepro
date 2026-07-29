---
decision_id: 2026-07-29-runner-direct-evidence-round-16-standing-completion
story_id: story-vibepro-runner-direct-evidence
type: budget_override_approval
status: accepted
approver: sato_keigo
approved_at: 2026-07-29
follows: 2026-07-29-runner-direct-evidence-round-15-preflight-fix
---

# Standing completion approval (round 16): story-vibepro-runner-direct-evidence

## What changed

While this branch was closing its round-15 findings, a sibling session merged PR #394
(story-vibepro-task-scoped-pr-acceptance) into origin/main, moving it two commits past this
branch's base and touching six files this branch also changes (src/pr-manager.js,
src/adjudication.js, .vibepro/config.json, design-ssot.json, test/adjudication.test.js,
test/vibepro-cli.test.js). `gate:pr_freshness` now requires integrating current origin/main,
which stales every head-bound artifact, and the eight-branch backlog means main will keep
advancing while this branch converges.

## Owner's answer

Shown per-cycle approval, a standing approval, or parking this branch until the backlog
drains, the owner chose **完走までの包括承認** (standing approval until completion):

- Integrating origin/main is authorized as many times as `gate:pr_freshness` requires.
- Each integration cycle's differential re-review (one combined multi-role dispatch batch
  over the delta) is authorized at up to **+3 dispatches per cycle** without further asks.
- Hard ceiling: `max_subagent_count` **40**. If completion is not reached within it, the
  branch stops with a delivery-stop record instead of asking again.
- Consumption cap raised to 30,000,000 ms on the same phantom-open-lifecycle accounting
  basis as the round-15 correction.

## What this approval does not authorize

Merging the PR (`vibepro execute merge` stays a separate explicit owner action), waiving any
gate, and anything beyond the ceiling above.
