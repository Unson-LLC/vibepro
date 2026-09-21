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

These records support normal GitHub PR review; they do not decide product meaning, semantic correctness, release safety, or merge authority. File and anchor checks establish traceability, not behavioral correctness. Use the [Control Loop](/guide/control-loop) for the current flow and the [Feature Map](/guide/feature-map) for retired concepts.
