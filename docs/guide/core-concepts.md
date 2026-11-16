# Core Concepts

VibePro keeps a change's intent, implementation references, verification evidence, and human review visible together.

| Concept | Role |
| --- | --- |
| Story | Why this work exists and what user or operator outcome it should change |
| Spec | Testable acceptance criteria and invariants, linked to the Story and relevant files |
| Verification | A recorded command or external result, tied to the change's current evidence |
| Review | A lightweight inspection record with a summary, inputs, and findings |
| PR summary | A machine-readable handoff and human-readable body under `.vibepro/pr/<story-id>/` |
| Impact Context | Optional Graphify or code-structure context that helps decide what to inspect |
| Task plan | The TL's technical decomposition: Tasks, dependency kinds, contract references, assignments, integration order, plan version, and evidence requirements |
| Execution record | The external host's record of sessions, worktrees, occupancy, attempts, checkpoints, verification, and integration |
| TL planning | Technical decisions about how a Story is split and coordinated; it does not set product priority or grant merge or deployment authority |

These records support normal GitHub PR review; they do not decide product meaning, semantic correctness, release safety, or merge authority. File and anchor checks establish traceability, not behavioral correctness. Use the [Control Loop](/guide/control-loop) for the current flow and the [Feature Map](/guide/feature-map) for retired concepts.

A Task plan is a versioned planning artifact, not an execution ledger. It records the boundaries and
contracts that an external executor must honor. A prerequisite is released only by matching,
version-bound evidence with an artifact revision and evidence reference; Task status alone is not
evidence. Interface agreement and implementation milestones remain separate observations, so a
contract can be agreed before its implementation is verified.

The TL owns this technical planning plane: decomposition into the existing Task unit, dependency
classification (`prerequisite`, `interface`, or `overlap`), contract references, assignment plan,
integration order, and replanning. The parent Codex or another external host owns session dispatch,
worktrees, occupancy, retries, recovery, and execution progress. VibePro may describe readiness from
the plan and observations, but the plan does not grant merge or deployment authority. Brainbase may
project references and progress when connected; it does not create a second Task authority.
