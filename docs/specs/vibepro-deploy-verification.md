---
story_id: story-vibepro-deploy-verification
title: Deploy Verification Gate Spec
---

# Deploy Verification Gate Spec

## Invariants

- `INV-DV-1`: `gate:deploy_verification` (`type: deploy_verification_gate`) MUST appear only when the Environment Graph has deploy targets AND the change is risk-bearing (`workflow_heavy`/`api_contract` profile, or `mirror_sync`/`release_merge` PR route).
- `INV-DV-2`: When present, its status MUST be `needs_evidence` (blocking `ready_for_pr_create`) unless a current-bound deploy/smoke/health verification record or an accepted waiver decision against `gate:deploy_verification` exists.
- `INV-DV-3`: The gate MUST list the deploy targets it protects (id/type/provider/environment), sourced from the Environment Graph.
- `INV-DV-4`: The gate MUST be non-critical (waiver-resolvable), not a hard block.
- `INV-DV-5`: The gate MUST NOT cause VibePro to deploy, provision, or contact a provider; it reads the Environment Graph artifact and existing evidence/decisions only.
- `INV-DV-6`: The gate MUST be wired between `gate:pr_route_classification` and `gate:pr_body_contract`, and DAG connectivity MUST remain `passed`.

## Scenarios

- `S-DV-1`: A workflow-heavy change in a repo whose Environment Graph has `vercel`/`fly` deploy targets yields `gate:deploy_verification` = `needs_evidence`, listing those targets, with `ready_for_pr_create` false.
- `S-DV-2`: Recording a waiver decision against `gate:deploy_verification` flips it to `passed` and removes it from `unresolved_gates`.
- `S-DV-3`: A repo with no Environment Graph / no deploy targets does not get the gate, even for a broad change.
- `S-DV-4`: A repo with deploy targets but a low-risk (tiny) change does not get the gate.
- `S-DV-5`: A current-bound verification record citing deploy/smoke/health resolves the gate without a waiver.

## Anti-Patterns

- `AP-DV-1`: Do not require a completed production deploy at `pr prepare` time (it runs pre-merge); require closed deploy/verification evidence or a waiver.
- `AP-DV-2`: Do not make VibePro deploy or provision; it reads topology and evidence only.
- `AP-DV-3`: Do not fire the gate on low-risk changes or repos without deploy targets (no blanket friction).
- `AP-DV-4`: Do not make the gate a hard wall; it is waiver-resolvable with an audit trail.

## Verification

- `V-DV-1`: A test asserts the gate is `needs_evidence` (blocking) for a workflow-heavy change with vercel/fly deploy targets, lists targets, and flips to `passed` after a waiver.
- `V-DV-2`: A test asserts the gate is absent without deploy targets and absent for a low-risk change with deploy targets.
- `V-DV-3`: DAG connectivity stays `passed` with the gate present.
- `V-DV-4`: `node --check src/pr-manager.js` passes.
