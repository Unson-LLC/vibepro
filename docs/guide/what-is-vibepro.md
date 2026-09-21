# What VibePro Is

VibePro brings the reason for a change into its pull request. It keeps the user need, agreed behavior, implementation references, checks, and review context close enough that a teammate can inspect the same story behind the diff.

AI coding agents can produce technically valid code while solving the wrong problem. VibePro addresses that product-intent gap with a small set of repository-local records:

```text
User need
  -> Story (need and acceptance criteria)
    -> Spec (behavior, invariants, code/test references)
      -> Implementation
        -> Verification and review records
          -> PR summary
```

## What each record contributes

- **Story** states the user need and the acceptance criteria that make the change worth doing.
- **Spec** turns that need into concrete behavior and invariants, with `code_refs` and `test_refs` pointing toward implementation and verification.
- **Verification** records what was run or recorded against the repository state. It is evidence about a check, not a promise that the product is correct.
- **Review** records the inspection performed by a person or reviewer role, including the inspected inputs and the result.
- **PR preparation** projects the recorded Story, Spec, verification, review, trace, and decision context into a machine-readable summary and PR body.

The records are deliberately close to the repository. A later reviewer can follow the reason for the change without relying on an agent's private conversation or an unrecorded handoff.

## What the current core does

The current beta can:

- initialize a repository-local `.vibepro/` workspace and choose an output language;
- add, select, and diagnose Stories;
- write draft or final Specs and check their structural references;
- declare or inspect traces and explicit decisions when the change needs them;
- run or record unit, integration, end-to-end, typecheck, or build verification;
- prepare and record a lightweight review; and
- prepare a PR summary and body for an ordinary pull-request workflow.

The installed binary's `vibepro help` output is the authoritative command contract. See [Install and First Run](/guide/getting-started) for a concrete sequence.

Draft Specs can be used while shaping a change. A final Spec has stronger readiness preconditions: Graphify context, a Story diagnosis, and readiness evidence against the current `HEAD`. See the [control loop](/guide/control-loop) for the order of those checks.

## What is checked, and what is not

VibePro can check structural facts such as whether a declared file, symbol, or test reference exists, whether a reference has the expected anchor, and what a recorded verification command returned. Those checks make evidence easier to inspect.

They do not establish semantic correctness. A code reference may point to the wrong behavior, and a passing test may cover the wrong scenario. VibePro does not autonomously decide whether the implementation satisfies the user's need; human product and engineering review remain necessary.

Likewise, VibePro does not implement application code, certify safety, approve a pull request, or merge code. Repository policy, CI, and people retain those authorities.

## Cost and fit

Story and Spec records are an explicit maintenance cost. Keep them when the connection between a product need and a code change is valuable; update them when the intended behavior changes. They complement README files, issues, design documents, and normal code review—they are not a claim that those forms of context can be replaced by one generated artifact.

The minimal core also does not include the former broad Gate DAG, managed execution controller, review-lifecycle accounting, delivery-efficiency budgets, or automatic audit bundles. Optional Development Judgment tooling can help compare approaches and record a disposition. It is advisory context, separate from the retired broad Gate machinery, and does not become automatic intent-drift detection or merge authority.

## Authority and history

The public manual describes the current beta, while the [version history](/reference/version-history) may mention older releases. Treat the installed `vibepro help` output as the command authority and `package.json` as the version authority.
