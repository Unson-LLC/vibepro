# Feature Map

| Need | Command family | Stored result |
| --- | --- | --- |
| Initialize and inspect a repository | `init`, `doctor`, `status` | `.vibepro/` config and health context |
| Discover impact context | `graph`, `env graph`, `diagnose` | Graph and diagnosis artifacts |
| Preserve product intent | `story`, `spec`, `trace` | Story, Spec, and trace records |
| Preserve execution evidence | `verify` | Verification records tied to repository state |
| Preserve human or agent judgment | `review`, `decision` | Review and decision records |
| Evaluate senior engineering choices | `judgment evaluate` | Advisory decision DAG and immutable run history |
| Add command guardrails | `guard` | Local guard configuration and reports |
| Prepare a PR handoff | `pr prepare`, `pr create` | PR context and human-readable body |
| Configure coding agents | `skills`, `codex`, `harness` | Installed instructions and learning records |
| Maintain integrations/artifacts | `brainbase`, `artifacts` | Integration and migration outputs |

## Removed from the minimal core

The following concepts may appear in historical release notes but are not current features: Gate DAGs, check packs, checkpoints, managed execution and merge, automatic adjudication, readiness/blocking verdicts, review-lifecycle accounting, delivery-efficiency budgets, design-modernization pipelines, usage/ROI reporting, and automatic audit bundles.

Run `vibepro help --language en` for the exact commands in your installed version.

## Development Judgment operating loop

VibePro can now operate Development Judgment as an explicit non-blocking loop rather than an optional report command:

1. record applicability,
2. prepare and explicitly adopt reviewed meaning,
3. evaluate the Development Judgment DAG,
4. bind actionable guidance into Story planning,
5. record disposition separately from later Outcome,
6. feed observed Outcome into the next judgment run.

`pr prepare` only projects this lifecycle. Development Judgment never changes PR readiness, merge, or release authority.
