# What VibePro Is

VibePro helps teams keep **what they intended to build** aligned with **what AI-assisted development actually produces**.

AI coding agents can write technically valid code and still solve the wrong problem. VibePro keeps the chain from Story to Spec, implementation references, verification, review, explicit decisions, trace, and PR handoff repository-local and inspectable so humans and coding agents can review the same product intent and the same evidence.

```text
Intent
  -> Story
    -> Spec
      -> Implementation
        -> Verification
          -> Review / Decision
            -> PR handoff
```

## The problem it addresses

Tool permissions and agent sandboxes answer questions such as whether an agent may call Bash, edit files, or deploy. Those controls are useful, but they do not answer whether the resulting product matches the intent that motivated the change.

VibePro works at this intent/traceability boundary. Its purpose is to make intent drift visible before a change is accepted.

## What the current core does

- Initializes a repository-local workspace and output language.
- Captures and diagnoses Stories.
- Writes Specs with code and test references.
- Keeps trace declarations from product intent toward implementation evidence.
- Runs or records verification evidence tied to repository state.
- Prepares and records role-based review evidence.
- Records explicit decisions.
- Summarizes intent-to-implementation evidence for PR handoff.
- Installs optional agent instructions and integrates with external Graphify context.

## What it does not do

VibePro does not implement application code, autonomously decide product meaning, certify that evidence is sufficient, approve a PR, or merge code. The minimal core has no broad Gate DAG, blocking readiness authority, managed execution controller, review-lifecycle accounting, delivery-efficiency budget enforcement, or automatic audit bundle.

That boundary is intentional. VibePro preserves product intent, inspectable facts, and review evidence while leaving execution capability controls to agent/runtime tooling and final judgment and authority to people, repository rules, and CI.

## Authority

The installed binary's `vibepro help` output is the authoritative CLI contract. `package.json` is the version authority. The public manual describes the current beta and includes older release history, which may mention capabilities removed from the minimal core.
