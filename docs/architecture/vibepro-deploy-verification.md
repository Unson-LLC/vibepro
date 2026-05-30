---
summary: "Architecture for the post-PR deploy verification gate, driven by the Environment Graph topology and risk profile."
read_when:
  - Changing pr prepare Gate DAG deploy gating
  - Consuming the Environment Graph in gates
  - Extending post-merge delivery evidence
---

# Deploy Verification Gate Architecture

## Position

This is the first consumer of the Environment Graph and the first gate that reaches past "merge-ready" toward "delivered". It does not replace CD; it does not deploy. It is a mechanical evidence contract: a risk-bearing change to a system that has real deploy targets must close its deploy/verification intent before the PR is treated as ready.

## Trigger (topology x risk)

`buildDeployVerificationGate` returns a node only when both hold:

1. **Topology:** `deployTargetsFromGraph(environmentGraph)` is non-empty — components with a known provider/environment or a `confirmed` deploy fact (from L1 deploy-config parsing). No graph or no deploy targets -> no gate.
2. **Risk:** `changeClassification.profile` is `workflow_heavy` or `api_contract`, or the PR route is `mirror_sync`/`release_merge`. Low-risk changes -> no gate, even with deploy targets.

This is the route-independent, surface-driven pattern (like the secret-surface gate): it fires on what the change *is and touches*, not on a single engineering-judgment route.

## Resolution

`needs_evidence` until either:

- a current-bound verification record mentioning deploy/rollout/release/smoke/health (`hasDeployVerificationEvidence`, reusing the existing `verificationEvidence` lifecycle), or
- an explicit waiver decision against `gate:deploy_verification`.

It is non-critical (`isCriticalUnresolvedGate` does not list it), so an unresolved gate puts execution into `waiver_required`, not a hard block — resolvable with an audit-trailed reason.

## Why pre-merge, not post-merge

`pr prepare` runs before merge, so requiring a completed production deploy is impossible and wrong. The gate enforces that the *decision and evidence* about deployment exist at PR time — staging smoke evidence, a recorded rollout plan, or a conscious waiver. This is "Release Is A Different State" made mechanical without turning VibePro into a deployer.

## Boundary

VibePro still only models and ingests. The gate reads the Environment Graph artifact and existing evidence/decisions; it never deploys, provisions, or calls a provider.

## Sequencing

This completes the initial deploy-aware slice: Environment Graph (L0/L1) -> deploy verification gate. Future work can deepen it (per-target evidence, staging->prod promotion contracts, observed post-merge enrichment) on the same foundation.
