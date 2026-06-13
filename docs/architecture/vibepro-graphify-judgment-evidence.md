---
story_id: story-vibepro-graphify-judgment-evidence
title: Graphify Judgment Evidence Architecture
---

# Architecture

Graphify is an optional code-structure lens. Story, Spec, and Architecture describe intent; Graphify describes adjacent code reality. Engineering Judgment should use both, but they are not interchangeable.

`pr prepare` already creates Graphify impact context for split planning. This story moves that context earlier into `pr_context.graph_context`, then reuses it for both split planning and `gate:common_judgment_spine`.

The Gate rule is deliberately asymmetric:

- Missing Graphify is not a failure, because Graphify is an optional external install.
- Available Graphify is useful evidence, because it can reveal related files that the changed-file list alone hides.
- Graphify impact evidence is advisory for scope and review planning, not proof that runtime behavior is correct.

`graph_impact_scope` therefore appears as optional matched evidence. It can help reviewers understand current code topology and blast radius, but it does not replace focused tests, flow replay, artifact replay, or scenario evidence.
