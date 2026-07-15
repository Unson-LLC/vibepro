# Feature Map

| Area | Commands | Output |
| --- | --- | --- |
| Story and Spec | `story list`, `story derive`, `story diagnose` | Story catalog, diagnosis reports, traceability context |
| Graph artifacts | `graph` | `.vibepro/graphify/` |
| PR readiness | `pr prepare`, `check pr-readiness` | `.vibepro/pr/<story-id>/` |
| Verification and CI | `verify record`, `verify import-ci` | `.vibepro/verification-artifacts/`, CI evidence |
| Independent review | `review prepare`, `review start`, `review close`, `review record`, `review status` | `.vibepro/reviews/`, lifecycle and provenance |
| Adjudication | `adjudicate prepare`, `adjudicate record` | Clause and senior-judgment verdicts |
| Decisions | `decision record`, `decision status` | Risk acceptance and waiver records |
| Release guard | `guard check`, `guard status` | Fail-closed release boundary |
| Managed execution | `execute start`, `execute status`, `execute reconcile`, `execute merge` | `.vibepro/executions/`, audited merge state |
| Audit and ROI | `audit replay`, `audit session-cost`, `usage report` | Canonical replay, cost, gate/subagent ROI |
| UI/UX intake and IA | `journey handoff`, `story map`, `design-modernize plan` | Journey context, Story links, route and flow assumptions |
| Native Design System | `design-system init`, `design-system derive`, `design-system validate` | `.vibepro/design-system/<ds-id>/` |
| UI modernization evidence | `design-modernize derive-system`, `design-modernize plan`, `verify visual`, `uiux evidence` | `.vibepro/design-modernize/<story-id>/`, visual residuals, responsive and accessibility evidence |
| UI/UX cockpit and PR linkage | `pr prepare`, `review prepare`, `review status` | `review-cockpit.html`, `gate-dag.html`, PR readiness gates |
| Doctor | `doctor` | Workspace health and repair candidates |

`codebase-memory-mcp` has no separate VibePro command. When available, `pr prepare` reads it automatically as an optional topology provider.

## UI/UX Workflow Path

Start from an existing Story. Use intake prompts and visual hypotheses as guidance only; readiness is decided by the Story, Spec, Architecture, current route code, VibePro-native Design System, current verification evidence, and Gate DAG.

```bash
vibepro story list .
vibepro journey handoff . --id <journey-id>
vibepro design-system derive . --id <ds-id> --product <name> --routes <csv> --from-code
vibepro design-modernize plan . --id <story-id> --product <name> --routes <csv> --base-url <url>
vibepro verify visual . --id <story-id> --base-url <url>
vibepro uiux evidence . --id <story-id>
vibepro pr prepare . --story-id <story-id> --base origin/main
```

Related UI/UX stories are `story-vibepro-uiux-structured-intake`, `story-vibepro-uiux-ia-flow-map`, `story-vibepro-uiux-style-preset-token-gate`, `story-vibepro-uiux-responsive-a11y-evidence-matrix`, and `story-vibepro-uiux-one-command-cockpit`.
