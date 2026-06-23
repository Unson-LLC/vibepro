---
story_id: story-vibepro-evidence-depth-planner
title: Evidence Depth Planner Spec
---

# Spec

## Contract

- `EDP-CONTRACT-001`: `vibepro pr prepare` MUST write `.vibepro/pr/<story-id>/evidence-plan.json` before writing optional HTML/full-dump artifacts.
- `EDP-CONTRACT-002`: `evidence-plan.json` MUST record `evidence_depth`, default depth, operator override state, generated artifact classes, skipped artifact classes, escalation reasons, and targeted full surfaces.
- `EDP-CONTRACT-003`: low-risk docs/config/test evidence changes with no risk surface MUST default to `summary`.
- `EDP-CONTRACT-004`: normal source/product changes MUST default to `standard`.
- `EDP-CONTRACT-005`: high-risk surfaces, risk-bearing missing/stale evidence, accepted waivers, blocking or needs_changes review findings, unresolved reference gates, and traceability gaps MUST add targeted full surfaces.
- `EDP-CONTRACT-006`: `--evidence-depth full` MUST be recorded as a manual operator override with reason and consumer fields.
- `EDP-CONTRACT-007`: summary depth MUST NOT write standalone HTML reports or standalone full Gate DAG dump artifacts.
- `EDP-CONTRACT-008`: summary depth MUST still preserve Engineering Judgment route, active axes, and risk signals in `decision-index.json`.
- `EDP-CONTRACT-009`: `standard` and `full` depth MUST continue to generate the existing reviewer-facing HTML artifacts unless a later plan explicitly disables them.
- `EDP-CONTRACT-010`: self-dogfood final-gate checks MUST accept summary depth only when `pr-prepare.json`, `evidence-plan.json`, and `decision-index.json` are present and the plan explicitly records `gate-dag.json` as skipped.

## Target Files

- `src/evidence-depth-planner.js`
- `src/pr-manager.js`
- `src/cli.js`
- `src/self-dogfood-scanner.js`
- `test/evidence-depth-planner.test.js`
- `test/evidence-depth-pr-prepare.test.js`
- `test/vibepro-cli.test.js`

## Verification

- `EDP-VERIFY-001`: Unit tests cover low-risk summary, normal standard, high-risk targeted full, and operator override.
- `EDP-VERIFY-002`: Integration tests prove summary `pr prepare` writes `evidence-plan.json` and `decision-index.json` but skips `pr-prepare.html`, `review-cockpit.html`, `gate-dag.html`, `gate-dag.json`, and `split-plan.html`.
- `EDP-VERIFY-003`: Integration tests prove `--evidence-depth full` is recorded with manual override reason and consumer.
- `EDP-VERIFY-004`: Integration tests prove high-risk default `pr prepare` writes concrete targeted full surfaces in `evidence-plan.json`.
- `EDP-VERIFY-005`: self-dogfood tests prove summary-depth final gate completion is judged from `evidence-plan.json` plus `decision-index.json`, not from a missing standalone `gate-dag.json`.
