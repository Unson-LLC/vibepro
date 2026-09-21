# Checks and Authority

VibePro prepares inspectable context and evidence. It does not certify that a change is safe, implement a sandbox, or replace repository access controls.

## What a check establishes

- A valid Spec reference establishes that the declared file and supported anchor can be found, not that the code fulfills the requirement.
- A verification result records the command's outcome. Its meaning depends on what the command actually checked.
- A review record describes an inspection and its findings. It is not a substitute for doing the inspection.
- A generated PR body summarizes available records. Missing records do not become completed work because a summary was generated.

People still assess product behavior, security, and whether the checks are sufficient. CI and repository rules retain their own requirements.

## Drafts, finalization, and findings

The current CLI has validation rules; “not a safety gate” does not mean every command accepts every input. Spec finalization requires readiness, including Graphify and Story diagnosis. A passing review requires a summary and an existing inspection input outside `.vibepro/`. Concrete `needs_changes` or `block` review findings can block PR handoff.

See [One Change Through PR Preparation](/guide/control-loop) for these distinctions. The former broad Gate DAG and mandatory review-lifecycle machinery are retired. The optional [engineering-judgment DAG](/guide/senior-engineering-judgment) is advisory, not merge authority.

## Decisions do not turn failures into successes

A decision record can preserve a choice, rationale, owner, and supporting evidence. Accepting a residual risk does not change a failed test into a passing test. Review the underlying evidence and apply your repository's policy.

## Normal PR and release workflow

Use your normal Git and GitHub workflow for PR approval, merge, and release. `pr prepare` can supply a PR-body summary; `pr create` is an optional GitHub CLI handoff. Neither is a safety certification, and VibePro does not merge code.

Older release notes describe mechanisms that no longer exist. Follow the installed CLI's help and the current [feature map](/guide/feature-map), not historical execution or gate workflows.
