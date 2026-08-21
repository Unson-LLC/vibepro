# Product Intent Traceability

## Purpose

VibePro exists to reduce the gap between **what humans intend to build** and **what AI-assisted development actually ships**.

AI coding agents can produce correct-looking code while still solving the wrong problem. Tool restrictions, sandboxing, and workflow enforcement can reduce unsafe actions, but they do not by themselves preserve product intent.

VibePro addresses a different layer: it keeps the causal chain from product intent to implementation reviewable.

```text
Intent
  -> Story
    -> Spec
      -> Implementation
        -> Verification
          -> Review / Decision
            -> PR handoff
```

The current minimal core does not claim to autonomously decide product meaning or to execute a full development control plane. It provides the repository-local artifacts and checks needed to keep this chain explicit and inspectable by both humans and coding agents.

## Core problem

The primary failure mode VibePro targets is not "the agent used a dangerous tool." It is:

> The implementation can be technically valid while no longer matching the product intent that justified the change.

Typical examples include:

- a request is translated into code before its acceptance intent is made explicit;
- implementation details become the de facto specification;
- tests prove local correctness but not that the Story was satisfied;
- a later coding session cannot reconstruct why a design choice was made;
- review sees a diff without a reliable link back to the intended outcome.

## Current product model

### Story

The Story records the intended change and its acceptance context. It answers **what outcome are we trying to produce?**

### Spec

The Spec turns that intent into an implementation-facing contract with traceable references. It answers **what must be true for this implementation to count as satisfying the Story?**

### Implementation and verification evidence

Code and verification results answer **what changed, and what evidence supports it?**

### Review and decision records

Review and decision artifacts capture consequential interpretation and trade-offs that should not disappear into an agent conversation.

### PR handoff

PR preparation summarizes the recorded chain for human review. It is evidence handoff, not autonomous safety approval.

## What VibePro is not

VibePro is not primarily an agent sandbox or tool-permission system.

It does not attempt to replace host-level controls that restrict Bash, Edit, deployment, credentials, or model access. Those controls operate at the **capability/execution boundary**.

VibePro operates at the **intent/traceability boundary**.

These layers can be complementary:

```text
Product intent and acceptance meaning
        VibePro
           |
           v
Implementation work by coding agents
           |
           v
Optional host/tool capability enforcement
```

A constrained agent can still build the wrong thing. VibePro's job is to make that mismatch visible before the change is accepted.

## Architectural boundary after the minimal-core rebuild

The former VibePro design included a broad Gate DAG, managed execution, lifecycle accounting, budget enforcement, and automatic audit bundles. Those mechanisms were removed because the control system became more expensive to maintain than the product work it was meant to support.

That removal does **not** change the product-level objective. It narrows the implementation strategy.

The current core therefore focuses on:

1. Story registration and intent capture;
2. Story -> Spec traceability;
3. Spec -> code/test reference validation;
4. verification evidence;
5. lightweight review and decision records;
6. PR evidence handoff.

Future expansion should be justified by whether it improves the fidelity of the intent-to-implementation chain, not by whether it makes VibePro a more general agent orchestrator.

## Design principle

When evaluating a new VibePro feature, ask:

> Does this help humans and coding agents determine whether the implementation still matches the intended product outcome?

If the answer is no and the feature is primarily about generic agent execution control, it should normally live outside the VibePro core or integrate through a boundary rather than becoming part of it.
