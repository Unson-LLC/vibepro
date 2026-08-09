# What VibePro Is

VibePro is a repository-local evidence workspace for AI-assisted software development. Its CLI writes structured context under `.vibepro/` so humans and coding agents can share the same Story, Spec, verification, review, decision, trace, and PR records.

## What it does

- Initializes a local workspace and output language.
- Captures and diagnoses Stories.
- Writes Specs with code and test references.
- Runs or records verification evidence tied to repository state.
- Prepares and records role-based review evidence.
- Records explicit decisions and trace declarations.
- Measures adopted-batch structure and consumption, then constrains only the next Story intent through the Development Control Loop.
- Summarizes available evidence for PR handoff.
- Installs optional agent instructions and integrates with external Graphify context.

## What it does not do

VibePro does not implement application code, certify that evidence is sufficient, approve a PR, or merge code. The minimal core has no Gate DAG, general blocking readiness verdict, managed execution controller, review-lifecycle accounting, per-Story delivery-efficiency budget enforcement, or automatic audit bundle.

The replacement Development Control Loop is deliberately narrower. It starts in `shadow`, where intent mismatches remain visible without blocking work. Once a repository has migrated active Stories, it may explicitly switch to `enforced`; only then can a mismatch block Story planning, `pr prepare`, or `pr create`. It does not limit parallel agent execution and does not grant approval or merge authority.

That boundary is intentional: VibePro preserves inspectable facts and context while leaving judgment and authority with people, repository rules, and CI.

## Authority

The installed binary's `vibepro help` output is the authoritative CLI contract. `package.json` is the version authority. The public manual describes the current beta and includes older release history, which may mention capabilities removed from the minimal core.
