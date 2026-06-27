# Core Concepts

VibePro separates intent, code reality, verification evidence, and release judgment.

| Concept | Role |
| --- | --- |
| Story | Why this work exists and what user or operator outcome it should change |
| Architecture | Design boundaries, tradeoffs, and affected surfaces |
| Spec | Testable acceptance criteria and invariants |
| Gate DAG | The checks required before PR creation or merge |
| Evidence | Current artifacts that prove a claim for this change |
| Impact Context | Optional code-structure context that helps decide what to inspect |

Impact Context can come from Graphify artifacts or from `codebase-memory-mcp`. It helps narrow investigation scope, but it is never proof of runtime correctness, security, rollback safety, UX quality, or release readiness.
