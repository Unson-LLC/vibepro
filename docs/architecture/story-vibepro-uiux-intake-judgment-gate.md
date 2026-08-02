# story-vibepro-uiux-intake-judgment-gate Architecture

## Shape

The judgment gate lives in `src/pr-manager.js`:

- `readUiuxIntakeJudgmentContext(repoRoot, storyId)` reads
  `.vibepro/uiux/<story-id>/uiux-intake-coverage.json` then
  `.vibepro/design-modernize/<story-id>/uiux-intake-coverage.json`; the first
  parseable object wins. Unreadable or corrupt artifacts prove no judgment and
  are treated as absent (the gate stays closed; `pr prepare` never crashes on
  them).
- `buildUiuxIntakeJudgmentGate({ uiuxIntakeJudgment, decisionRecords })` emits
  `gate:uiux_intake_judgment`, always present and required, wired
  `gate:pr_route_classification -> gate:uiux_intake_judgment -> gate:pr_body_contract`.

`src/decision-records.js` adds the `intake_not_applicable` decision type, which
requires `--reason` at record time, mirroring the existing waiver/noise reason
requirements.

`skills/vibepro-workflow/SKILL.md` owns the firing judgment: on receiving a
Story the agent decides whether UI/UX intake applies, runs
`vibepro uiux intake validate` for UI/UX intents, and otherwise records the
reasoned `intake_not_applicable` decision.

## Division of Labor (why not a detector)

Auto-firing intake off change detection (e.g. change-risk-classifier UI
heuristics) was rejected: a false block teaches operators to waive the gate
mechanically, the same erosion the Next.js-bound network-contract scanner
produced. The Skill/operator owns the applicability judgment; the harness
fail-closes only on the *absence of the recorded judgment*, never on the
intake's content quality. `missing_required_fields` in the coverage artifact is
deliberately out of scope here.

## Public Contract

- CLI surface is additive: `vibepro decision record --type intake_not_applicable`
  joins the existing type list; no existing flag changes meaning. The CLI
  reference (`docs/reference/cli.md`, `docs/ja/reference/cli.md`) is
  regenerated as the contract doc for the new type.
- `pr prepare` behavior changes for every story: the new required gate blocks
  PR preparation until a judgment is recorded. Existing stories close it with
  one command (either closure path). This is an intentional, documented
  fail-closed default, announced in the Skill operating order.

## Rollout / Rollback

- Rollout: merge is the rollout; no deploy targets, schedulers, or runtime
  services are involved. Operators see the gate on their next `pr prepare`.
- Rollback: remove the `buildUiuxIntakeJudgmentGate` call, its two DAG edges,
  and the `intake_not_applicable` entry in `DECISION_TYPES`; previously
  recorded decisions remain inert data.

## Observability

The gate is observable in `pr-prepare.json` `gate_dag.nodes` (id
`gate:uiux_intake_judgment`, `resolved_by`, `intake_coverage`, `decision`) and
in the execution-gate recovery action, which names both honest closures. Gate
outcomes flow into the standard gate outcome ledger like every other gate.
