# Trusted Delivery Efficiency Guardrail release note

## Change

Review dispatch now reserves Story budget and exact HEAD/surface/model binding before the host starts a provider agent. Validation sequencing suppresses duplicate checkpoint reviews, while current-HEAD gate-evidence and release-risk reviews remain independent. UI and network review roles are selected only from concrete changed surfaces.

VibePro does not transport provider completion notifications. The host coordinator must use its provider-native completion notification, close the provider, and then record the VibePro lifecycle. Missing or incomplete provider delivery is a typed external failure and cannot pass a required Gate.

## Operator check

1. Run `node bin/vibepro.js review status . --id <story-id> --all --history --json` when a review appears stuck.
2. Confirm there is one current authorization/lifecycle for the exact Story, stage, role, HEAD, and surface.
3. Use the host runtime's completion notification; do not poll by repeatedly launching `wait` calls.
4. Treat `budget_exceeded`, `attribution_unknown`, `orphaned_agent`, stale authorization, and missing provider completion as stops.
5. Before PR creation, inspect `node bin/vibepro.js pr prepare . --story-id <story-id> --view blocking-gates --summary-json`.

## Rollback

Trigger rollback if valid current-HEAD reviews are rejected unexpectedly, orphaned lifecycle count grows without real provider loss, or final review cannot be recorded after provider completion.

Revert the integration commit or disable the repository's delivery-efficiency policy to return to measurement-only compatibility. Do not delete `.vibepro/reviews` or efficiency artifacts; preserve them for diagnosis. No stored-data migration is introduced. The VibePro maintainer owns rollback and should attach Story id, HEAD, review history, and the bounded blocking-gates view to the incident.
