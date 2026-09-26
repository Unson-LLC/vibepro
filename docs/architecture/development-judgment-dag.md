# Development Judgment DAG

## Purpose

VibePro treats software development as an accumulation of decisions made against changing context. The Development Judgment DAG records that causal history without restoring the former generic Gate DAG.

This is a deliberately small engineering judgment record. It does not decide PR readiness, execute code, merge branches, grant deployment authority, or restore the former Gate DAG.

## Position in the architecture

The agreed [Brainbase × VibePro concept model](https://github.com/Unson-LLC/vibepro-project/blob/cf986112d707497ad55a159d8b2b39e6f65dfb4f/docs/architecture/brainbase-vibepro-concept-model.md) replaces the former Meaning / Knowledge / Control Plane framing in this development context. Brainbase is the PdM harness; VibePro is the Tech Lead harness. Harness responsibilities do not confer decision authority.

Philosophy applies across judgments. Objective (desired state and criteria) and World Model (facts, observations, and hypotheses) are distinct inputs; neither is derived from the other. The repository is an evidence source, not the Engineering World Model itself.

The design connects Problem Selection and a versioned JudgmentProblem through Delegation to Story and Engineering Judgment. Story references Objective rather than duplicating it. Technical Evaluation and Outcome Evaluation feed separate learning candidates, adoption, and impact review. New learning does not rewrite past runs.

The former Frame and four DAG-layer meanings are historical vocabulary, not current control instructions. This does not retire DAGs generally or remove authorization, CI, approval, or repository rules. Story completion, shipment, use, and value realization remain different outcomes; PR/merge support does not grant deployment authority.

The node contract below describes the existing record shape. This documentation correction does not implement managed handoff v3, judgment schema 0.4.0, a persistent Engineering World Model, or a complete hierarchy of specialist DAGs. Graph glossary registration likewise does not activate new Graph entity types. A Judgment DAG remains advisory and never emits merge authority.

## Why this exists

The former VibePro Gate DAG mixed several concerns:

- engineering judgment
- evidence requirements
- policy enforcement
- execution lifecycle
- review lifecycle
- merge / release control
- audit

The minimal-core rebuild correctly removed that coupling. What was lost with it was a compact way to answer:

- What question was being decided?
- What context was true at the time?
- Which options were considered?
- Why was one option selected?
- Which earlier judgment did this depend on, contradict, or supersede?
- What outcome was expected?
- Did later evidence confirm or falsify the judgment?

Development Judgment DAG restores only that primitive.

## Node contract

A judgment node records:

```text
JudgmentNode
- id
- story_id
- event_id
- question
- context_snapshot
- assumptions[]
- options[]
- evidence_refs[]
- judgment
- decision
- authority
- runner_type
- confidence
- status
- expected_outcomes[]
- evaluations[]
- recorded_at
```

`runner_type` may be:

- `human`
- `ai_agent`
- `deterministic_rule`
- `committee`
- `external_system`

A decision may be proposed by AI but authority remains explicit. This is compatible with the Story-Driven Auto Mode principle that semantic adoption and responsibility boundaries remain human-controlled when required.

## Edge contract

Edges express causal or semantic lineage:

- `depends_on`
- `supports`
- `contradicts`
- `supersedes`
- `implements`
- `produces`
- `evaluated_by`

All edges participate in the DAG acyclicity invariant. If a relationship would create a cycle it must be represented outside this graph or as a new later judgment node.

## Append-only evaluation

The original judgment remains historical evidence. Later observations are appended as evaluations:

```text
Evaluation
- evaluation_id
- status: confirmed | mixed | falsified | unknown
- summary
- evidence_refs[]
- observed_outcomes[]
- observed_at
```

A bad decision is not rewritten into a good one. A replacement is represented by a new node and a `supersedes` edge.

This distinction is necessary for learning from architecture changes over time.

## Non-blocking invariant

The first version is intentionally non-blocking.

It MUST NOT:

- expose `gate_status`
- expose `ready_for_pr_create`
- prevent `pr prepare`
- prevent `pr create`
- control merge or deploy
- create waivers
- mutate Frame or Story adoption

A later Guardrail policy may consume judgment records as evidence, but that is a separate projection with separate authority.

## Dogfood: VibePro architecture reassessment

The first graph records three historical/current judgments:

```text
comprehensive Gate DAG
        |
        | superseded by observed complexity
        v
minimal evidence core
        |
        | supports a smaller reintroduction
        v
non-blocking Development Judgment DAG kernel
```

The important result is not that the newest judgment is "correct". The result is that the repository can now preserve why architecture moved from one state to the next and later append evidence about whether that move worked.

The dogfood artifact lives at:

`fixtures/judgment-dag/vibepro-minimal-core-reassessment.json`

## Relationship to existing VibePro concepts

### Frame / Story / Event

Judgment DAG does not replace them. Story remains the intent/commitment unit and Event remains the time-axis execution/change unit. Judgment nodes should normally bind to both when those identities are known.

### Diagnosis DAG

Diagnosis produces facts and hypotheses. A judgment node may cite diagnosis evidence, but diagnosis does not become a decision merely because it exists.

### Guardrail DAG

Guardrail decides authority boundaries such as auto allow, approval required, and reject. Judgment DAG is evidence/history only.

### Execution DAG

Execution performs an already-authorized plan. It must not infer product meaning from Judgment DAG.

### Audit

Audit records what happened. Judgment evaluations can reference audit evidence to test whether expected outcomes actually happened.

## Growth path

Do not generalize this into a new platform yet. The next step after one dogfood graph is to observe whether the same contract can represent real development choices across several Stories without adding Gate semantics.

Only after the primitive stabilizes should VibePro consider:

1. persistence commands,
2. Story/Event automatic binding,
3. Brainbase promotion rules for company-level judgments,
4. policy projections that consume judgment evidence,
5. extraction into a shared Judgment DAG kernel.

The forcing constraint is simple: if a feature requires this module to own readiness, execution, merge, or policy authority, it belongs elsewhere.
