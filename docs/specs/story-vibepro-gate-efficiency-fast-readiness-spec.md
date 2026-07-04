---
story_id: story-vibepro-gate-efficiency-fast-readiness
title: Focused PR Readiness Gate Efficiency Spec
parent_design: vibepro-bounded-artifact-view
diagrams:
  - kind: threat_model
    mermaid: |
      flowchart LR
        Caller["AI coordinator or user"] --> Prepare["vibepro pr prepare --view readiness"]
        Prepare --> Plan["summary-depth evidence plan"]
        Plan --> Projection["bounded readiness projection"]
        Projection --> Gate["Gate DAG status and blockers"]
        Gate -->|blocked| Next["primary_next_command guidance"]
        Gate -->|ready| PrCreate["vibepro pr create"]
        Full["explicit --evidence-depth full"] --> Prepare
        Prepare --> Durable["durable PR artifacts"]
        Risk["required gate evidence"] --> Gate
    rationale: "Threat model for gate efficiency: focused projections reduce artifact exposure and runtime cost, while Gate DAG status still controls PR creation and explicit full-depth evidence remains available."
---

# Spec

## Invariants

- GEFR-I-1: Focused PR readiness views are projections for operators and AI
  coordinators; they do not replace durable Gate DAG evaluation.
- GEFR-I-2: Summary-depth evidence may skip heavyweight artifacts, but must
  still write `evidence-plan.json`, `decision-index.json`, and `pr-prepare.json`.
- GEFR-I-3: Explicit caller evidence-depth options are authoritative over any
  focused-view default.
- GEFR-I-4: Next-command metadata is guidance only; it must not change
  `ready_for_pr_create`, execution gate status, or waiver requirements.
- GEFR-I-5: VibePro only exposes command metadata when the command is already
  present in structured actions or an explicit fallback.

## Contracts

- GEFR-C-1: `vibepro pr prepare <repo> --view <name>` passes
  `evidenceDepth: "summary"` to PR preparation when `--evidence-depth` is not
  supplied.
- GEFR-C-2: `vibepro pr prepare <repo> --summary-json` follows the same summary
  evidence-depth default as focused `--view` output.
- GEFR-C-3: `vibepro pr prepare <repo> --json` without `--summary-json` or
  `--view` keeps risk-adaptive depth selection.
- GEFR-C-4: The implicit summary override records
  `manual_override.reason = "limited pr prepare view requested"` and
  `manual_override.consumer = "limited_pr_prepare_view"`.
- GEFR-C-5: Each unresolved readiness gate with a command-shaped
  `required_actions` entry exposes `primary_next_command`.
- GEFR-C-6: The same gate exposes `next_commands` as an ordered, deduplicated
  list of command-shaped actions.
- GEFR-C-7: Command extraction recognizes backticked commands starting with
  `vibepro`, `git`, `gh`, `node`, `npm`, `pnpm`, or `yarn`.
- GEFR-C-8: The synthetic overall-status blocker uses
  `vibepro pr prepare . --view blocking-gates` as its concrete recovery command.
- GEFR-C-9: Bounded readiness projections retain `primary_next_command` and
  `next_commands` for summarized blocking gates.

## Scenarios

- GEFR-SC-1: Given a high-risk auth change, when a caller runs
  `pr prepare --view readiness`, then the evidence plan reports
  `default_depth: "standard"` and `evidence_depth: "summary"`.
- GEFR-SC-2: Given the same high-risk change, when a caller runs
  `pr prepare --json`, then the evidence plan remains `standard`.
- GEFR-SC-3: Given any change, when a caller supplies `--evidence-depth full`,
  then full depth is used even if `--view` is also supplied.
- GEFR-SC-4: Given an Agent Review blocker whose action says
  `Run \`vibepro review prepare . --id story-fast-readiness --stage gate\``,
  readiness output exposes that command as `primary_next_command`.
- GEFR-SC-5: Given a Gate DAG overall status that is not ready but has no
  unresolved node details, readiness output exposes the blocking-gates view
  command.
- GEFR-SC-6: Given prose-only guidance, readiness output keeps the prose without
  inventing a command.

## Anti-patterns

- GEFR-A-1: Do not make focused views pass the gate by hiding blockers.
- GEFR-A-2: Do not silently skip `pr-prepare.json` or the decision index.
- GEFR-A-3: Do not change full JSON artifacts into bounded LLM projections.
- GEFR-A-4: Do not auto-run `primary_next_command`.
- GEFR-A-5: Do not convert human-only review into required agent-review pass
  evidence.
- GEFR-A-6: Do not infer commands from arbitrary prose that lacks command
  delimiters or a recognized command prefix.

## Verification

- GEFR-V-1: `test/evidence-depth-pr-prepare.test.js` covers high-risk
  `--view readiness` summary-depth behavior.
- GEFR-V-2: Existing full-depth override tests continue to prove explicit
  caller depth wins.
- GEFR-V-3: `test/pr-readiness-gate-status.test.js` covers command extraction
  from Agent Review gate actions.
- GEFR-V-4: `test/pr-readiness-gate-status.test.js` covers the synthetic
  overall-status fallback command and readiness projection metadata.
